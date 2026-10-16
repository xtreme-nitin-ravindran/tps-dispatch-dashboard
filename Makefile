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

.PHONY: help verify verify-fast test lint build deploy deploy-dev deploy-prod down clean e2e e2e-verify

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

down:
	docker compose -f deploy/compose.yaml down

clean:
	docker compose -f deploy/compose.yaml down -v
