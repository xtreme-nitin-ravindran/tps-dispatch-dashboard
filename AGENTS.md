# Repository workflow

- Make code changes on `dev`. Do not commit or push application code directly to `main`.
- `data/current.json` is published by automation to the separate `data` branch. Do not include generated snapshot edits in code commits on `dev`.
- Before committing, run the README Docker unit suites in UTC and America/Los_Angeles, the live-source integration suite, browser JavaScript syntax checks, and `git diff --check`.
- Pushes to `dev` are promoted automatically through a protected PR only after required checks pass. Do not bypass branch protection or force push.
- Do not push unless the user authorizes publication. Pull `origin/dev` with fast-forward only before new work, because automatic promotion may advance it.
