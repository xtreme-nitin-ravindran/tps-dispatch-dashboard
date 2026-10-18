# SirenTO TTC capture service: validation and deployment entry points.
#
# This Makefile is a thin, convention-only wrapper. Validation delegates to the
# existing npm scripts (the single source of truth for repository checks), and
# deployment delegates to the Ansible playbook under deploy/ansible/. Nothing
# here duplicates a check or a deploy step.
#
# Recipes use real tab indentation (required by make).

SHELL := /bin/sh

ANSIBLE_INVENTORY := deploy/ansible/inventory/hosts.yml
ANSIBLE_PLAYBOOK  := deploy/ansible/site.yml
# Pin the config so `ansible-playbook` picks up host-key-checking and other
# behavior defaults regardless of the caller's working directory.
export ANSIBLE_CONFIG := deploy/ansible/ansible.cfg

# Build/version tag recorded into diagnostic bundles (TTC_BUILD_VERSION).
# Defaults to the current commit; override with `make deploy-dev IMAGE_TAG=...`.
IMAGE_TAG ?= $(shell git rev-parse --short HEAD 2>/dev/null || printf unversioned)

# TTC GTFS-RT vehicle-capture deployment test. Credentials are read from
# scripts/e2e.env by default (gitignored; see scripts/e2e.env.example). Override
# with `make e2e E2E_CREDS_FILE=/path/to/creds`.
E2E_CREDS_FILE ?= scripts/e2e.env

# The Docker-in-systemd SSH target used by `make e2e-local` (see
# deploy/e2e/target.Dockerfile + scripts/lib/e2e-target.sh). These must stay in
# sync with deploy/ansible/inventory/local.yml. Exported so the helper script
# (scripts/lib/e2e-target.sh) and the recipe expansion agree on the same values.
E2E_TARGET_KEY ?= $(HOME)/workspace/tmp/e2e-target_id_ed25519
E2E_TARGET_SSH_PORT ?= 2222
E2E_TARGET_SSH_USER ?= sirento
export E2E_TARGET_KEY E2E_TARGET_SSH_PORT E2E_TARGET_SSH_USER
E2E_INVENTORY_LOCAL := deploy/ansible/inventory/local.yml

.PHONY: help verify verify-fast test lint build deploy deploy-dev deploy-prod down clean e2e e2e-verify e2e-local e2e-target-up e2e-target-down e2e-target-status

help: ## List available targets
	@printf '%s\n' \
	  'verify       Full repository verification (npm run verify)' \
	  'verify-fast  Fast inner-loop verification (npm run verify:fast)' \
	  'test         Canonical offline unit suite (npm test)' \
	  'lint         ESLint + Ruff (npm run lint)' \
	  'build        Build the TTC service images locally' \
	  'deploy       Deploy via Ansible to all inventory hosts' \
	  'deploy-dev   Deploy to the development host (inventory group dev)' \
	  'deploy-prod  Deploy to the production host (inventory group production)' \
	  'e2e          Run the TTC GTFS-RT vehicle-capture deployment test (deploy + verify + teardown)' \
	  'e2e-verify   Verify a running deployment only (no deploy/teardown)' \
	  'e2e-local    Run the e2e test against a throwaway Docker-in-systemd target (build/start/run)' \
	  'e2e-target-up    Build + start the local e2e SSH target container' \
	  'e2e-target-down  Stop + remove the local e2e SSH target container' \
	  'down         Stop the local Compose stack' \
	  'clean        Stop the local Compose stack and remove volumes'

verify:
	npm run verify

verify-fast:
	npm run verify:fast

test:
	npm test

lint:
	npm run lint

build:
	docker compose -f deploy/compose.yaml build

deploy:
	ansible-playbook -i $(ANSIBLE_INVENTORY) $(ANSIBLE_PLAYBOOK) -e ttc_image_tag=$(IMAGE_TAG)

deploy-dev:
	ansible-playbook -i $(ANSIBLE_INVENTORY) $(ANSIBLE_PLAYBOOK) -l dev -e ttc_image_tag=$(IMAGE_TAG)

deploy-prod:
	ansible-playbook -i $(ANSIBLE_INVENTORY) $(ANSIBLE_PLAYBOOK) -l production -e ttc_image_tag=$(IMAGE_TAG)

# TTC GTFS-RT vehicle-capture deployment test. Passes the credentials file
# (default scripts/e2e.env) via E2E_CREDS_FILE; the harness never hardcodes a
# secret path.
e2e:
	E2E_CREDS_FILE=$(E2E_CREDS_FILE) bash scripts/e2e.sh

e2e-verify:
	E2E_CREDS_FILE=$(E2E_CREDS_FILE) bash scripts/e2e.sh --only verify

# Local end-to-end target. Starts the throwaway Docker-in-systemd container (if
# needed), runs the full e2e lifecycle against it, and leaves the container
# running so `e2e-verify`/`e2e-target-down` can be used afterwards. Because the
# preflight SSH check and the Ansible deploy must agree on the same target, the
# E2E_* vars mirror deploy/ansible/inventory/local.yml (127.0.0.1:2222 + the key
# below) rather than the default hosts.yml dev host (192.168.64.20).
e2e-local:
	bash scripts/lib/e2e-target.sh up
	E2E_CREDS_FILE=$(E2E_CREDS_FILE) \
	E2E_INVENTORY=$(E2E_INVENTORY_LOCAL) \
	E2E_HOST=127.0.0.1 \
	E2E_SSH_PORT=$(E2E_TARGET_SSH_PORT) \
	E2E_SSH_USER=$(E2E_TARGET_SSH_USER) \
	E2E_SSH_KEY=$(E2E_TARGET_KEY) \
	bash scripts/e2e.sh

# Standalone lifecycle controls for the local e2e target container.
e2e-target-up:
	bash scripts/lib/e2e-target.sh up

e2e-target-down:
	bash scripts/lib/e2e-target.sh down

e2e-target-status:
	bash scripts/lib/e2e-target.sh status

down:
	docker compose -f deploy/compose.yaml down

clean:
	docker compose -f deploy/compose.yaml down -v
