#!/bin/sh
# Single, versioned entry point for all required SirenTO repository verification.
#
# Full mode (`npm run verify`) runs the same checks as the README "Run all
# required checks" workflow: Docker image preparation, both linters, both
# timezone unit suites, the Python tests, the live-source integration suite, the
# CI-equivalent 100/100/100 coverage gate, browser JavaScript syntax checks,
# whitespace checks, and the generated-snapshot exclusion checks. It stops at
# the first failure.
#
# Fast mode (`npm run verify:fast`) is a deliberately reduced inner-loop check.
# It builds the Docker test image, runs full lint, runs the browser JavaScript
# syntax checks, and runs offline JavaScript unit tests under TZ=UTC. It omits
# the America/Los_Angeles suite, the Python tests, the live-source integration
# suite, the coverage gate, and the Git publication/snapshot checks. Fast mode
# never satisfies final, pre-push, or promotion verification.
#
# Usage:
#   npm run verify
#   npm run verify:fast
#   npm run verify:fast -- test/file-a.test.js test/file-b.test.js
#
# Requirements:
# - Docker must be available and able to build Dockerfile.test.
# - Full mode requires live internet access for the integration suite.
# - Full mode's snapshot checks compare against the locally fetched origin/main ref.
#
# Portable to the repository's supported macOS/Linux shells: POSIX sh only, no
# GNU-only tools such as `timeout`.

set -eu

IMAGE="toronto-dispatch-tests"

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

echo "==> Building Docker test image ($IMAGE)"
docker build -f Dockerfile.test -t "$IMAGE" .

echo "==> Running linters (ESLint and Ruff)"
docker run --rm "$IMAGE" npm run lint

echo "==> Checking browser JavaScript syntax"
docker run --rm -i "$IMAGE" node --input-type=module --check < app.js
docker run --rm "$IMAGE" sh -c 'find src scripts -name "*.js" -exec node --check {} +'

if [ "$FAST" -eq 1 ]; then
  if [ "$#" -gt 0 ]; then
    echo "==> Running offline unit tests (TZ=UTC): $*"
    docker run --rm -e TZ=UTC "$IMAGE" node --test "$@"
  else
    echo "==> Running offline unit tests (TZ=UTC)"
    docker run --rm -e TZ=UTC "$IMAGE" npm test
  fi
  echo "==> Fast verification passed (not final, pre-push, or promotion verification)"
  exit 0
fi

echo "==> Running unit tests (TZ=UTC)"
docker run --rm -e TZ=UTC "$IMAGE"

echo "==> Running unit tests (TZ=America/Los_Angeles)"
docker run --rm -e TZ=America/Los_Angeles "$IMAGE"

echo "==> Running Python tests"
docker run --rm "$IMAGE" npm run test:python

echo "==> Running live-source integration tests"
docker run --rm "$IMAGE" npm run test:integration

echo "==> Running coverage gate (100% lines/branches/functions)"
docker run --rm \
  -e NODE_V8_COVERAGE=/tmp/coverage \
  "$IMAGE" \
  npm run test:coverage

echo "==> Checking whitespace (git diff --check)"
git diff --check
git diff --cached --check

echo "==> Verifying generated snapshot is excluded from code changes"
git diff --exit-code origin/main...HEAD -- data/current.json
git diff --exit-code HEAD -- data/current.json

echo "==> All required checks passed"
