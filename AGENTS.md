# Repository workflow

- Make code changes on `dev`. Do not commit or push application code directly to `main`.
- `data/current.json` is published by automation to the separate `data` branch. Do not include generated snapshot edits in code commits on `dev`.
- Before committing, run the README Docker unit suites in UTC and America/Los_Angeles, the live-source integration suite, browser JavaScript syntax checks, and `git diff --check`.
- Before considering implementation complete or recommending push or promotion, all required tests must pass and coverage must be exactly 100.00% for lines, branches, and functions. Do not treat passing tests as sufficient when coverage is below 100%. Run the README Docker coverage command before push or promotion when a change can affect covered code, and report any coverage shortfall clearly rather than leaving it for CI to discover.
- Pushes to `dev` are promoted automatically through a protected PR only after required checks pass. Do not bypass branch protection or force push.
- Do not push unless the user authorizes publication. Pull `origin/dev` with fast-forward only before new work, because automatic promotion may advance it.
