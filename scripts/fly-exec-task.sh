#!/bin/sh
# Extract a named inline Concourse task from the pipeline and run it with
# `fly execute` against the working tree.
#
# AGENTS.md requires that a change affecting a Concourse task be verified with
# `fly execute` against the working tree on the real worker, and forbids
# maintaining a duplicate `concourse/*.yml` task definition because it would
# drift from the pipeline. This helper extracts the named task's config from
# `concourse/pipeline.yml` (via scripts/lib/extract-task.js) into a scratch file
# and runs `fly execute -c <scratch>` from the repository root, so the task is
# exercised exactly as the pipeline defines it without hand-copying YAML.
#
# Usage:
#   scripts/fly-exec-task.sh <task-name> [options] [-- <extra fly args>]
#
# Options:
#   --pipeline <path>   Pipeline YAML to read (default: concourse/pipeline.yml)
#   --target <name>     fly target (passed as `fly -t <name>`)
#   -h, --help          Show this help
#
# Everything after `--` is forwarded to `fly execute` unchanged, for example:
#   scripts/fly-exec-task.sh test-update-and-publish -- \
#     --input repo=. --output incident-repo=./out
#
# A task defined with `file:` (not inline `config:`) is passed to `fly execute`
# directly, since its config already lives in a real file.
#
# The worker/registry setup needed to supply the built test image is
# installation-specific (see docs/concourse.md "Verify an affected Concourse task"); this
# helper does not configure it. Credentials are never read or printed here: the
# caller supplies them through the environment or `fly` vars.
#
# POSIX sh only: no bash arrays, no eval, no GNU-only tools such as `timeout`.

set -eu

# --- Locate the repository root deterministically -------------------------
SCRIPT_DIR=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)
ROOT=$(CDPATH= cd -- "$SCRIPT_DIR/.." && pwd)

usage() {
  cat >&2 <<'EOF'
usage: scripts/fly-exec-task.sh <task-name> [--pipeline <path>] [--target <name>] [-- <extra fly args>]

Extract a named inline Concourse task from the pipeline and run it with
`fly execute` against the working tree. Everything after `--` is forwarded to
`fly execute` unchanged.
EOF
}

# --- Parse arguments -------------------------------------------------------
TASK_NAME=""
PIPELINE="$ROOT/concourse/pipeline.yml"
TARGET=""
EXTRA=""

while [ "$#" -gt 0 ]; do
  case "$1" in
    -h|--help)
      usage
      exit 0
      ;;
    --pipeline)
      if [ "$#" -lt 2 ]; then
        echo "fly-exec-task: --pipeline requires a path" >&2
        exit 2
      fi
      PIPELINE="$2"
      shift 2
      ;;
    --target)
      if [ "$#" -lt 2 ]; then
        echo "fly-exec-task: --target requires a name" >&2
        exit 2
      fi
      TARGET="$2"
      shift 2
      ;;
    --)
      shift
      EXTRA="$*"
      break
      ;;
    -*)
      echo "fly-exec-task: unknown option: $1" >&2
      usage
      exit 2
      ;;
    *)
      if [ -n "$TASK_NAME" ]; then
        echo "fly-exec-task: unexpected argument: $1" >&2
        usage
        exit 2
      fi
      TASK_NAME="$1"
      shift
      ;;
  esac
done

if [ -z "$TASK_NAME" ]; then
  usage
  exit 2
fi

if [ ! -f "$PIPELINE" ]; then
  echo "fly-exec-task: pipeline not found: $PIPELINE" >&2
  exit 3
fi

if ! command -v fly >/dev/null 2>&1; then
  echo "fly-exec-task: fly is not installed or not on PATH" >&2
  exit 3
fi

# --- Extract the task config ----------------------------------------------
# The Node helper is the single source of truth for locating the task and
# producing the config `fly execute -c` needs. It prints either the inline
# config text (kind=inline) or the referenced file path (kind=file).
SCRATCH_DIR="$ROOT/.cache/fly-exec"
mkdir -p "$SCRATCH_DIR"
SCRATCH="$SCRATCH_DIR/$TASK_NAME.yml"

cleanup() {
  rm -f "$SCRATCH"
}
trap cleanup EXIT INT TERM HUP

# `extract-task.js` writes the inline config to the scratch path, or prints the
# referenced file path for a `file:` task. It exits nonzero with a clear message
# when the task is missing or malformed.
RESULT=$(node "$ROOT/scripts/lib/extract-task.js" "$PIPELINE" "$TASK_NAME" "$SCRATCH")

case "$RESULT" in
  file:*)
    # The pipeline references the task file by its in-container path, where the
    # repository is mounted as the `repo` input (for example
    # `repo/concourse/ttc-vehicles.yml`). On the host the same file lives at the
    # repository root, so strip a leading `repo/` input prefix before resolving.
    REF="${RESULT#file:}"
    case "$REF" in
      repo/*) REF="${REF#repo/}" ;;
    esac
    CONFIG="$ROOT/$REF"
    if [ ! -f "$CONFIG" ]; then
      echo "fly-exec-task: referenced task file not found: $CONFIG" >&2
      exit 3
    fi
    ;;
  inline:*)
    CONFIG="$SCRATCH"
    ;;
  *)
    echo "fly-exec-task: unexpected extractor output: $RESULT" >&2
    exit 3
    ;;
esac

# --- Run fly execute -------------------------------------------------------
echo "fly-exec-task: task '$TASK_NAME'"
echo "fly-exec-task: config $CONFIG"

set -- execute -c "$CONFIG"
if [ -n "$TARGET" ]; then
  set -- -t "$TARGET" "$@"
fi
# Forward extra args unchanged. Word splitting is intentional: the caller
# supplies them as separate shell words after `--`.
# shellcheck disable=SC2086
if [ -n "$EXTRA" ]; then
  set -- "$@" $EXTRA
fi

cd "$ROOT"
# Run fly without `exec` so the EXIT trap removes the scratch file on success,
# failure, and signals. The exit status is propagated explicitly.
status=0
fly "$@" || status=$?
exit "$status"
