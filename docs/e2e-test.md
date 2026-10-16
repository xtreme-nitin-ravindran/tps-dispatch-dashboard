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
`deploy/e2e/target.Dockerfile` (systemd + sshd) and the `local.yml` inventory.

**R2 (required for deploy + verify):**

The services fail loudly without R2 credentials, and the harness asserts durable
evidence directly against R2. Credentials are supplied via a gitignored file
following the repo's secrets convention:

```sh
cp scripts/e2e.env.example scripts/e2e.env   # gitignored
# edit scripts/e2e.env with the real R2 values + CF_API_TOKEN
```

Only `scripts/e2e.env.example` (placeholders) is committed. The keys it exports:

```sh
R2_ENDPOINT=https://<account-id>.r2.cloudflarestorage.com
R2_ACCESS_KEY_ID=<object-level-access-key-id>
R2_SECRET_ACCESS_KEY=<object-level-secret-access-key>
R2_REGION=auto
CF_API_TOKEN=<cloudflare-api-token-with-r2-write-permission>
```

The harness briefly writes `R2_ENDPOINT`/`R2_ACCESS_KEY_ID`/
`R2_SECRET_ACCESS_KEY` to the gitignored Ansible secrets file (`deploy/secrets.env`,
overridable with `E2E_SECRETS_FILE`) so the role can render the Compose `.env`, then
removes it during teardown.

**Scratch bucket (created and deleted automatically):**

The harness never reuses the production `sirento` bucket. It creates a fresh
`sirento-e2e-<unix-seconds>` bucket via the Cloudflare API and deletes it in
teardown. Bucket create/delete needs `CF_API_TOKEN` (the S3 object-level creds
cannot create/delete a bucket). Alternatively, to reuse a pre-provisioned scratch
bucket and skip create/delete, set `E2E_R2_BUCKET=my-scratch-bucket` instead of
`CF_API_TOKEN`. The harness **refuses** to run if the resolved bucket is `sirento`
or the ownership prefix is `ttc-ownership` (production), preserving the
single-writer isolation contract.

## Running it

### Full flow (deploy → verify → teardown)

```sh
export E2E_HOST=<ip>                    # any SSH-reachable Linux host
export E2E_CREDS_FILE=scripts/e2e.env   # cf. scripts/e2e.env.example
bash scripts/e2e.sh
```

It creates a scratch bucket, deploys via Ansible, verifies, then tears down: it
stops the stack and deletes the scratch bucket. Teardown runs automatically at the
end (and on failure/Ctrl-C), so nothing is left behind.

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
| `E2E_LIMIT` | `dev` | Ansible `-l` limit |
| `E2E_COMPOSE_PROJECT` | `sirento-ttc` | Compose project name |
| `E2E_IMAGE_TAG` | current commit | `ttc_image_tag` passed to Ansible |
| `R2_ENDPOINT` / `R2_ACCESS_KEY_ID` / `R2_SECRET_ACCESS_KEY` / `R2_REGION` | (required) / `auto` | R2 sink + readback (env only) |
| `CF_API_TOKEN` | (required to create a bucket) | Cloudflare API token for bucket create/delete |
| `E2E_R2_BUCKET` | (generated) | reuse a pre-existing scratch bucket instead of creating one |
| `E2E_SECRETS_FILE` | `deploy/secrets.env` | output path Ansible reads; removed in teardown |
| `E2E_CREDS_FILE` | `scripts/e2e.env` | credentials file to source (see `scripts/e2e.env.example`) |
| `OWNERSHIP_PREFIX` | `dev/ttc-ownership` | ownership-lease prefix (dev-isolated) |

## What it verifies

1. **Preflight** — local `ansible-playbook`/`ssh`/`rsync`/`node`, the R2 env, the
   isolation guard, SSH reachability, and Docker/compose on the target.
2. **Scratch bucket** — creates `sirento-e2e-<ts>` (or reuses `E2E_R2_BUCKET`).
3. **Compose up** — both `collector` and `processor` containers are `Up`.
4. **Ownership lease** — `dev/ttc-ownership/collector.json` exists in R2 (the
   collector acquired it to run; proof the interlock is active).
5. **Durable captures** — committed capture objects exist under `ttc-captures/`
   (proof of real writes, not just a live process).
6. **Loopback health** — `GET :8764/health` and `:8765/health` (inside each
   container, never published) return `ok`-or-`degraded` status for capture /
   processing / publication, and `publication` is **not** `unavailable` (R2
   reachable). Zero results is a valid status and is **not** treated as failure.
7. **Teardown** — `docker compose down` (graceful lease release), deletes the
   scratch bucket, and removes the rendered secrets file.

## Failure diagnosis

- **"R2 endpoint/access-key/secret is required"** — one of `R2_ENDPOINT` /
  `R2_ACCESS_KEY_ID` / `R2_SECRET_ACCESS_KEY` is not exported in your shell.
- **"CF_API_TOKEN is required to create a scratch bucket"** — no Cloudflare API
  token was exported. Export one with R2 write permission, or set
  `E2E_R2_BUCKET=<existing-scratch>` to reuse a pre-provisioned bucket.
- **"could not derive R2 account id"** — `R2_ENDPOINT` does not look like
  `<account-id>.r2.cloudflarestorage.com`.
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
