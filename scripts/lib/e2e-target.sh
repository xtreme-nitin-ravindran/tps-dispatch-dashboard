#!/bin/bash
# Manage the throwaway Docker-in-systemd SSH target used by `make e2e-local`.
#
# Story 64 removed the VMware path in favour of a Docker container that behaves
# like a Linux host: systemd as PID 1, sshd, and a nested `dockerd` so the Ansible
# playbook (`deploy/ansible/`) can install Docker and deploy the collector/processor
# Compose stack end-to-end. The container is built from `deploy/e2e/target.Dockerfile`
# and reached over SSH at `127.0.0.1:2222` using the `deploy/ansible/inventory/local.yml`
# inventory (key-only auth, no password).
#
# The e2e harness (`scripts/e2e.sh`) does NOT build or start this target; it only
# deploys onto an already-reachable SSH host. This helper fills that gap by owning
# the target's own lifecycle so `make e2e-local` is a single command.
#
# Commands:
#   up      build the image (if needed) and start the container, then wait for sshd
#   stop    stop the container (leaves the image + keypair in place)
#   down    stop and remove the container (leaves the image + keypair in place)
#   status  print whether the container is running and whether sshd is reachable
#
# The SSH keypair lives at $E2E_TARGET_KEY (default ~/workspace/tmp/e2e-target_id_ed25519)
# so it matches deploy/ansible/inventory/local.yml (`ansible_ssh_private_key_file`).
# A key is generated on first `up` and reused afterwards; `E2E_TARGET_FORCE_KEY=1`
# regenerates it (and therefore rebuilds the image, since the public key is baked in).

set -euo pipefail

# shellcheck disable=SC1007  # intentional: CDPATH= unsets CDPATH for this single `cd`
SCRIPT_DIR=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)
# shellcheck disable=SC1007  # intentional: CDPATH= unsets CDPATH for this single `cd`
REPO_DIR=$(CDPATH= cd -- "$SCRIPT_DIR/../.." && pwd)

IMAGE="${E2E_TARGET_IMAGE:-sirento-e2e-target}"
CONTAINER="${E2E_TARGET_CONTAINER:-sirento-e2e-target}"
DOCKERFILE="$REPO_DIR/deploy/e2e/target.Dockerfile"
# The SSH port and user must stay in sync with deploy/ansible/inventory/local.yml.
SSH_PORT="${E2E_TARGET_SSH_PORT:-2222}"
SSH_USER="${E2E_TARGET_SSH_USER:-sirento}"
SSH_HOST="127.0.0.1"
KEY="${E2E_TARGET_KEY:-$HOME/workspace/tmp/e2e-target_id_ed25519}"

_fail() { printf 'FAIL: %s\n' "$*" >&2; exit 1; }
_pass() { printf 'PASS: %s\n' "$*"; }
_info() { printf 'INFO: %s\n' "$*"; }

_require_docker() { command -v docker >/dev/null 2>&1 || _fail "docker not found"; }

# Ensure a usable keypair exists, generating one only when missing or forced.
ensure_key() {
  mkdir -p "$(dirname -- "$KEY")"
  if [ -f "$KEY" ] && [ -f "$KEY.pub" ] && [ "${E2E_TARGET_FORCE_KEY:-0}" != "1" ]; then
    _info "reusing keypair $KEY"
    return 0
  fi
  command -v ssh-keygen >/dev/null 2>&1 || _fail "ssh-keygen not found (needed to generate the target keypair)"
  _info "generating keypair $KEY"
  rm -f "$KEY" "$KEY.pub"
  ssh-keygen -q -t ed25519 -N '' -C "${CONTAINER}" -f "$KEY"
}

# Build the target image, baking the current public key into it.
build_image() {
  ensure_key
  _info "building $IMAGE from $DOCKERFILE"
  docker build \
    -f "$DOCKERFILE" \
    --build-arg "SSH_PUBLIC_KEY=$(cat "$KEY.pub")" \
    -t "$IMAGE" \
    "$REPO_DIR"
}

# Test SSH reachability, used to block until systemd/sshd are ready.
_ssh_ready() {
  ssh -p "$SSH_PORT" -i "$KEY" \
    -o StrictHostKeyChecking=no -o UserKnownHostsFile=/dev/null \
    -o ConnectTimeout=2 \
    "${SSH_USER}@${SSH_HOST}" true >/dev/null 2>&1
}

# Rebuild whenever the image is absent, the baked-in public key changed, or the
# Dockerfile changed. Both the key (a build arg) and the Dockerfile affect the
# produced image, so both are folded into a single content fingerprint stored
# next to the keypair after each successful build. `E2E_TARGET_FORCE_KEY=1`
# rotates the key (and therefore also rebuilds); a manual
# `docker image rm $E2E_TARGET_IMAGE` always forces a rebuild too.
key_fingerprint() { shasum -a 256 "$KEY.pub" 2>/dev/null | awk '{print $1}'; }

dockerfile_fingerprint() { shasum -a 256 "$DOCKERFILE" 2>/dev/null | awk '{print $1}'; }

needs_build() {
  if ! docker image inspect "$IMAGE" >/dev/null 2>&1; then return 0; fi
  # A combined key+Dockerfile marker (written in cmd_up after a build) records
  # exactly what was baked in; a missing marker means a build never recorded one.
  [ -f "${KEY}.keyfp" ] || return 0
  [ "$(cat "${KEY}.keyfp")" = "$(key_fingerprint) $(dockerfile_fingerprint)" ]
}

cmd_up() {
  _require_docker
  ensure_key
  if needs_build; then
    build_image
  fi

  # Record exactly what was baked in, so the next `up` rebuilds on any drift.
  printf '%s %s\n' "$(key_fingerprint)" "$(dockerfile_fingerprint)" > "${KEY}.keyfp"

  if docker ps --format '{{.Names}}' | grep -qx "$CONTAINER"; then
    _info "container $CONTAINER is already running"
  else
    _info "starting $CONTAINER (host $SSH_PORT -> container 22)"
    docker rm -f "$CONTAINER" >/dev/null 2>&1 || true
    docker run -d --name "$CONTAINER" \
      --privileged \
      --cgroupns=host \
      --tmpfs /tmp \
      --tmpfs /run \
      --tmpfs /run/lock \
      -v /sys/fs/cgroup:/sys/fs/cgroup:rw \
      -p "${SSH_PORT}:22" \
      "$IMAGE"
  fi

  _info "waiting for sshd on $SSH_USER@$SSH_HOST:$SSH_PORT"
  local waited=0 deadline=60
  until _ssh_ready; do
    if [ "$waited" -ge "$deadline" ]; then
      _fail "sshd did not become reachable within ${deadline}s (check: docker logs $CONTAINER)"
    fi
    sleep 2
    waited=$((waited + 2))
  done
  _pass "target reachable at $SSH_USER@$SSH_HOST:$SSH_PORT"
}

cmd_stop() {
  _require_docker
  docker stop "$CONTAINER" >/dev/null 2>&1 || _info "container $CONTAINER is not running"
  _pass "target stopped (image + keypair retained)"
}

cmd_down() {
  _require_docker
  docker rm -f "$CONTAINER" >/dev/null 2>&1 || _info "container $CONTAINER does not exist"
  _pass "target removed (image + keypair retained)"
}

cmd_status() {
  _require_docker
  if docker ps --format '{{.Names}}' | grep -qx "$CONTAINER"; then
    _info "container $CONTAINER: running"
    if _ssh_ready; then
      _pass "sshd reachable at $SSH_USER@$SSH_HOST:$SSH_PORT"
    else
      _info "sshd NOT yet reachable (systemd may still be booting)"
    fi
  else
    _info "container $CONTAINER: not running"
    [ -f "$KEY" ] || _info "keypair $KEY: not generated yet"
  fi
}

usage() {
  printf 'usage: %s up|stop|down|status\n' "$0" >&2
  exit 1
}

[ "$#" -eq 1 ] || usage
case "$1" in
  up)     cmd_up ;;
  stop)   cmd_stop ;;
  down)   cmd_down ;;
  status) cmd_status ;;
  *)      usage ;;
esac
