# TTC GTFS-RT vehicle-capture test

[Documentation home](../README.md)

A host-level, repeatable test of the TTC GTFS-RT vehicle-capture deployment:
deploy the collector/processor Compose stack via Ansible onto an existing
SSH-reachable Linux host, verify it healthy and that it has written durable
evidence, and tear it down cleanly.

The harness is **host-level** (it drives `ssh`/`ansible-playbook`), so it is **not**
part of the Docker test image, the CI suite, `npm run verify`, or the browser
suites. It is a deployment test, not a unit test.

## Prerequisites

**Control host:**

- `ansible-core` (`ansible-playbook`) and the `ansible.posix` collection:
  ```sh
  ansible-galaxy collection install -r deploy/ansible/requirements.yml
  ```
- `rsync` (both control and target — `ansible.posix.synchronize` needs it).
- `ssh`, `node` (for the readback helper).

**Target host:**

- Ubuntu, SSH-reachable as `sirento` with key auth. The Ansible role installs
  Docker CE + the compose plugin idempotently.

For a throwaway local target, use the SSH-enabled container in
`deploy/e2e/target.Dockerfile` (systemd + sshd + a nested `dockerd`) and the
`local.yml` inventory. The simplest way is the one-command shortcut
`make e2e-local`, which builds/starts that container and runs the full e2e
lifecycle against it:

```sh
make e2e-local
```

To manage the target container by hand instead:

```sh
make e2e-target-up      # build + start the systemd/sshd container (host 2222 -> 22)
make e2e-target-status  # is it running, and is sshd reachable?
make e2e-target-down    # stop + remove the container
```

These wrap `scripts/lib/e2e-target.sh`, which generates a keypair at
`~/workspace/tmp/e2e-target_id_ed25519` (the path
`deploy/ansible/inventory/local.yml` expects) and bakes its public key into the
image (`SSH_PUBLIC_KEY`). The target is reached over SSH at `127.0.0.1:2222` as
`sirento`, matching `deploy/ansible/inventory/local.yml`. `E2E_TARGET_KEY`,
`E2E_TARGET_SSH_PORT`, and `E2E_TARGET_SSH_USER` override those defaults if you
need a different key/port/user (keep them in sync with `local.yml`).

**R2 (required for deploy + verify):**

The services fail loudly without R2 credentials, and the harness asserts durable
evidence directly against R2. Credentials are supplied via a gitignored file
following the repo's secrets convention:

```sh
cp scripts/e2e.env.example scripts/e2e.env   # gitignored
# edit scripts/e2e.env with the real R2 values
```

Only `scripts/e2e.env.example` (placeholders) is committed. The keys it exports:

```sh
R2_ENDPOINT=https://<account-id>.r2.cloudflarestorage.com
R2_ACCESS_KEY_ID=<r2-s3-access-key-id>
R2_SECRET_ACCESS_KEY=<r2-s3-access-key-secret>
R2_REGION=auto
```

> **One credential kind.**
>
> `R2_ACCESS_KEY_ID` / `R2_SECRET_ACCESS_KEY` is an **R2 S3 API token**
>   (id + value) used for object **read/write/list**, scoped to the scratch bucket
>   (`rotato-e2e-scratch`). Create it in the Cloudflare dashboard under **R2 →
>   Manage R2 API Tokens** with Read + Write + List permissions, restricted to that
>   single bucket. No Cloudflare admin API token is needed — the harness never
>   creates or deletes a bucket, so it never calls the Cloudflare API.
>
> Putting a Cloudflare *user* token (`cfut_...`) in the object slot yields a
>   downstream `R2 capture read failed: 403` after deployment. The harness's
>   preflight rejects that misconfiguration up front (see "Failure diagnosis").

The harness briefly writes `R2_ENDPOINT`/`R2_ACCESS_KEY_ID`/
`R2_SECRET_ACCESS_KEY` to the gitignored Ansible secrets file (`deploy/secrets.env`,
overridable with `E2E_SECRETS_FILE`) so the role can render the Compose `.env`, then
removes it during teardown.

**Scratch bucket (fixed, emptied before each run):**

The harness never reuses the production `sirento` bucket. It uses a fixed scratch
bucket `rotato-e2e-scratch` (overridable with `E2E_R2_BUCKET`) and empties it
before each run via the R2 S3 object creds — it never creates or deletes a
bucket, so no `CF_API_TOKEN` is needed. Teardown empties the bucket again on a
successful run by default (keep records for sampling with `E2E_KEEP_RECORDS=1`),
and keeps records on a failed run by default (empty anyway with
`E2E_DELETE_ON_FAILURE=1`). The harness **refuses** to run if the
resolved bucket is `sirento` or the ownership prefix is `ttc-ownership`
(production), preserving the single-writer isolation contract.

## Running it

### Run it locally (one command)

From the repository root, with your `scripts/e2e.env` credentials in place:

```sh
make e2e-local
```

That is the whole local workflow. It (1) builds and starts a throwaway
Docker-in-systemd container that acts as a Linux host, (2) runs the full
deploy → verify → teardown against it, and (3) leaves the container running so
you can re-verify or tear it down afterwards (see below).

To manage that container between runs:

```sh
make e2e-target-status   # running? sshd reachable?
make e2e-target-down     # stop + remove it when done
```

`make e2e-local` sources `scripts/e2e.env` (set `E2E_CREDS_FILE` to override),
points the SSH preflight + Ansible deploy at `127.0.0.1:2222` via
`deploy/ansible/inventory/local.yml`, and uses the keypair under
`~/workspace/tmp/` that `scripts/lib/e2e-target.sh` generates on first use.

### Full flow against any SSH host (deploy → verify → teardown)

```sh
export E2E_HOST=<ip>                    # any SSH-reachable Linux host
export E2E_CREDS_FILE=scripts/e2e.env   # cf. scripts/e2e.env.example
bash scripts/e2e.sh
```

The full flow (local or remote) empties the fixed scratch bucket, deploys via
Ansible, verifies, then tears down: it stops the stack and empties the bucket
on success (keep records with `E2E_KEEP_RECORDS=1`). On failure teardown keeps
the records by default so you can sample them; set `E2E_DELETE_ON_FAILURE=1` to
empty them anyway. Teardown runs automatically at the end (and on failure/Ctrl-C),
so nothing is left behind.

### Re-verify a running stack (no re-deploy, no teardown)

```sh
bash scripts/e2e.sh --only verify
```

## Environment variables

| Var | Default | Meaning |
|---|---|---|
| `E2E_HOST` | dev inventory host | target IP/hostname |
| `E2E_SSH_USER` | `sirento` | SSH user |
| `E2E_SSH_KEY` | (none) | SSH identity (`-i`) |
| `E2E_SSH_PORT` | `22` | SSH port |
| `E2E_INVENTORY` | `deploy/ansible/inventory/hosts.yml` | Ansible inventory (`local.yml` for the local target) |
| `E2E_LIMIT` | `dev` | Ansible `-l` limit |
| `E2E_COMPOSE_PROJECT` | `sirento-ttc` | Compose project name |
| `E2E_IMAGE_TAG` | current commit | `ttc_image_tag` passed to Ansible |
| `R2_ENDPOINT` / `R2_ACCESS_KEY_ID` / `R2_SECRET_ACCESS_KEY` / `R2_REGION` | (required) / `auto` | R2 sink + readback (env only) |
| `E2E_R2_BUCKET` | `rotato-e2e-scratch` | fixed scratch bucket to empty and run against |
| `E2E_KEEP_RECORDS` | unset | when `1`, teardown keeps records on success (sampling) |
| `E2E_DELETE_ON_FAILURE` | unset | when `1`, teardown empties records even on a failed run (testing) |
| `E2E_SECRETS_FILE` | `deploy/secrets.env` | output path Ansible reads; removed in teardown |
| `E2E_CREDS_FILE` | `scripts/e2e.env` | credentials file to source (see `scripts/e2e.env.example`) |
| `OWNERSHIP_PREFIX` | `dev/ttc-ownership` | ownership-lease prefix (dev-isolated) |
| `E2E_TARGET_KEY` | `~/workspace/tmp/e2e-target_id_ed25519` | target-container keypair (`scripts/lib/e2e-target.sh`) |
| `E2E_TARGET_SSH_PORT` / `E2E_TARGET_SSH_USER` | `2222` / `sirento` | target-container SSH port/user (keep in sync with `local.yml`) |

## What it verifies

1. **Preflight** — local `ansible-playbook`/`ssh`/`rsync`/`node`, the R2 env, the
   isolation guard, SSH reachability, and Docker/compose on the target.
2. **Prepare scratch bucket** — resolves `rotato-e2e-scratch` (or `E2E_R2_BUCKET`)
   and empties it via the R2 S3 object creds.
3. **Compose up** — both `collector` and `processor` containers are `Up`.
4. **Ownership lease** — `dev/ttc-ownership/collector.json` exists in R2 (the
   collector acquired it to run; proof the interlock is active).
5. **Durable captures** — committed capture objects exist under `ttc-captures/`
   (proof of real writes, not just a live process). The lease and first capture
   are read together with a bounded poll (up to ~3 min) so the readback absorbs
   the collector's lease-acquire-then-first-poll gap instead of racing it.
6. **Loopback health** — `GET :8764/health` and `:8765/health` (inside each
   container, never published) return `ok`-or-`degraded` status for capture /
   processing / publication, and `publication` is **not** `unavailable` (R2
   reachable). Zero results is a valid status and is **not** treated as failure.
7. **Teardown** — `docker compose down` (graceful lease release), empties the
   scratch bucket on success (or keeps it with `E2E_KEEP_RECORDS=1`), removes the
   rendered secrets file. On failure the bucket is kept by default (set
   `E2E_DELETE_ON_FAILURE=1` to empty it instead).

## Failure diagnosis

- **"R2 endpoint/access-key/secret is required"** — one of `R2_ENDPOINT` /
  `R2_ACCESS_KEY_ID` / `R2_SECRET_ACCESS_KEY` is not exported in your shell.
- **"R2_ACCESS_KEY_ID looks like a Cloudflare User API token"** — the object
  slot was filled with a Cloudflare user token (`cfut_...`), which cannot do R2
  object read/write/list. Put a real R2 S3 access-key id (scoped to the scratch
  bucket) there instead.
- **"R2 capture read failed: 403" (in the collector logs)** — the R2 object
  credential has no read permission on the scratch bucket (or is a user token in
  the object slot). Re-check `R2_ACCESS_KEY_ID`/`R2_SECRET_ACCESS_KEY` are an R2
  S3 token with Read + Write + List access, scoped to the scratch bucket
  (`rotato-e2e-scratch`).
- **"R2 capture list failed" / "R2 capture delete failed" (during prepare)** —
  the R2 object credential lacks List or Write permission on the scratch bucket.
  Re-check the token is an R2 S3 token with Read + Write + List access scoped to
  the scratch bucket.
- **"no committed captures"** — the collector is up but not committing; check
  the collector logs (`docker compose -p sirento-ttc -f deploy/compose.yaml logs
  collector`) for a feed/credential error, and inspect `TTC_INTERVAL_MS`.
- **"publication unavailable"** — R2 is unreachable from the processor; re-check
  the rendered `deploy/.env` (bucket/region) and network egress.
- **"ownership lease missing"** — the collector exited before acquiring (check
  `deploy/.env` for a missing/blank `OWNERSHIP_PREFIX` or R2 misconfiguration).

## Validation notes

- `bash -n scripts/e2e.sh` and `node --check scripts/lib/e2e-r2.js` are
  the syntax checks.
- The harness itself is **not** run under the Docker test image or `npm run
  verify`; it is a host-level orchestration requiring a live host + R2 credentials.
- No new unit-testable pure logic was added (the R2 helper is a thin composition
  of already-covered factories), so no new `test/*.test.js` or
  `test/requirements.map.json` entry is required.
