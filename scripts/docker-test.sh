#!/bin/sh
# Run repository validation against the CURRENT working tree using the pinned
# Docker test image for dependencies and tooling.
#
# The image bakes in Node, ESLint, Ruff, and node_modules. Working-tree source,
# scripts, tests, fixtures, and bind-mounted configuration are mounted read-only
# over /workspace so a run always validates the files on disk, without rebuilding
# the image after every edit.
#
# Usage:
#   scripts/docker-test.sh npm test
#   scripts/docker-test.sh npm run lint
#   scripts/docker-test.sh node --test test/theme.test.js
#   scripts/docker-test.sh --build          # canonical image build
#   scripts/docker-test.sh --ensure-image   # build only if missing or stale
#
# The wrapper never uses eval, preserves the wrapped command's arguments and exit
# status, and fails clearly when the image is missing or stale.
#
# POSIX sh only: no bash arrays, no GNU-only tools such as `timeout`.

set -eu

# --- Locate the repository root deterministically -------------------------
# Resolve this script's directory, then its parent, independent of the caller's
# current directory. `CDPATH=` guards against a user CDPATH altering `cd`.
SCRIPT_DIR=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)
ROOT=$(CDPATH= cd -- "$SCRIPT_DIR/.." && pwd)

IMAGE="toronto-dispatch-tests"
FINGERPRINT_LABEL="org.sirento.test-fingerprint"

# Image-defining inputs that are baked into the image and NOT bind-mounted.
# Changing any of these requires a rebuild. The Dockerfile embeds the pinned
# Ruff version and base images, so hashing it covers the tooling pin.
FINGERPRINT_INPUTS="Dockerfile.test package.json package-lock.json"

# --- Portable SHA-256 ------------------------------------------------------
sha256_of_files() {
  # Hash the exact bytes of each input in a fixed order. The file name is
  # included so reordering or renaming inputs changes the digest.
  for f in $FINGERPRINT_INPUTS; do
    if [ ! -f "$ROOT/$f" ]; then
      echo "docker-test: missing fingerprint input: $f" >&2
      exit 3
    fi
    printf '%s\n' "$f"
    cat "$ROOT/$f"
  done | sha256_stream
}

sha256_stream() {
  if command -v sha256sum >/dev/null 2>&1; then
    sha256sum | awk '{print $1}'
  elif command -v shasum >/dev/null 2>&1; then
    shasum -a 256 | awk '{print $1}'
  elif command -v openssl >/dev/null 2>&1; then
    openssl dgst -sha256 | awk '{print $NF}'
  else
    echo "docker-test: no SHA-256 tool found (need sha256sum, shasum, or openssl)" >&2
    exit 3
  fi
}

current_fingerprint() {
  sha256_of_files
}

# --- Docker helpers --------------------------------------------------------
require_docker() {
  if ! command -v docker >/dev/null 2>&1; then
    echo "docker-test: docker is not installed or not on PATH" >&2
    exit 3
  fi
}

image_exists() {
  docker image inspect "$IMAGE" >/dev/null 2>&1
}

image_fingerprint() {
  # Read the fingerprint label baked into the image. Empty when the image was
  # built without the canonical build path.
  docker image inspect --format "{{ index .Config.Labels \"$FINGERPRINT_LABEL\" }}" "$IMAGE" 2>/dev/null || true
}

build_image() {
  require_docker
  fp=$(current_fingerprint)
  echo "==> Building Docker test image ($IMAGE)"
  echo "    fingerprint: $fp"
  docker build \
    -f "$ROOT/Dockerfile.test" \
    --build-arg "TEST_FINGERPRINT=$fp" \
    -t "$IMAGE" \
    "$ROOT"
}

ensure_image() {
  require_docker
  if ! image_exists; then
    echo "docker-test: image '$IMAGE' not found; building it now" >&2
    build_image
    return 0
  fi
  want=$(current_fingerprint)
  have=$(image_fingerprint)
  if [ "$have" != "$want" ]; then
    echo "docker-test: image '$IMAGE' is stale; rebuilding" >&2
    echo "    image fingerprint: ${have:-<none>}" >&2
    echo "    current fingerprint: $want" >&2
    build_image
  fi
}

check_fresh() {
  require_docker
  if ! image_exists; then
    echo "docker-test: image '$IMAGE' not found." >&2
    echo "Build it with: scripts/docker-test.sh --build" >&2
    exit 3
  fi
  want=$(current_fingerprint)
  have=$(image_fingerprint)
  if [ -z "$have" ]; then
    echo "docker-test: image '$IMAGE' has no fingerprint label." >&2
    echo "Rebuild it with the canonical build path: scripts/docker-test.sh --build" >&2
    exit 3
  fi
  if [ "$have" != "$want" ]; then
    echo "docker-test: image '$IMAGE' is stale." >&2
    echo "    image fingerprint:   $have" >&2
    echo "    current fingerprint: $want" >&2
    echo "Rebuild it with: scripts/docker-test.sh --build" >&2
    exit 3
  fi
}

# --- Read-only working-tree mounts -----------------------------------------
# Mount each required working-tree path read-only over /workspace. Mounting the
# whole repository would shadow the image-installed node_modules, so paths are
# mounted individually and node_modules is never mounted.
#
# Directories are mounted as directories; files as files. Missing optional paths
# are skipped so the wrapper stays usable on a partial checkout, but the core
# validation inputs must exist.
MOUNT_DIRS="src scripts test data concourse"
MOUNT_FILES="app.js index.html service-worker.js manifest.webmanifest styles.css eslint.config.js ruff.toml Dockerfile.test package.json package-lock.json"

mount_args() {
  for d in $MOUNT_DIRS; do
    if [ -d "$ROOT/$d" ]; then
      printf '%s\n' "-v" "$ROOT/$d:/workspace/$d:ro"
    fi
  done
  for f in $MOUNT_FILES; do
    if [ -f "$ROOT/$f" ]; then
      printf '%s\n' "-v" "$ROOT/$f:/workspace/$f:ro"
    fi
  done
}

run_command() {
  # Preserve the wrapped command's arguments exactly and its exit status.
  # shellcheck disable=SC2046
  exec docker run --rm \
    $(mount_args) \
    -w /workspace \
    "$IMAGE" \
    "$@"
}

# --- Dispatch --------------------------------------------------------------
case "${1:-}" in
  "")
    echo "usage: scripts/docker-test.sh <command> [args...]" >&2
    echo "       scripts/docker-test.sh --build" >&2
    echo "       scripts/docker-test.sh --ensure-image" >&2
    exit 2
    ;;
  --build)
    build_image
    ;;
  --ensure-image)
    ensure_image
    ;;
  --fingerprint)
    current_fingerprint
    ;;
  *)
    check_fresh
    run_command "$@"
    ;;
esac
