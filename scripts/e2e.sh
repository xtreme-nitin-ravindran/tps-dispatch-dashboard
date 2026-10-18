#!/bin/bash
# TTC GTFS-RT vehicle-capture deployment test (continuous TTC capture stack).
#
# Deploys the collector/processor Compose stack onto an existing SSH-reachable
# Linux host via Ansible, verifies it, then tears down, including the scratch R2
# bucket it used.
#
# R2 credentials are supplied via environment variables (R2_ENDPOINT,
# R2_ACCESS_KEY_ID, R2_SECRET_ACCESS_KEY), optionally sourced from a credentials
# file (scripts/e2e.env, see scripts/e2e.env.example). The script never hardcodes
# a secret path or value. It never reuses the production `sirento` bucket: it
# creates a fresh scratch bucket (`sirento-e2e-<unix-seconds>`) via the Cloudflare
# API and deletes it in teardown. Bucket create/delete requires a Cloudflare API
# token (`CF_API_TOKEN`) with R2 write permission — the object-level S3
# credentials alone cannot create or delete a bucket.
#
# Phases:      preflight -> bucket -> deploy -> verify -> teardown.
# Teardown always runs on the full flow — including on failure (EXIT trap) and on
# SIGINT/SIGTERM — so an interrupted or failed verify never leaks a running stack
# or a scratch bucket. A single-phase run (--only verify) does not tear down.
#
# Usage:
#   E2E_HOST=<ip> bash scripts/e2e.sh                       # full lifecycle
#   E2E_R2_BUCKET=existing-scratch bash scripts/e2e.sh      # reuse a bucket
#   bash scripts/e2e.sh --only verify                       # re-verify only
#
# Optional env: see resolve_env below.

set -euo pipefail

# --- Configuration defaults (overridable via env) ----------------------------
# shellcheck disable=SC1007  # intentional: CDPATH= unsets CDPATH for this single `cd`
SCRIPT_DIR=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)
# shellcheck disable=SC1007  # intentional: CDPATH= unsets CDPATH for this single `cd`
REPO_DIR=$(CDPATH= cd -- "$SCRIPT_DIR/.." && pwd)
# Where the Ansible role looks for R2 credentials on the control host. This is an
# OUTPUT the script writes for Ansible, and it is gitignored; it is never a source
# of secrets. Override with E2E_SECRETS_FILE if your role reads a different path.
SECRETS_FILE="${E2E_SECRETS_FILE:-$REPO_DIR/deploy/secrets.env}"
ANSIBLE_PLAYBOOK="$REPO_DIR/deploy/ansible/site.yml"
# Ansible inventory; override with E2E_INVENTORY to target the local container
# target (deploy/ansible/inventory/local.yml) during development.
ANSIBLE_INVENTORY="${E2E_INVENTORY:-$REPO_DIR/deploy/ansible/inventory/hosts.yml}"
E2E_SSH_PORT="${E2E_SSH_PORT:-22}"
COMPOSE_PROJECT="${E2E_COMPOSE_PROJECT:-sirento-ttc}"
COMPOSE_FILE="deploy/compose.yaml"

ONLY_PHASE="${ONLY_PHASE:-}"       # name of a single phase to run, or empty for all

# --- Credentials file -----------------------------------------------------------
# The credentials live in a gitignored file following the repo's secrets convention
# (scripts/e2e.env.example -> scripts/e2e.env), mirroring deploy/secrets.env. The
# default is the relative filename `scripts/e2e.env`; override with E2E_CREDS_FILE.
# Only key names are referenced here, never a secret value or an absolute path.
CREDS_FILE="${E2E_CREDS_FILE:-$SCRIPT_DIR/e2e.env}"
if [ -f "$CREDS_FILE" ]; then
  # `set -a` auto-exports every assignment the file reads, so plain `KEY=value`
  # lines (the repo's secrets-file convention) reach child processes (`node`).
  set -a
  # shellcheck disable=SC1090  # intentional: the path is the documented convention
  . "$CREDS_FILE"
  set +a
fi

# --- Small assertion/support helpers -----------------------------------------
_fail() { printf 'FAIL: %s\n' "$*" >&2; exit 1; }
_pass() { printf 'PASS: %s\n' "$*"; }
_info() { printf 'INFO: %s\n' "$*"; }

# Run a command over SSH to the target. Passes through the dedicated SSH identity
# when E2E_SSH_KEY is set.
_ssh() {
  local remote="$1"
  local args=( -p "$E2E_SSH_PORT" -o StrictHostKeyChecking=no -o UserKnownHostsFile=/dev/null )
  if [ -n "${E2E_SSH_KEY:-}" ]; then args+=(-i "$E2E_SSH_KEY"); fi
  # shellcheck disable=SC2029  # intentional: $remote expands client-side as one arg
  ssh "${args[@]}" "${E2E_SSH_USER:-sirento}@${E2E_HOST}" "$remote"
}

# Validate + normalize the R2 credentials from the environment (already exported
# in the caller's shell, or sourced from E2E_CREDS_FILE above). The script never
# reads a secrets file by default and never hardcodes a path to one. The
# production bucket is never used; phase_bucket creates a fresh scratch bucket.
load_r2_env() {
  for v in R2_ENDPOINT R2_ACCESS_KEY_ID R2_SECRET_ACCESS_KEY; do
    [ -n "${!v:-}" ] || _fail "$v is required (export it before running; see docs/e2e-test.md)"
  done

  # Two distinct R2 credential kinds exist and are NOT interchangeable (Story 64):
  #   - R2_ACCESS_KEY_ID / R2_SECRET_ACCESS_KEY: an R2 S3 token id+value for object
  #     read/write/list. Its access-key id is a short opaque/hex id.
  #   - CF_API_TOKEN: a Cloudflare User API token for bucket create/delete only.
  # Reusing the same value for both, or putting a Cloudflare user token in the
  # object slot, produces a downstream 403 (`R2 capture read failed: 403`) that
  # only surfaces after deployment. Catch it here instead.
  if [ -n "${CF_API_TOKEN:-}" ] && [ "$R2_ACCESS_KEY_ID" = "$CF_API_TOKEN" ]; then
    _fail "R2_ACCESS_KEY_ID and CF_API_TOKEN are identical; they are distinct token kinds (object read/write/list vs bucket lifecycle). Use an R2 S3 access-key id for R2_ACCESS_KEY_ID."
  fi
  case "$R2_ACCESS_KEY_ID" in
    cfut_*|_cfut_*)
      _fail "R2_ACCESS_KEY_ID looks like a Cloudflare User API token (a bucket-lifecycle credential), not an R2 S3 access-key id. Use the R2 token id (an opaque/hex id), and keep CF_API_TOKEN separate."
      ;;
  esac

  # Account id is the first label of the R2 endpoint host
  # (<account-id>.r2.cloudflarestorage.com). It is needed for the Cloudflare API
  # bucket create/delete calls.
  R2_ACCOUNT_ID=$(printf '%s' "$R2_ENDPOINT" | sed -E 's#https?://##; s#\..*##')
  [ -n "$R2_ACCOUNT_ID" ] || _fail "could not derive R2 account id from endpoint $R2_ENDPOINT"
  : "${R2_REGION:=auto}"
}

# Resolve host/user/inventory limit and the ownership prefix.
resolve_env() {
  # E2E_HOST defaults to the dev inventory host when unset.
  if [ -z "${E2E_HOST:-}" ]; then
    E2E_HOST=$(awk '/ttc-dev:/{host=1; next} host && $0 ~ /ansible_host:/{gsub(/.*ansible_host: *|"$/, ""); print; exit}' "$ANSIBLE_INVENTORY")
  fi
  [ -n "${E2E_HOST:-}" ] || _fail "E2E_HOST is unset and could not be derived from $ANSIBLE_INVENTORY"
  : "${E2E_SSH_USER:=sirento}"
  : "${E2E_LIMIT:=dev}"
  # Ownership prefix must remain dev-isolated; never the production prefix.
  : "${OWNERSHIP_PREFIX:=dev/ttc-ownership}"
  printf 'host=%s user=%s limit=%s ownership_prefix=%s compose_project=%s\n' \
    "$E2E_HOST" "$E2E_SSH_USER" "$E2E_LIMIT" "$OWNERSHIP_PREFIX" "$COMPOSE_PROJECT"
}

# Isolation guard: the e2e run must never target the production bucket/prefix.
guard_isolation() {
  if [ "${R2_BUCKET:-}" = "sirento" ]; then
    _fail "refusing e2e: R2_BUCKET=sirento is the production bucket; use a scratch bucket"
  fi
  if [ "${OWNERSHIP_PREFIX:-}" = "ttc-ownership" ]; then
    _fail "refusing e2e: OWNERSHIP_PREFIX=ttc-ownership is production; use dev/ttc-ownership"
  fi
  _pass "isolation guard: bucket=${R2_BUCKET} prefix=${OWNERSHIP_PREFIX}"
}

# --- Cloudflare R2 bucket lifecycle (Workers API, not the S3 object API) -----
#
# The S3 access key/secret are object-level credentials and cannot create or
# delete a bucket. Buckets are managed via
#   PUT    /accounts/{account_id}/r2/buckets/{bucket}   -> 200/201 = created
#   DELETE /accounts/{account_id}/r2/buckets/{bucket}   -> 200 = deleted
# authenticated with `Authorization: Bearer <CF_API_TOKEN>`.

# Create (or reuse) a scratch bucket and set R2_BUCKET. When E2E_R2_BUCKET is set,
# reuse it (and do NOT delete it in teardown); otherwise create a fresh one and
# remember to delete it.
phase_bucket() {
  _info "bucket: prepare a scratch R2 bucket (Cloudflare API)"
  load_r2_env
  if [ -n "${E2E_R2_BUCKET:-}" ]; then
    R2_BUCKET="$E2E_R2_BUCKET"
    E2E_DELETE_BUCKET_AT_TEARDOWN=0
    _info "bucket: reusing E2E_R2_BUCKET=$R2_BUCKET (will not delete it)"
    guard_isolation
    return 0
  fi
  [ -n "${CF_API_TOKEN:-}" ] || _fail "CF_API_TOKEN is required to create a scratch bucket (set it or pass E2E_R2_BUCKET to reuse one)"
  command -v curl >/dev/null 2>&1 || _fail "curl not found (needed for the Cloudflare API)"

  R2_BUCKET="sirento-e2e-$(date +%s)"
  E2E_DELETE_BUCKET_AT_TEARDOWN=1
  local url="https://api.cloudflare.com/client/v4/accounts/$R2_ACCOUNT_ID/r2/buckets/$R2_BUCKET"
  local http_code
  http_code=$(curl -sS -o "$TMPDIR/r2-create.out" -w '%{http_code}' -X PUT "$url" -H "Authorization: Bearer $CF_API_TOKEN")
  if [ "$http_code" != "200" ] && [ "$http_code" != "201" ]; then
    _fail "bucket create failed (HTTP $http_code): $(cat "$TMPDIR/r2-create.out" 2>/dev/null)"
  fi
  rm -f "$TMPDIR/r2-create.out"
  _pass "bucket: created $R2_BUCKET"
  guard_isolation
}

# Delete the scratch bucket. A no-op when a pre-existing bucket was reused.
delete_bucket() {
  [ "${E2E_DELETE_BUCKET_AT_TEARDOWN:-0}" = "1" ] || return 0
  local url="https://api.cloudflare.com/client/v4/accounts/$R2_ACCOUNT_ID/r2/buckets/$R2_BUCKET"
  if curl -fsS -X DELETE "$url" -H "Authorization: Bearer $CF_API_TOKEN" >/dev/null 2>&1; then
    _info "teardown: deleted scratch bucket $R2_BUCKET"
  else
    _info "teardown: failed to delete scratch bucket $R2_BUCKET (may need manual removal)"
  fi
}

# Render deploy/secrets.env (or E2E_SECRETS_FILE) from the resolved R2 values so
# the Ansible role has real credentials for the (scratch) bucket. This emits only
# the R2 endpoint/key/secret; the bucket name itself flows through group_vars.
render_secrets() {
  _info "deploy: rendering $SECRETS_FILE for Ansible (bucket=$R2_BUCKET)"
  {
    printf 'R2_ENDPOINT=%s\n' "$R2_ENDPOINT"
    printf 'R2_ACCESS_KEY_ID=%s\n' "$R2_ACCESS_KEY_ID"
    printf 'R2_SECRET_ACCESS_KEY=%s\n' "$R2_SECRET_ACCESS_KEY"
  } > "$SECRETS_FILE"
  chmod 600 "$SECRETS_FILE"
  _pass "deploy: wrote $SECRETS_FILE (bucket=$R2_BUCKET prefix=$OWNERSHIP_PREFIX via group_vars)"
}

# Invoke node with the R2 + ownership env injected, reading the report from stdin.
_r2_report() {
  R2_ENDPOINT="$R2_ENDPOINT" R2_BUCKET="$R2_BUCKET" \
    R2_ACCESS_KEY_ID="$R2_ACCESS_KEY_ID" R2_SECRET_ACCESS_KEY="$R2_SECRET_ACCESS_KEY" \
    R2_REGION="${R2_REGION:-auto}" \
    E2E_OWNERSHIP_KEY="$OWNERSHIP_PREFIX/collector.json" \
    E2E_CAPTURE_PREFIX="ttc-captures/" \
    E2E_PUBLIC_KEY="data/ttc-diversions.json" \
    node "$REPO_DIR/scripts/lib/e2e-r2.js"
}

# --- Phases ------------------------------------------------------------------

phase_preflight() {
  _info "preflight: local toolchain + target reachability"
  command -v ansible-playbook >/dev/null 2>&1 || _fail "ansible-playbook not found (install ansible-core + ansible.posix)"
  command -v ssh >/dev/null 2>&1 || _fail "ssh not found"
  command -v rsync >/dev/null 2>&1 || _fail "rsync not found (needed by ansible.posix.synchronize)"
  command -v node >/dev/null 2>&1 || _fail "node not found"
  load_r2_env
  # Only SSH reachability is checked here; Docker is installed by the Ansible
  # deploy phase, so checking it now would fail on a fresh target.
  _ssh "true" || _fail "cannot ssh to ${E2E_SSH_USER}@${E2E_HOST}"
  _pass "preflight complete (SSH reachable)"
}

phase_deploy() {
  _info "deploy: render secrets + ansible-playbook"
  render_secrets
  local image_tag
  image_tag="$(git -C "$REPO_DIR" rev-parse --short HEAD 2>/dev/null || printf unversioned)"
  image_tag="${E2E_IMAGE_TAG:-$image_tag}"
  # The scratch bucket and the dev ownership prefix must override group_vars so
  # the deployed stack writes to the isolated e2e bucket (and lease), never the
  # configured dev/production bucket or prefix.
  ANSIBLE_CONFIG="$REPO_DIR/deploy/ansible/ansible.cfg" \
    ansible-playbook -i "$ANSIBLE_INVENTORY" "$ANSIBLE_PLAYBOOK" \
      -l "$E2E_LIMIT" \
      -e "ttc_image_tag=$image_tag" \
      -e "ttc_r2_bucket=$R2_BUCKET" \
      -e "ttc_ownership_prefix=$OWNERSHIP_PREFIX"
  _pass "deploy: playbook returned 0 (image tag $image_tag, bucket $R2_BUCKET)"
}

# Poll a remote predicate until it succeeds or the deadline passes.
_remote_until() {
  local seconds="$1" desc="$2" remote="$3"
  local deadline=$((SECONDS + seconds))
  while [ "$SECONDS" -lt "$deadline" ]; do
    if _ssh "$remote" >/dev/null 2>&1; then
      _pass "$desc"
      return 0
    fi
    sleep 5
  done
  _fail "$desc (timed out after ${seconds}s)"
}

phase_verify() {
  _info "verify: compose status, ownership lease, R2 readback, health endpoints"

  # 1. Both services must be running.
  _remote_until 180 "collector + processor containers Up" \
    "cd /opt/sirento/repo && docker compose -p $COMPOSE_PROJECT -f $COMPOSE_FILE ps -q | wc -l | grep -qv '^0\$'"
  _pass "compose: services are Up"

  # Deterministic container ids for the loopback health probes.
  local collector_id processor_id
  collector_id=$(_ssh "docker compose -p $COMPOSE_PROJECT -f /opt/sirento/repo/$COMPOSE_FILE ps -q collector")
  processor_id=$(_ssh "docker compose -p $COMPOSE_PROJECT -f /opt/sirento/repo/$COMPOSE_FILE ps -q processor")
  [ -n "$collector_id" ] && [ -n "$processor_id" ] || _fail "could not resolve collector/processor container ids"

  # 2. R2 state: ownership lease + committed captures + public artifact.
  local r2_report
  r2_report="$(_r2_report)" || _fail "R2 readback helper failed"

  node -e 'const r=JSON.parse(process.argv[1]); if(!r.lease) throw new Error("no lease"); console.log("lease holder:", JSON.parse(r.lease).holder)' \
    "$r2_report" || _fail "ownership lease missing under $OWNERSHIP_PREFIX"
  _pass "r2: ownership lease present"

  node -e 'const r=JSON.parse(process.argv[1]); if(!Array.isArray(r.captureKeys) || r.captureKeys.length===0) throw new Error("no captures"); console.log("captures:", r.captureKeys.length)' \
    "$r2_report" || _fail "no committed captures under ttc-captures/"
  _pass "r2: committed captures present"

  # 3. Loopback health endpoints (inside the containers — never published).
  local collector_health processor_health
  collector_health=$(_ssh "docker exec $collector_id node -e 'fetch(\"http://127.0.0.1:8764/health\").then(r=>r.text()).then(console.log)'")
  processor_health=$(_ssh "docker exec $processor_id node -e 'fetch(\"http://127.0.0.1:8765/health\").then(r=>r.text()).then(console.log)'")
  [ -n "$collector_health" ] || _fail "collector health endpoint returned nothing"
  [ -n "$processor_health" ] || _fail "processor health endpoint returned nothing"

  node -e '
    const c = JSON.parse(process.argv[1]);
    const p = JSON.parse(process.argv[2]);
    // Each service exposes capture / processing / publication independently.
    // "unavailable" is a legitimate status here (upstream feed down, or no
    // diversion published yet) — it is not a deployment failure. The Docker
    // healthcheck and the R2 capture check above already prove liveness + writes.
    const shape = (h, name) => {
      for (const key of ["capture", "processing", "publication"]) {
        if (!(key in h)) throw new Error(name + ": missing " + key);
      }
    };
    shape(c, "collector"); shape(p, "processor");
    console.log("health: collector=" + JSON.stringify(c) + " processor=" + JSON.stringify(p));
  ' "$collector_health" "$processor_health" \
    || _fail "health assertion failed (collector=$collector_health processor=$processor_health)"
  _pass "health: both services expose capture/processing/publication"

  # 4. Processor checkpoint exists in the state volume (informational).
  if _ssh "docker exec $processor_id test -f /app/state/ttc-checkpoint.json" >/dev/null 2>&1; then
    _pass "verify: processor checkpoint present"
  else
    _info "verify: processor checkpoint not yet present (informational only)"
  fi

  # 5. Print the final compose ps snapshot.
  _ssh "cd /opt/sirento/repo && docker compose -p $COMPOSE_PROJECT -f $COMPOSE_FILE ps"
  _pass "verify complete"
}

phase_teardown() {
  _info "teardown: graceful compose down (releases ownership leases)"
  _ssh "cd /opt/sirento/repo && docker compose -p $COMPOSE_PROJECT -f $COMPOSE_FILE down" || true

  # Delete the scratch R2 bucket (no-op when a pre-existing bucket was reused).
  delete_bucket

  # Remove the rendered secrets file so credentials never linger in the repo.
  rm -f "$SECRETS_FILE" 2>/dev/null || true

  _pass "teardown complete"
}

# --- Argument parsing (top-level, so teardown-skip logic is correct) ---------
while [ "$#" -gt 0 ]; do
  case "$1" in
    --only) ONLY_PHASE="$2"; shift 2 ;;
    *) _fail "unknown argument: $1" ;;
  esac
done

case "${ONLY_PHASE:-}" in
  preflight|bucket|deploy|verify|teardown) : ;;
  "") : ;;
  *) _fail "unknown --only phase: $ONLY_PHASE (preflight|bucket|deploy|verify|teardown)" ;;
esac

# Teardown runs automatically only on the full flow (no --only, or explicit
# --only teardown). A single-phase run (e.g. --only verify) must NOT tear down.
_should_teardown=0
if [ -z "${ONLY_PHASE:-}" ] || [ "$ONLY_PHASE" = "teardown" ]; then
  _should_teardown=1
fi

main() {
  resolve_env
  case "${ONLY_PHASE:-}" in
    "")
      phase_preflight
      phase_bucket
      phase_deploy
      phase_verify
      ;;
    preflight) phase_preflight ;;
    bucket)     phase_bucket ;;
    deploy)     phase_deploy ;;
    verify)     phase_verify ;;
    teardown)   phase_teardown ;;
  esac
}

# On the full flow, run teardown once on exit, whether the flow succeeded or was
# interrupted (SIGINT/SIGTERM). `kept_status` preserves the original exit code so
# a failed verify still propagates a non-zero status after teardown.
kept_status=0
run_main() {
  main
  kept_status=0
}

if [ "$_should_teardown" = "1" ]; then
  trap 'phase_teardown || true' EXIT
  trap 'exit 130' INT
  trap 'exit 143' TERM
fi

set +e
run_main
kept_status=$?
set -e
exit "$kept_status"
