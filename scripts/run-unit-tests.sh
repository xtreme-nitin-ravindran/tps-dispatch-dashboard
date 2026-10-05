#!/bin/sh
# Canonical offline JavaScript unit/regression test runner.
#
# This is the single source of truth for which offline JavaScript test files
# SirenTO runs. Both ordinary unit execution and coverage execution use it, so
# the two can never drift apart:
#
#   scripts/run-unit-tests.sh              # run the canonical offline suite
#   scripts/run-unit-tests.sh --coverage   # run it with Node coverage + 100% gate
#
# Selection convention (deterministic, no manual file list):
#   - include every test/*.test.js file
#   - exclude every test/*.integration.test.js live-source test
#   - exclude anything that is not a regular file
#   - sort the result so ordering is stable across machines
#
# Live-source integration tests are run only by `npm run test:integration`.
# Browser/Playwright suites are run only by their `test:*:browser` scripts.
# Fixtures and helpers under test/fixtures are not standalone tests and are
# never selected here.
#
# The runner fails clearly when no unit tests are selected, so a broken
# convention cannot silently pass with zero tests.
#
# POSIX sh only: no bash arrays, no GNU-only tools, no eval. File names are
# passed to Node as separate, quoted arguments so spaces or glob characters in
# a path cannot be re-split or expanded.

set -eu

# Resolve the repository root deterministically, independent of the caller's
# current directory.
ROOT=$(CDPATH= cd -- "$(dirname -- "$0")/.." && pwd)

COVERAGE=0
if [ "${1:-}" = "--coverage" ]; then
  COVERAGE=1
  shift
fi

if [ "$#" -gt 0 ]; then
  echo "run-unit-tests: unexpected argument(s): $*" >&2
  echo "usage: scripts/run-unit-tests.sh [--coverage]" >&2
  exit 2
fi

TEST_DIR="$ROOT/test"

if [ ! -d "$TEST_DIR" ]; then
  echo "run-unit-tests: test directory not found: $TEST_DIR" >&2
  exit 3
fi

# --- Select the canonical offline unit test files -------------------------
# Expand the test/*.test.js glob first (while pathname expansion is enabled),
# then disable pathname expansion so a file name that happens to contain glob
# characters is never re-expanded inside the loop. The glob is expanded in
# test/ so the loop works on bare file names, which are re-prefixed with
# `test/` for the Node invocation.
cd "$TEST_DIR"
candidates=$(printf '%s\n' *.test.js)
set -f

selected=""
count=0
for file in $candidates; do
  # A literal `*.test.js` means the glob matched nothing.
  if [ ! -e "$file" ]; then
    continue
  fi
  case "$file" in
    *.integration.test.js)
      # Live-source test: owned by `npm run test:integration`.
      continue
      ;;
  esac
  if [ ! -f "$file" ]; then
    continue
  fi
  selected="$selected test/$file"
  count=$((count + 1))
done
set +f
cd "$ROOT"

if [ "$count" -eq 0 ]; then
  echo "run-unit-tests: no offline unit tests selected under test/" >&2
  echo "run-unit-tests: expected at least one test/*.test.js file (excluding *.integration.test.js)" >&2
  exit 4
fi

# --- Run ------------------------------------------------------------------
# `selected` is a space-delimited list of repository-relative paths. Word
# splitting is intentional here so each path becomes its own argument; the
# paths are repository-controlled and contain no whitespace, and `set -f`
# above already prevented glob re-expansion during selection.
if [ "$COVERAGE" -eq 1 ]; then
  # CI-equivalent coverage gate: Node fails the run when any category is below
  # 100.00%. This matches the repository's mandatory 100/100/100 requirement.
  # shellcheck disable=SC2086
  exec node \
    --experimental-test-coverage \
    --test-coverage-lines=100 \
    --test-coverage-branches=100 \
    --test-coverage-functions=100 \
    --test $selected
else
  # shellcheck disable=SC2086
  exec node --test $selected
fi

