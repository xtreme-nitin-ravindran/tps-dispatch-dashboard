// One controller for every Leaflet popup on the dispatch map.
//
// Leaflet removes a popup container only when its fade transition ends, so
// rapid selections can briefly stack fading bubbles. Every open path here
// closes and drops lingering wrappers first, which makes the single-bubble
// contract deterministic (Story 74). All four popup surfaces — road closures,
// TTC disruptions, police boundaries, and incident markers — are torn down by
// the same close path when any of them opens or a selection clears.

const DEFAULT_POPUP_OPTIONS = { minWidth: 260, maxWidth: 340, closeOnClick: false };

export function createMapPopups(map) {
  function closeImmediately() {
    map?.closePopup?.();
    for (const popup of document.querySelectorAll('.leaflet-popup')) popup.remove();
  }

  // Opens `content` anchored at `anchor` (a latlng, or a layer exposing
  // getLatLng/getBounds). Returns false when there is nothing to anchor to.
  function openAt(content, anchor, options = {}) {
    if (!map || !anchor) return false;
    closeImmediately();
    map.openPopup(content, anchor, { ...DEFAULT_POPUP_OPTIONS, ...options });
    return true;
  }

  // Binds and opens `content` on `layer` (the road-closure and incident paths).
  function openBound(content, layer, options = {}) {
    if (!layer?.bindPopup) return false;
    closeImmediately();
    layer.bindPopup(content, { ...DEFAULT_POPUP_OPTIONS, ...options }).openPopup();
    return true;
  }

  // Re-opens the popup already bound to `layer` (incident markers bind their
  // card once per render; a click re-opens it without rebinding).
  function reopenBound(layer) {
    if (!layer?.openPopup) return false;
    closeImmediately();
    layer.openPopup();
    return true;
  }

  return { closeImmediately, openAt, openBound, reopenBound };
}
