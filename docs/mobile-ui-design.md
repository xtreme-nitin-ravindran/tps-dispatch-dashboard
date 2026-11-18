# Mobile UI refresh

Review one mobile screen at a time and record decisions as each UI element is reviewed. Keep the desktop layout and existing functionality intact.

## Startup screen

- Keep the current map-first startup layout.
- Use Spaghetti’s stationary photo as a circle with a blinking red outline. Overlap the bottom-right edge with the blinking siren GIF. With reduced motion enabled, the outline and siren stay steady.

### UI element inventory

Record each control alongside the existing surface it opens or updates. Reuse that surface as we review later screens. Confirm any proposed new panel or popup during design review.

| Startup element | Existing surface or action |
| --- | --- |
| Siren button | Opens **What’s happening near me?**. The same button becomes **×** to close it. |
| Fullscreen button | Expands the current map. The same button exits fullscreen. |
| Layers button | Opens the existing Map layers disclosure for police divisions, road closures, and TTC disruptions. |
| Map / Calls / Disruptions | Stays visible in a sticky second row below the siren or Nearby header. Each button opens its own view at the top and highlights the active choice. Selecting a view closes Nearby if it is open. |
| Feed warning | Shows stale or unavailable incident data when applicable. |
| Map and zoom controls | Navigate the existing map. Marker details use the existing map popup controller. |
| Calls summary and handle | Expand or collapse the existing calls sheet. |

## Disruptions view

Reuse the existing **Road & transit disruptions** panel and its road and TTC disclosures as a dedicated mobile view. The incident list belongs to Calls, and the map and its calls sheet belong to Map.

## Nearby panel

| Control | Existing surface or action |
| --- | --- |
| Centered × | Replaces the startup siren in the same position. Stays visible while scrolling and closes the whole Nearby panel in one tap. |
| Spaghetti, SirenTO, and theme selector | Share the top row whenever Nearby is open. The startup siren appears by itself. |
| Nearby screen | Covers the mobile viewport. The map, calls sheet, and background controls are hidden and unavailable while Nearby is open. The location card shows the heading, Use my location, and location feedback when needed. |
| Down and up arrows | Reveal and collapse Search and Filters within Nearby. |
| Search | Fills its own row. The bold applied-filter summary sits immediately below. |
| Filters disclosure | Fills a separate row below the summary. The applied count sits beside the label, and the right chevron points down when closed and up when open. Reveals police division, history, service, event type, and distance. The five dropdowns are grouped in one full-width stack, with accessible names and selected values as their visible text. Clear filters and Share view retain their existing actions. |

## Map panels

Map info and Map layers share header typography, a 44 px close button, spacing, borders, and line samples. Map info groups coverage, source updates and timestamp help, map layers, call markers, location and source, and call age. Map layers keeps the existing checkboxes and layer state. Police division boundaries are dashed purple on the map and in both panels.

Both popups use **Police division**, **Road closures**, and **TTC disruptions**. TTC uses a shared legend with a dashed **Affected section** sample and a solid **Diversion** sample. Both samples stay visible with the overlay off or when no TTC geometry is available. The overlay checkbox is disabled when there is no geometry.

## Mobile calls sheet

The calls summary opens and closes one scrollable list. Selecting a call pin opens its bubble and highlights its matching card. Expanding the sheet reveals that selected card, without changing selection or opening another panel. Selecting a mapped call card switches to the existing Map view, centers its pin, and opens its bubble. Inline details and Share remain separate actions.

Calls and disruptions share a single active map selection: choosing either clears the previous bubble and highlight. Road and TTC selections move the matching existing list into the same bottom sheet, highlight and reveal its selected item, and label the sheet for disruptions. Calls selection restores the existing calls list. Switching to Disruptions restores both original lists to that view. Selecting a mapped disruption card switches to Map and opens its bubble. Mobile disruption bubbles stay inside the visible map and scroll internally when needed; route-fitting must not move a bubble off-screen after it opens. No new panels or back buttons.

## Temporary homelab preview

Whenever `src/app/app.js` is updated in the temporary preview, download the latest public `current.json` and companion `ttc-diversions.json`, validate them, and replace the preview’s saved feeds. Serve both from the app’s origin. Keep the previous files if either download or validation fails. These preview copies are deployment data, not generated snapshot edits to commit on `dev`.

## Feed warnings

Use one shared amber warning button across Map, Calls, Disruptions, and the calls sheet instead of repeated stale-feed banners. Its non-modal Feed status popover lists affected TFS, TPS, road, and TTC sources. It starts collapsed; tapping opens it with a gently pulsing border for 25 seconds, then closes it. The close button, Escape, or an outside tap dismisses it early. The amber indicator stays visible until all sources recover. Respect reduced motion and keep the control clear of Nearby’s theme selector and fullscreen map controls.

Opening Map layers clears the active call or disruption, closes its bubble, removes its pin/list highlight, and collapses the bottom sheet. Closing Layers leaves the sheet collapsed and no selection.
Selecting a call, road closure, or TTC pin closes Map layers before opening its bubble and highlighting its result. This does not reopen the bottom sheet.
