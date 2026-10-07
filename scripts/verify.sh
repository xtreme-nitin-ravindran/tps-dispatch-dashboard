#!/bin/sh
# Single, versioned entry point for all required SirenTO repository verification.
#
# Full mode (`npm run verify`) runs the same checks as the docs/validation.md "Run all
# required checks" workflow: Docker image preparation, both linters, the
# America/Los_Angeles unit suite, the Python tests, the live-source integration
# suite, the CI-equivalent 100/100/100 coverage gate (which is also the UTC
# unit-suite execution), browser JavaScript syntax checks, whitespace checks,
# and the generated-snapshot exclusion checks.
#
# Full mode runs its independent checks concurrently. Preparation (image
# ensure) and the final Git/snapshot checks stay sequential; only the
# independent validation jobs are scheduled in parallel. The concurrency is
# bounded by VERIFY_JOBS (default 4, maximum 8). Set VERIFY_JOBS=1 for fully
# sequential, readable diagnosis. Every required check still runs exactly once
# regardless of scheduling.
#
# Fast mode (`npm run verify:fast`) is a deliberately reduced inner-loop check.
# It ensures the Docker test image exists and is current, runs full lint, runs
# the browser JavaScript syntax checks, and runs offline JavaScript unit tests
# under TZ=UTC. It omits the America/Los_Angeles suite, the Python tests, the
# live-source integration suite, the coverage gate, and the Git
# publication/snapshot checks. Fast mode never satisfies final, pre-push, or
# promotion verification. Fast mode is always sequential.
#
# Both modes run every container command through scripts/docker-test.sh, which
# mounts the current working tree read-only over the image's /workspace while
# keeping the image-installed node_modules and pinned tools. The image is only
# rebuilt when its dependency/tooling fingerprint changes, not after ordinary
# source, script, test, or fixture edits.
#
# Usage:
#   npm run verify
#   VERIFY_JOBS=1 npm run verify
#   VERIFY_JOBS=6 npm run verify
#   npm run verify:fast
#   npm run verify:fast -- test/file-a.test.js test/file-b.test.js
#
# Requirements:
# - Docker must be available and able to build Dockerfile.test.
# - Full mode requires live internet access for the integration suite.
# - Full mode's snapshot checks compare against the locally fetched origin/main ref.
#
# Portable to the repository's supported macOS/Linux shells: POSIX sh only, no
# bash arrays, no `wait -n`, no GNU-only tools such as `timeout`, and no `eval`.

set -eu

# Resolve the repository root deterministically, independent of the caller's
# current directory, so the wrapper is always invoked from the same place.
ROOT=$(CDPATH= cd -- "$(dirname -- "$0")/.." && pwd)

IMAGE="toronto-dispatch-tests"

# Conservative default for a developer laptop; hard upper bound keeps the
# scheduler from launching an unbounded number of Docker containers.
DEFAULT_JOBS=4
MAX_JOBS=8

FAST=0
if [ "${1:-}" = "--fast" ]; then
  FAST=1
  shift
fi

# Validate explicit fast-mode test file arguments before any Docker work begins.
# Only repository-relative regular files under test/ ending in .test.js are
# accepted; integration tests, absolute paths, traversal, directories, empty
# arguments, and option-like arguments are rejected with a clear diagnostic.
if [ "$FAST" -eq 1 ] && [ "$#" -gt 0 ]; then
  for arg in "$@"; do
    case "$arg" in
      "")
        echo "verify:fast: empty test file argument" >&2
        exit 2
        ;;
      -*)
        echo "verify:fast: option-like argument not allowed: $arg" >&2
        exit 2
        ;;
      /*)
        echo "verify:fast: absolute paths are not allowed: $arg" >&2
        exit 2
        ;;
      *..*)
        echo "verify:fast: path traversal is not allowed: $arg" >&2
        exit 2
        ;;
      test/*.test.js)
        ;;
      test/*)
        echo "verify:fast: test file must end in .test.js: $arg" >&2
        exit 2
        ;;
      *)
        echo "verify:fast: test file must be under test/: $arg" >&2
        exit 2
        ;;
    esac
    case "$arg" in
      *.integration.test.js)
        echo "verify:fast: live integration tests are not allowed: $arg" >&2
        exit 2
        ;;
    esac
    if [ ! -f "$arg" ]; then
      echo "verify:fast: test file not found: $arg" >&2
      exit 2
    fi
  done
fi

# --- Concurrency configuration --------------------------------------------
# VERIFY_JOBS selects how many independent full-mode jobs run at once. It is
# validated before any Docker work so a bad value fails fast with a clear
# diagnostic. Fast mode ignores it (fast mode is always sequential).
resolve_jobs() {
  # Distinguish "unset" (use the default) from "set but empty" (reject).
  if [ -z "${VERIFY_JOBS+set}" ]; then
    JOBS=$DEFAULT_JOBS
    return 0
  fi
  raw=$VERIFY_JOBS
  if [ -z "$raw" ]; then
    echo "verify: VERIFY_JOBS must be a positive integer (got: empty)" >&2
    exit 2
  fi
  case "$raw" in
    *[!0-9]*)
      echo "verify: VERIFY_JOBS must be a positive integer (got: $raw)" >&2
      exit 2
      ;;
  esac
  # Strip leading zeros so `08` is not treated as octal by test/arithmetic.
  JOBS=$(printf '%s' "$raw" | sed 's/^0*//')
  if [ -z "$JOBS" ]; then
    JOBS=0
  fi
  if [ "$JOBS" -lt 1 ]; then
    echo "verify: VERIFY_JOBS must be at least 1 (got: $raw)" >&2
    exit 2
  fi
  if [ "$JOBS" -gt "$MAX_JOBS" ]; then
    echo "verify: VERIFY_JOBS must be at most $MAX_JOBS (got: $raw)" >&2
    exit 2
  fi
}

# --- Job definitions -------------------------------------------------------
# Each full-mode job is a name plus the arguments passed to the Docker wrapper.
# Jobs are independent: none writes to a path another job reads or writes, and
# the coverage job keeps NODE_V8_COVERAGE inside its own container. The list is
# newline-delimited because POSIX sh has no arrays.
#
# Format: <name>|<wrapper args...>
FULL_JOBS='lint|npm run lint
javascript-syntax|sh -c node --check app.js && find src scripts -name "*.js" -exec node --check {} +
unit-los-angeles|env TZ=America/Los_Angeles npm test
python|npm run test:python
integration|npm run test:integration
coverage|env TZ=UTC NODE_V8_COVERAGE=/tmp/coverage npm run test:coverage'

# --- Parallel scheduler ----------------------------------------------------
# Runs the full-mode jobs with bounded concurrency, capturing each job's output
# to its own log so concurrent output never interleaves. On the first observed
# failure it stops launching queued jobs and terminates running siblings, then
# reports every job that failed. All children are reaped and the log directory
# is removed on success, failure, or interruption.

LOG_DIR=""
RUNNING_PIDS=""
RUNNING_NAMES=""
FAILED_NAMES=""

# Collect every descendant PID of $1 (transitively) using `ps`. This lets the
# scheduler terminate a job's whole process tree, including grandchildren such
# as a `docker run` client's container process, without touching unrelated
# processes. Only descendants of a PID this run started are ever returned.
descendants_of() {
  root=$1
  frontier="$root"
  seen=""
  while [ -n "$frontier" ]; do
    next=""
    for parent in $frontier; do
      for child in $(ps -A -o pid=,ppid= 2>/dev/null | awk -v p="$parent" '$2 == p { print $1 }'); do
        case " $seen " in
          *" $child "*) ;;
          *)
            seen="$seen $child"
            next="$next $child"
            ;;
        esac
      done
    done
    frontier="$next"
  done
  printf '%s' "$seen"
}

cleanup() {
  # Terminate any still-running children started by this run, then reap them.
  # Only PIDs recorded in RUNNING_PIDS (and their descendants) are signalled,
  # so unrelated processes are never touched.
  if [ -n "$RUNNING_PIDS" ]; then
    for pid in $RUNNING_PIDS; do
      # Kill descendants first (deepest last), then the job subshell itself.
      for child in $(descendants_of "$pid"); do
        kill "$child" 2>/dev/null || true
      done
      kill "$pid" 2>/dev/null || true
    done
    for pid in $RUNNING_PIDS; do
      wait "$pid" 2>/dev/null || true
    done
    RUNNING_PIDS=""
    RUNNING_NAMES=""
  fi
  if [ -n "$LOG_DIR" ] && [ -d "$LOG_DIR" ]; then
    rm -rf "$LOG_DIR"
    LOG_DIR=""
  fi
}

on_signal() {
  echo "" >&2
  echo "verify: interrupted; terminating running jobs" >&2
  cleanup
  exit 130
}

trap 'on_signal' INT TERM HUP

# Remove a PID from the running set. RUNNING_PIDS is space-delimited and
# RUNNING_NAMES is newline-delimited with no leading or trailing blank line, so
# the Nth PID always pairs with the Nth name.
remove_running() {
  target=$1
  new_pids=""
  new_names=""
  i=0
  for pid in $RUNNING_PIDS; do
    i=$((i + 1))
    # Use a dedicated variable so this helper never clobbers the caller's
    # `name` (POSIX sh has no `local`).
    entry_name=$(printf '%s\n' "$RUNNING_NAMES" | sed -n "${i}p")
    if [ "$pid" != "$target" ]; then
      if [ -z "$new_pids" ]; then
        new_pids="$pid"
      else
        new_pids="$new_pids $pid"
      fi
      if [ -z "$new_names" ]; then
        new_names="$entry_name"
      else
        new_names="$new_names
$entry_name"
      fi
    fi
  done
  RUNNING_PIDS="$new_pids"
  RUNNING_NAMES="$new_names"
}

running_count() {
  count=0
  for running_pid in $RUNNING_PIDS; do
    count=$((count + 1))
  done
  printf '%s' "$count"
}

# Launch one job in the background, capturing output to its own log file.
#
# The job runs inside a subshell that starts the wrapped command as its own
# child and forwards INT/TERM/HUP to it. When the parent terminates the
# subshell, the subshell's trap terminates the wrapped command too, so no
# grandchild (for example a `docker run` client) is orphaned.
launch_job() {
  name=$1
  shift
  log="$LOG_DIR/$name.log"
  echo "==> [$name] started"
  (
    status=0
    sh "$ROOT/scripts/docker-test.sh" "$@" >"$log" 2>&1 &
    child=$!
    forward() {
      kill "$child" 2>/dev/null || true
    }
    trap 'forward' INT TERM HUP
    wait "$child" || status=$?
    trap - INT TERM HUP
    echo "$status" >"$LOG_DIR/$name.status"
  ) &
  pid=$!
  if [ -z "$RUNNING_PIDS" ]; then
    RUNNING_PIDS="$pid"
  else
    RUNNING_PIDS="$RUNNING_PIDS $pid"
  fi
  if [ -z "$RUNNING_NAMES" ]; then
    RUNNING_NAMES="$name"
  else
    RUNNING_NAMES="$RUNNING_NAMES
$name"
  fi
}

# Print a job's captured output. Successful jobs print a bounded tail so the
# log stays readable; failed jobs print their complete output.
print_job_output() {
  name=$1
  full=$2
  log="$LOG_DIR/$name.log"
  if [ ! -f "$log" ]; then
    return 0
  fi
  if [ "$full" -eq 1 ]; then
    echo "----- [$name] full output -----"
    cat "$log"
    echo "----- [$name] end output -----"
  else
    echo "----- [$name] output (tail) -----"
    tail -n 20 "$log"
    echo "----- [$name] end output -----"
  fi
}

# Reap one finished child by PID, returning its exit status via $JOB_STATUS.
reap_job() {
  pid=$1
  name=$2
  JOB_STATUS=0
  wait "$pid" || JOB_STATUS=$?
  remove_running "$pid"
  if [ -f "$LOG_DIR/$name.status" ]; then
    JOB_STATUS=$(cat "$LOG_DIR/$name.status")
  fi
}

run_full_parallel() {
  LOG_DIR=$(mktemp -d "${TMPDIR:-/tmp}/sirento-verify.XXXXXX")

  echo "==> Running full verification with up to $JOBS concurrent job(s)"

  # Build the queue as newline-delimited "name|args" entries.
  queue=$FULL_JOBS
  failed=0

  while [ -n "$queue" ] || [ -n "$RUNNING_PIDS" ]; do
    # Launch queued jobs while a slot is free and nothing has failed.
    while [ "$failed" -eq 0 ] && [ -n "$queue" ] && [ "$(running_count)" -lt "$JOBS" ]; do
      entry=$(printf '%s\n' "$queue" | sed -n '1p')
      queue=$(printf '%s\n' "$queue" | sed '1d')
      name=${entry%%|*}
      args=${entry#*|}
      # shellcheck disable=SC2086
      launch_job "$name" $args
    done

    # Wait for at least one running job to finish.
    if [ -n "$RUNNING_PIDS" ]; then
      first_pid=$(printf '%s' "$RUNNING_PIDS" | cut -d' ' -f1)
      first_name=$(printf '%s\n' "$RUNNING_NAMES" | sed -n '1p')
      reap_job "$first_pid" "$first_name"
      if [ "$JOB_STATUS" -ne 0 ]; then
        failed=1
        FAILED_NAMES="$FAILED_NAMES $first_name"
        echo "==> [$first_name] FAILED (exit $JOB_STATUS)"
        print_job_output "$first_name" 1
      else
        echo "==> [$first_name] passed"
        print_job_output "$first_name" 0
      fi
    fi

    # Once a failure is known and no sibling is still running, stop: queued
    # jobs must not be launched after a failure.
    if [ "$failed" -ne 0 ] && [ -z "$RUNNING_PIDS" ]; then
      break
    fi
  done

  if [ "$failed" -ne 0 ]; then
    echo "" >&2
    echo "verify: full verification failed; failing job(s):$FAILED_NAMES" >&2
    cleanup
    exit 1
  fi

  cleanup
}

# --- Sequential full-mode runner ------------------------------------------
# VERIFY_JOBS=1 runs the same jobs, in the same order, with the same commands
# and environment as the parallel scheduler; only scheduling and output
# presentation differ.
run_full_sequential() {
  echo "==> Running full verification sequentially (VERIFY_JOBS=1)"
  failed=0
  queue=$FULL_JOBS
  while [ -n "$queue" ]; do
    entry=$(printf '%s\n' "$queue" | sed -n '1p')
    queue=$(printf '%s\n' "$queue" | sed '1d')
    name=${entry%%|*}
    args=${entry#*|}
    echo "==> [$name] started"
    # shellcheck disable=SC2086
    if sh "$ROOT/scripts/docker-test.sh" $args; then
      echo "==> [$name] passed"
    else
      status=$?
      echo "==> [$name] FAILED (exit $status)" >&2
      failed=1
      FAILED_NAMES="$FAILED_NAMES $name"
      break
    fi
  done
  if [ "$failed" -ne 0 ]; then
    echo "" >&2
    echo "verify: full verification failed; failing job(s):$FAILED_NAMES" >&2
    exit 1
  fi
}

# --- Preparation (always sequential) --------------------------------------
# Validate VERIFY_JOBS before any Docker work so a bad value fails fast without
# touching the image or launching a container.
resolve_jobs

echo "==> Ensuring Docker test image is present and current ($IMAGE)"
sh "$ROOT/scripts/docker-test.sh" --ensure-image

if [ "$FAST" -eq 1 ]; then
  echo "==> Running linters (ESLint and Ruff)"
  sh "$ROOT/scripts/docker-test.sh" npm run lint

  echo "==> Checking browser JavaScript syntax"
  sh "$ROOT/scripts/docker-test.sh" node --check app.js
  sh "$ROOT/scripts/docker-test.sh" sh -c 'find src scripts -name "*.js" -exec node --check {} +'

  if [ "$#" -gt 0 ]; then
    echo "==> Running offline unit tests (TZ=UTC): $*"
    sh "$ROOT/scripts/docker-test.sh" env TZ=UTC node --test "$@"
  else
    echo "==> Running offline unit tests (TZ=UTC)"
    sh "$ROOT/scripts/docker-test.sh" env TZ=UTC npm test
  fi
  echo "==> Fast verification passed (not final, pre-push, or promotion verification)"
  exit 0
fi

# --- Full mode: parallel or sequential independent jobs -------------------
if [ "$JOBS" -eq 1 ]; then
  run_full_sequential
else
  run_full_parallel
fi

# --- Final Git/snapshot checks (always sequential) ------------------------
echo "==> Checking whitespace (git diff --check)"
git diff --check
git diff --cached --check

echo "==> Verifying generated snapshot is excluded from code changes"
git diff --exit-code origin/main...HEAD -- data/current.json
git diff --exit-code HEAD -- data/current.json

echo "==> All required checks passed"
