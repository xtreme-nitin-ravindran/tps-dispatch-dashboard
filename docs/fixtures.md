# Deterministic fixture URLs

The app accepts deterministic fixture query parameters on loopback origins only
(`localhost`, `127.0.0.1`, `::1`); deployed origins ignore them. They drive the
rendered-browser suites and the local visual-review loop. Loopback origins
bypass the service worker (Story 74 hardening), so every reload serves the
working tree.

## Preview server

```bash
python3 scripts/preview-server.py   # http://localhost:8766 (live public data proxied)
```

Fixtures compose in the same query string, for example:

```
http://localhost:8766/?mobileAuditFixture=many&ttcFixture=affected
```

## Incident audit fixture — `mobileAuditFixture`

| Value | Incident state |
|---|---|
| `many` | full deterministic incident set (the suite default) |
| `zero` | no incidents |
| `stale` | stale snapshot |
| `unavailable` | source unavailable |

Companion parameters (defaults in parentheses):

- `mobileAuditView=map|calls` — mobile start view (`map`)
- `mobileAuditSheet=collapsed|half|expanded` — sheet start state (`collapsed`)
- `mobileAuditLocation=none|current|unavailable|denied|saved|manual` (`none`)
- `mobileAuditRadius=0.5|1|2|5|toronto` — nearby radius (`toronto`)
- `mobileAuditFilters=none|one|multiple|long|service|event|division|history|search|zero` (`none`)
- `mobileAuditRoads=off` — hide the road overlay (default on)
- `mobileAuditBoundaries=off` — hide police boundaries (default on)
- `mobileAuditBoundaryRenderer=svg` — SVG instead of canvas boundary renderer
- `policeBoundaryDebug=1` — boundary lifecycle diagnostics

## TTC fixture — `ttcFixture`

| Value | TTC state |
|---|---|
| `confirmed` | confirmed observed diversion geometry |
| `affected` | subway advisory with ordered affected stops (dashed affected section) |
| `multiple` | a second alert with its own geometry |
| `alert-only` | alerts without observed geometry |
| `expired` | alerts at the end of their active periods |
| `unavailable` | TTC sources unavailable |
| `empty` | zero TTC alerts |
| `official-advisory` | active official Service Change claimed by an observed path |

## UX reliability audit — `mobileAuditUx=reliability`

- `mobileAuditDelay=incident,secondary,map,lazy` — inject deterministic delays
- `uxAudit=1` — performance marks (`sirento:*`) and the audit report panel

## Rendered-browser suites

`npm run test:browser` runs every rendered-browser suite against the
deterministic server on `http://127.0.0.1:8765/`; each suite's query string is
its regression contract. See `docs/browser-tests.md` for setup.

## Visual probe

`node scripts/visual-probe.js` launches headless Chromium against a fixture
URL, clicks a TTC sign marker, and prints the rendered popup geometry — the
visible-acceptance check from Story 74. Run it against the preview server or
the deterministic server; see the script header for usage.
