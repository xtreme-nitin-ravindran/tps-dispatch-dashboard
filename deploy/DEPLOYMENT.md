# Deployment

[Documentation home](../README.md)

Deploys the TTC vehicle-capture **collector** and **processor** as a Docker
Compose stack on a Linux host, using Ansible.

## What it does

Two long-running Node services run together as one Compose project:

| Service | Role | Loopback health port |
|---|---|---|
| `collector` | Polls the TTC vehicle feed (~30 s) and commits spool-first captures to a private R2 prefix | `8764` |
| `processor` | Consumes committed captures, checkpoints state, runs inference/expiry, and publishes `data/ttc-diversions.json` | `8765` |

Each service takes a TTL ownership lease (`<OWNERSHIP_PREFIX>/<role>.json`) so
only one writer runs per role. Health endpoints are loopback-only and never
published. The `ttc-spool` and `ttc-state` volumes persist the spool and
checkpoint across restarts, and `restart: unless-stopped` restarts the services
after a host reboot.

## Prerequisites

**Control host (where you run Ansible):**

- `ansible-core` (`ansible-playbook`) and the `ansible.posix` collection:
  ```sh
  ansible-galaxy collection install -r deploy/ansible/requirements.yml
  ```
- `rsync` (the deploy copies the repository to the target).

**Target host:**

- Ubuntu, SSH-reachable, with a non-root user that has passwordless `sudo`.
- Docker is installed by the playbook; nothing needs to be pre-installed on the
  target beyond SSH + `sudo` + Python 3.

## Secrets

R2 credentials are never committed. Copy the template and fill it in:

```sh
cp deploy/secrets.env.example deploy/secrets.env
# edit deploy/secrets.env with the real R2_ENDPOINT / access key / secret
```

The R2 **bucket** and **ownership prefix** are not secrets and live in
`deploy/ansible/inventory/group_vars/`, so each environment is isolated:

- dev: `ttc_r2_bucket: sirento-dev`, `ttc_ownership_prefix: dev/ttc-ownership`
- production: `ttc_r2_bucket: sirento`, `ttc_ownership_prefix: ttc-ownership`

A development stack **must** use a scratch bucket and a distinct ownership
prefix. Pointing it at the production bucket re-introduces the single-writer
hazard the interlock exists to prevent.

## Deploy

There are two inventories:

- `deploy/ansible/inventory/hosts.yml` — the **real** `dev` and `production`
  hosts (`make deploy-dev` / `make deploy-prod`). Replace the placeholder
  `ansible_host` values with real addresses; keep `ansible_user` matching the
  target account.
- `deploy/ansible/inventory/local.yml` — a throwaway Docker-in-systemd container
  reachable at `127.0.0.1:2222`, used only by the local end-to-end test
  (`make e2e-local`), never for production.

Set the target address in `deploy/ansible/inventory/hosts.yml`, then run:

```sh
make deploy-dev     # the dev host
make deploy-prod    # the production host
```

The playbook installs Docker and the compose plugin, copies the repository to
`/opt/sirento/repo`, renders a Compose `.env`, builds the service images, and
starts the stack.

## Verify

```sh
ssh <user>@<host> 'docker compose -p sirento-ttc -f /opt/sirento/repo/deploy/compose.yaml ps'
```

Each service should report `healthy`. Logs are structured JSON:

```sh
docker compose -p sirento-ttc -f deploy/compose.yaml logs -f
```

The TTC GTFS-RT vehicle-capture test automates this whole flow (target → deploy →
verify → teardown, including a scratch R2 bucket). See [the TTC GTFS-RT
vehicle-capture test](../docs/e2e-test.md).

## Rollback

To return to a previous image with exactly one writer:

```sh
docker compose -p sirento-ttc -f deploy/compose.yaml down
make deploy-dev IMAGE_TAG=<previous-sha>
```

The stale lease expires (default 60 s) and the previous image takes over, so
there is never a second live publisher. The checkpoint is kept in the
`ttc-state` volume.

## R2 retention

Raw captures use a six-hour rolling retention with an hourly cleanup pass (seven
hours maximum physical age). Configure a one-day prefix-scoped R2 lifecycle rule
on the private capture/diagnostic prefixes as an asynchronous safety net. Cleanup
only touches the private `ttc-captures/` and `ttc-diagnostics/` prefixes and must
never be pointed at `data/*` or another project's bucket.
