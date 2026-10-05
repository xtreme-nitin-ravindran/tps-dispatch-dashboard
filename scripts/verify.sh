#!/bin/sh
# Single, versioned entry point for all required SirenTO repository verification.
#
# This runs the same checks as the README "Run all required checks" workflow:
# Docker image preparation, both linters, both timezone unit suites, the Python
# tests, the live-source integration suite, the CI-equivalent 100/100/100
# coverage gate, browser JavaScript syntax checks, whitespace checks, and the
# generated-snapshot exclusion checks. It stops at the first failure.
#
# Usage: npm run verify
#
# Requirements:
# - Docker must be available and able to build Dockerfile.test.
# - Live internet access is required for the integration suite.
# - The snapshot checks compare against the locally fetched origin/main ref.
#
# Portable to the repository's supported macOS/Linux shells: POSIX sh only, no
# GNU-only tools such as `timeout`.

set -eu

IMAGE="toronto-dispatch-tests"

echo "==> Building Docker test image ($IMAGE)"
docker build -f Dockerfile.test -t "$IMAGE" .

echo "==> Running linters (ESLint and Ruff)"
docker run --rm "$IMAGE" npm run lint

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

echo "==> Checking browser JavaScript syntax"
docker run --rm -i "$IMAGE" node --input-type=module --check < app.js
docker run --rm "$IMAGE" sh -c 'find src scripts -name "*.js" -exec node --check {} +'

echo "==> Checking whitespace (git diff --check)"
git diff --check
git diff --cached --check

echo "==> Verifying generated snapshot is excluded from code changes"
git diff --exit-code origin/main...HEAD -- data/current.json
git diff --exit-code HEAD -- data/current.json

echo "==> All required checks passed"
