# Agent work log

Running log of what the agent is doing, newest entry on top. One entry per work
session or meaningful change. Keep it short: what was worked on, what changed, what's
next, and any blockers.

## 2026-09-26 — Story 37 production verification

- Verified Story 37 is promoted and deployed to production.
- `dev` and `main` are identical at `2811765d` (Merge PR #61). Promotion complete.
- Deployed asset hashes match the Story 37 commit `a5a317da`:
  - `styles.css` `f924c5f4` = `a5a317da` ✅
  - `app.js` `0d2520ae` = `a5a317da` ✅
  - `index.html` `f567c441` = current HEAD `2811765d` (only diff from 37 is the
    `brand-dog.jpg` → `brand-spaghetti.jpg` rename in the license commit) ✅
- Production `https://sirento.nitin.run/` serves the Story 37 UI: `nearby-feature`,
  `radius-controls`, `mobile-bottom-sheet`, collapsed `map-info`, `disruptions-panel`.
- **Resolved the "HEAD mismatch":** `a4fdefcc42662d5d9c29f241aa92006cbf67b31e` is an
  orphaned/superseded commit — it exists in the object DB but is contained by no branch
  and is not an ancestor of HEAD. The real Story 37 commit is `a5a317da`. The earlier
  summary tracked the wrong hash; disregard `a4fdefcc`.
- **Not verifiable from the agent environment (manual, on-device):** mobile layout at
  390px, Map/Calls switching, Filters collapse, TTC reachability in Calls, DevTools
  console errors, and iPhone Safari/Brave portrait/landscape/rotation/standalone/perf.
- **Next:** user runs the on-device acceptance checks, or we move to parked product
  stories 34 / 35 / 36.
- **Blockers:** none.
