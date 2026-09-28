# Story 38C — bounded incident rendering

Story 38C bounds only the incident-card DOM. The complete filtered result remains
available to counts, summaries, map markers/clusters, filtering, search, and sorting.
The police-boundary renderer and TTC behavior are unchanged.

## Pipeline audit

Before this story, `applyFilters` filtered the complete normalized snapshot and
`renderCalls` sorted every match, cloned a card for every call into one fragment, and
replaced `#callList` in a single commit. Toronto-wide therefore created all 1,212
fixture cards immediately. Radius, history, service, event, division, search, sort,
online/offline rerenders, and snapshot changes could rebuild the full list.

Map and Calls share one `#callList`. On narrow layouts it is physically reparented
between the Calls panel and the map bottom sheet. Selection normally updates rows in
place and marker appearance; it does not require a list rebuild. A deep-link restore
can first reset filters and therefore legitimately rebuild the result.

The invalidating inputs are now represented by two cheap keys:

- Filter computation: incident dataset revision, radius, location, service, event
  type, division, history window, and search.
- Card output: the filter key, sort, online state, and relevant source availability.

Unchanged keys reuse the computed result/card output. Explicit event guards also
return early for the active radius, sort, Map/Calls view, history, service, event,
division, and search values. Dataset revision is incremented only when the existing
snapshot comparison reports changed calls; no new deep comparison was added.

## Bounded rendering strategy

The initial and subsequent batch size is **40 cards**. Forty gives several mobile
screens of immediately useful results while reducing the heavy fixture's initial card
and descendant DOM to about 3.3% of the former size. It is deterministic across the
Calls panel and map sheet because both surfaces continue to own the same bounded list.

An accessible **Show 40 more calls** button appends the next ordered slice on the next
animation frame. Each click is bounded; it never renders the entire remainder. Filter,
search, and sort changes reset the window. Existing IDs prevent duplicates. If a
selected incident lies outside the window, one selected card is surfaced separately
at the top; when its normal batch is reached, that existing node is moved into its
ordered position instead of being cloned. Map → Calls → Map selection remains intact.

The Story 38B global loading state ends when the initial usable batch is committed.
Later batches use only the button's local loading label and never restore a global
loading state.

## Measurements

Measurements use the production path, the deterministic 1,212-call fixture, Chromium,
and `performance.now()`. Browser timings vary by machine and run; these figures are
the captured comparison, not performance budgets.

| Metric | Before (38A) | After (38C) |
| --- | ---: | ---: |
| Cards created initially | 1,212 | 40 |
| Initial card render | 63.3 ms cold | 3.4 ms |
| No-op Toronto-wide click | 92.4 ms | 0.1 ms |
| Incident cards in DOM | 1,212 | 40 |
| Descendants inside `#callList` | Not captured in 38A | 1,804 |
| Next batch | n/a | 40 cards in 3.4 ms |

After one next-batch request the list contained 80 cards and 3,604 descendants. The
subsequent no-op Toronto-wide click left both the filter-calculation count and incident
render-pass count unchanged and preserved all 80 cards.

## Deterministic fixture URLs

These remain loopback-only and use production render paths:

- Toronto-wide heavy list:
  `/?mobileAuditFixture=many&mobileAuditUx=reliability&mobileAuditRadius=toronto&mobileAuditView=calls&uxAudit=1`
- Selected incident deep in the result set:
  `/?mobileAuditFixture=many&mobileAuditUx=reliability&mobileAuditRadius=toronto&mobileAuditView=calls&view=1&incident=mobile-audit-heavy-1079&uxAudit=1`
- Search narrowing the heavy list:
  `/?mobileAuditFixture=many&mobileAuditUx=reliability&mobileAuditRadius=toronto&mobileAuditView=calls&mobileAuditFilters=search&uxAudit=1`
- Filter change: open the heavy-list URL and change Service or Event type.
- No-op radius: open the heavy-list URL and press Toronto-wide again.
- Repeated sort/filter selection: use
  `/?mobileAuditFixture=many&mobileAuditUx=reliability&mobileAuditRadius=2&mobileAuditLocation=current&mobileAuditView=calls&uxAudit=1`,
  choose a sort/filter value, then choose the same value again.

Observed checks: deep selection produced 41 cards, exactly one matching selected ID,
and one surfaced card; a search with 106 results rendered 40 cards; clearing it reset
the result to 1,212 while still rendering only 40; loading state remained `ready` during
progressive rendering.
