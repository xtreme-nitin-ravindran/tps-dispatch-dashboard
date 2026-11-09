# homelab deploy handoff — TTC capture stack (Story 79)

[Documentation home](../README.md)

This doc is the **sibling-side record of the cross-repo contract** for the
SirenTO TTC capture stack. The homelab repo's `docs/sirento-ttc.md` is the
operator-side record; the two docs must stay agreed.

## The ownership rule (Story 79, modeled on the signalTO pipeline)

> The app repo owns everything that **builds or runs the product**. homelab owns
> **orchestration, credentials, and host glue**, referencing the app repo only by
> stable contract paths. Nothing in homelab contains app logic; nothing in the
> app repo contains secrets.

Chosen option (recorded in the roadmap): the producer **stays in this repo** as
owned logic; homelab invokes it by contract. The single writer of
`data/ttc-diversions.json` is the continuous capture stack
(`src/ttc/runtime.js` → `buildTtcPublish` → `TTC_GEOMETRY_KEY`). Nothing in this
repo's schedulers, CI, or scripts publishes that key, and nothing in homelab
contains a writer for it (grep evidence recorded in the roadmap).

## Boundary

| Concern | This repo | homelab |
|---|---|---|
| Capture/producer code | `src/ttc/*`, `scripts/ttc-service.js`, `scripts/publish-ttc-geometry.js` (`publicTtcGeometry` — the artifact contract) | — |
| Build definition | `deploy/Dockerfile` (referenced by homelab's compose via `build: { context: /opt/sirento/repo, dockerfile: deploy/Dockerfile }`) | — |
| Runtime definition | — | `infra/sirento/docker-compose.yml` |
| Deploy orchestration | — | `infra/sirento/ansible/` (playbook, role `ttc_service`, inventories, group_vars), `infra/scripts/sirento-deploy.sh` |
| Credentials | — | `infra/scripts/sirento-deploy-bridge.sh` (Vault mirror → `infra/sirento/secrets*.env`, gitignored) |
| Verification | `scripts/lib/e2e-r2.js` (shared readback, imported by contract) | `infra/scripts/sirento-verify.sh`, `infra/scripts/sirento-e2e.sh`, `infra/scripts/lib/e2e-target.sh`, `infra/sirento/e2e/` |
| Consumer | `src/app/app.js` (fetch + render), `test/fixtures/ttc-diversions/` | — |
| Operator record | this doc | `docs/sirento-ttc.md`, `docs/sirento-deploy.md`, `docs/e2e-test.md`, `infra/state-inventory.yaml` |
| Dependabot (ansible) | removed | `homelab/.github/dependabot.yml` (new, watches `infra/sirento/ansible`) |

## Move manifest (what moved, and where)

All homelab-side changes were left **uncommitted** in the homelab working tree
for the operator to review and commit.

| Moved from this repo | Now lives at (homelab) |
|---|---|
| `deploy/compose.yaml` | `infra/sirento/docker-compose.yml` (build context repointed to `/opt/sirento/repo`) |
| `deploy/ansible/` (tree) | `infra/sirento/ansible/` (secrets path + repo-sync source + compose filename adjusted; new tasks: fail when `SIRENTO_REPO` is unset, copy the compose definition to the host) |
| `deploy/env.example`, `deploy/secrets.env.example` | `infra/sirento/env.example`, `infra/sirento/secrets.env.example` |
| `deploy/DEPLOYMENT.md` | `docs/sirento-deploy.md` |
| `deploy/e2e/target.Dockerfile` | `infra/sirento/e2e/target.Dockerfile` |
| `scripts/e2e.sh` | `infra/scripts/sirento-e2e.sh` (app repo addressed via `SIRENTO_REPO`; secrets target `infra/sirento/secrets.env`) |
| `scripts/lib/e2e-target.sh` | `infra/scripts/lib/e2e-target.sh` |
| `scripts/e2e.env.example` | `infra/sirento/e2e.env.example` |
| `docs/e2e-test.md` | `docs/e2e-test.md` |
| Makefile targets `build`/`deploy*`/`e2e*`/`down`/`clean` | replaced by `infra/scripts/sirento-deploy.sh [dev\|production]` (new) |
| `.github/dependabot.yml` `ansible` entry | `homelab/.github/dependabot.yml` (new) |

Edited in homelab (not moved, but repointed): `infra/scripts/sirento-deploy-bridge.sh`
(renders `infra/sirento/secrets*.env`), `infra/scripts/sirento-verify.sh`
(compose path `/opt/sirento/docker-compose.yml`), `docs/sirento-ttc.md`,
`infra/state-inventory.yaml`, `.gitignore` (secrets + e2e env ignores).

Deleted from this repo: everything in the first column, except
`deploy/Dockerfile` (build definition) and `scripts/lib/e2e-r2.js` (shared
readback) which stay by contract.

## Contract paths (both directions)

- homelab → this repo: `$SIRENTO_REPO` (default `~/workspace/tps-dispatch-dashboard`,
  branch `dev`); `deploy/Dockerfile` (build); `scripts/lib/e2e-r2.js` +
  `scripts/lib/publication-sink.js` (readback); `scripts/ttc-service.js`
  (service entrypoint run inside the built image).
- this repo → homelab: none (this repo holds no homelab paths).

## Published artifact contract

`scripts/publish-ttc-geometry.js` (`publicTtcGeometry`) projects the inference
output into the public object the frontend consumes:

```json
{ "schemaVersion": 1, "status": "...", "checkedAt": "...", "diversions": [ ... ] }
```

The frontend fetches it at
`https://data-sirento.nitin.run/data/ttc-diversions.json` and renders confirmed
diversions unchanged. Both sides test against this shape: this repo through
`test/fixtures/ttc-diversions/frontend.js` (which runs `publicTtcGeometry`), the
browser suites, and the offline suites; homelab through `sirento-verify.sh`
(readback of the live object).

## Single-writer enforcement

- `test/ttc-single-writer.test.js` (`[STORY-79]`) machine-enforces, in this
  repo: `TTC_GEOMETRY_KEY` is defined exactly once (`src/ttc/runtime.js`); the
  schedulers and CI (`concourse/`, `.github/`) contain no reference to the key
  outside comments and no `publish-ttc-geometry` step; the projection never
  publishes; the frontend only consumes the key.
- Both-repos grep (Story 79 acceptance evidence): this repo's only writer path
  is `buildTtcPublish`; homelab contains only reads (verify readback),
  documentation, and inventory references — no writer logic.

## What homelab must NOT do in this repo

- **Do not change code here.** Producer code, the artifact contract
  (`publicTtcGeometry`), the build definition (`deploy/Dockerfile`), and the
  consumer are owned by this repo. Any behavior change goes through this repo's
  review/CI on `dev` and reaches homelab only through the contract paths
  (`$SIRENTO_REPO` checkout, `deploy/Dockerfile`, the built image). homelab must
  never patch, copy, or fork this code into its own tree.
- **Do not run tests here** (and do not carry test tooling for this repo).
  Validation runs in this repo: `npm run verify` (Docker test image
  `toronto-dispatch-tests`, exact 100/100/100 coverage) and the rendered-browser
  suites. homelab only *invokes* the shipped entrypoints (`scripts/ttc-service.js`
  inside the built image) and the shared readback (`scripts/lib/e2e-r2.js`) for
  its own deployment verification — those are invocations of owned logic, not
  changes to it or runs of this repo's test suite.
- Reading the checkout, syncing it to the host, and building the image are all
  allowed (that is how the contract works); editing or testing this repo's
  source is not.

## Operator reconciliation checklist (before the next production deploy)

1. Confirm `infra/sirento/ansible/inventory/hosts.yml`: production is set to
   `192.168.18.15` / user `ubuntu` / key
   `~/.homelab/sirento-deploy/id_ed25519` (values documented in
   `docs/sirento-ttc.md`; the committed inventory previously carried
   placeholders, so the live values must be confirmed against the operator's
   working copy).
2. Commit the homelab working tree (see the manifest above).
3. Production cutover (one writer at all times): `docker compose down` on VM 250,
   then `cd ~/workspace/homelab && bash infra/scripts/sirento-deploy.sh production`,
   then `bash infra/scripts/sirento-verify.sh production`. The project name and
   volumes (`sirento-ttc`) are preserved; only the compose file location changed
   (`/opt/sirento/repo/deploy/compose.yaml` → `/opt/sirento/docker-compose.yml`).
4. **Production hotfix redeploy:** after the first cutover the processor
   wedged on a pre-existing persistence id-duplication rejection
   (`Invalid TTC diversion output: identity`), fixed in this repo after
   the cutover (see the roadmap Story 79 production-acceptance note).
   Redeploy with the fixed checkout:
   `bash infra/scripts/sirento-deploy.sh production` — the role syncs
   the app repo and rebuilds the image, so the fix reaches the stack
   without any manual state surgery. The processor then resumes from
   checkpoint cursor 179 and replays the oldest retained captures.
5. The e2e harness (scratch bucket `rotato-e2e-scratch`) now runs from homelab:
   `bash infra/scripts/lib/e2e-target.sh up` then `sirento-e2e.sh` with the
   `local.yml` inventory (see homelab `docs/e2e-test.md`).
