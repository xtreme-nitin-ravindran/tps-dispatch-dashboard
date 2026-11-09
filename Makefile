# SirenTO repository: validation entry points.
#
# This Makefile is a thin, convention-only wrapper. Validation delegates to the
# existing npm scripts (the single source of truth for repository checks).
# Nothing here duplicates a check.
#
# The TTC capture deployment (Ansible + Compose + the e2e deploy test) moved to
# the homelab repo in Story 79 (single-writer ownership); homelab owns
# orchestration, credentials, and host glue, and this repo owns the producer
# code, the build definition (deploy/Dockerfile), and the consumer. See
# docs/homelab-deploy-handoff.md and the homelab repo's docs/sirento-ttc.md.
#
# Recipes use real tab indentation (required by make).

SHELL := /bin/sh

.PHONY: help verify verify-fast test lint

help: ## List available targets
	@printf '%s\n' \
	  'verify       Full repository verification (npm run verify)' \
	  'verify-fast  Fast inner-loop verification (npm run verify:fast)' \
	  'test         Canonical offline unit suite (npm test)' \
	  'lint         ESLint + Ruff (npm run lint)'

verify:
	npm run verify

verify-fast:
	npm run verify:fast

test:
	npm test

lint:
	npm run lint
