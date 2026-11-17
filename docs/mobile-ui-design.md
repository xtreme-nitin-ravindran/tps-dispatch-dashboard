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

The calls summary opens and closes one scrollable list. Map pins, road closures, and TTC disruptions open their map bubbles independently of the calls sheet. Call cards in the sheet keep their inline details and Share action.
