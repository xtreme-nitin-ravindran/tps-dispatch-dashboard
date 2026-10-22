// The dispatch-map layout maintenance block (Stories 40/41/44): one module owns
// the measured mobile chrome (sheet overlap, layer-row offsets, focus-mode
// boundaries) and the coalesced maintenance/invalidation scheduling. Extracted
// from app.js with injectable dependencies so the measurement math is unit
// testable; app.js keeps thin name bindings for its listener wiring.
import { mobileMapSheetOverlap } from './mobile-bottom-sheet.js';

export function createMapMaintenance({
  mapElement = null,
  bottomSheet = null,
  focusToggle = null,
  focusFilterSummary = null,
  getMap = () => null,
  scheduler = null,
  isMobileLayout = () => false,
  getMobileView = () => 'map',
  isFocusMode = () => false,
  documentRef = globalThis.document,
  windowRef = globalThis.window,
  requestFrame = globalThis.requestAnimationFrame,
  cancelFrame = globalThis.cancelAnimationFrame,
  audit = null,
  captureBoundaryDiagnostic = () => {},
  queuePoliceBoundaryWork = () => {},
  viewStillCurrent = () => false,
  selectFocusedCall = () => {},
  persistPreferences = () => {},
  getFocusedCallId = () => null
} = {}) {
  // Story 40F: keep the attribution in the lower-right map chrome on every
  // layout. The previous mobile "topleft" placement put the OpenStreetMap link
  // directly over the fullscreen/× focus control (Leaflet's .leaflet-top corner
  // stacks at z-index 1000, above the control), so touching the control opened
  // the attribution link instead.
  //
  // Leaflet inserts bottom-corner controls at the *front* of the corner, so
  // calling setPosition("bottomright") again would lift the attribution above
  // the zoom control and, on short mobile maps, into the Road closures / Police
  // divisions row. The default position is already "bottomright", so only
  // reposition when the corner actually differs; that keeps the attribution
  // after the zoom control (below it) and clear of the layer controls.
  function syncMapAttributionPosition() {
    const control = getMap()?.attributionControl;
    if (!control) return;
    if (control.getPosition?.() !== "bottomright") control.setPosition("bottomright");
  }

  function syncMapSheetOverlap() {
    if (!mapElement || !bottomSheet) return;
    const sheetRect = bottomSheet.getBoundingClientRect();
    const overlap = mobileMapSheetOverlap(
      mapElement.getBoundingClientRect(),
      sheetRect,
      isMobileLayout() && getMobileView() === "map" && !isFocusMode()
    );
    mapElement.style.setProperty("--mobile-map-sheet-overlap", `${overlap}px`);
    // Story 42: the collapsed sheet grows to fit a wrapped summary, so the
    // focus-mode chrome must reserve the sheet's real rendered height rather than
    // the nominal 52px collapsed height.
    if (sheetRect.height > 0) {
      documentRef.documentElement.style.setProperty("--mobile-sheet-height-actual", `${Math.round(sheetRect.height)}px`);
    }
  }

  // Write a root CSS custom property only when its value actually changes, so the
  // measurement pass cannot thrash layout or re-trigger the ResizeObserver.
  function setRootMetric(name, value) {
    const next = `${Math.round(value)}px`;
    if (documentRef.documentElement.style.getPropertyValue(name) === next) return;
    documentRef.documentElement.style.setProperty(name, next);
  }

  // Story 40E: the Road closures / Police divisions layer row wraps taller on some
  // engines (notably iOS Safari), so a fixed offset can place the focus control
  // underneath it. Measure the row's real bottom edge and expose it as a CSS
  // variable the focus control anchors to.
  //
  // Story 41: the Road closures control now sits directly below the Police
  // Divisions control, so its top edge must track the Police Divisions control's
  // real rendered bottom edge (which varies with label wrapping). Measure that
  // bottom edge and expose it as a CSS variable the Road closures control anchors
  // to, keeping the two controls stacked without overlap at every breakpoint.
  //
  // Story 44: the focus-mode floating chrome (navigation band, filter summary,
  // map info) previously chained off hardcoded offsets from the layer row. Those
  // offsets assumed fixed control heights, so a taller focus button, a wrapped
  // navigation band, or a taller summary could push chrome over the map credit or
  // the zoom control. Measure the real rendered boundaries of the focus button,
  // navigation band, filter summary, zoom control, and attribution and expose them
  // as CSS variables the focus-mode rules consume. The measurement runs inside the
  // existing coalesced maintenance frame with no new listeners.
  function syncMobileLayerRowOffset() {
    const wrap = mapElement?.closest?.(".map-wrap");
    const layerRow = wrap?.querySelector?.(".map-layer-toggle");
    if (!wrap || !layerRow) return;
    if (isFocusMode()) {
      syncMobileFocusChromeMetrics();
      return;
    }
    const wrapTop = wrap.getBoundingClientRect().top;
    const policeControl = wrap.querySelector(".leaflet-top.leaflet-right .leaflet-control-layers");
    if (policeControl) {
      const policeBottom = policeControl.getBoundingClientRect().bottom - wrapTop;
      documentRef.documentElement.style.setProperty("--police-control-bottom", `${Math.round(policeBottom)}px`);
    }
    // The Road closures control is the first .map-layer-toggle; the TTC
    // disruptions control (when visible) is the last. The TTC control anchors to
    // the Road closures control's real bottom edge, and the focus control and
    // focus-mode chrome anchor to the bottom of the whole stack.
    const roadBottom = layerRow.getBoundingClientRect().bottom - wrapTop;
    documentRef.documentElement.style.setProperty("--road-control-bottom", `${Math.round(roadBottom)}px`);
    const toggles = [...wrap.querySelectorAll(".map-layer-toggle")];
    const stackBottomEl = toggles.filter(el => el.getClientRects().length).pop() || layerRow;
    const rowBottom = stackBottomEl.getBoundingClientRect().bottom - wrapTop;
    // Set on the root so both the map-wrap descendants (the focus control) and the
    // fixed focus-mode chrome (navigation band, summary, map info) can read it.
    documentRef.documentElement.style.setProperty("--mobile-layer-row-bottom", `${Math.round(rowBottom)}px`);
    // Story 41: the focus control is vertically centered against the stacked
    // Police Divisions / Road closures controls, so expose the stack's real
    // vertical center (measured from the Police Divisions top to the bottom of the
    // stack) for the focus control to anchor to.
    if (policeControl) {
      const stackTop = policeControl.getBoundingClientRect().top - wrapTop;
      const stackCenter = (stackTop + rowBottom) / 2;
      documentRef.documentElement.style.setProperty("--mobile-layer-stack-center", `${Math.round(stackCenter)}px`);
    }
    syncMobileFocusChromeMetrics();
  }

  // Story 44: measure the focus-mode floating chrome's real rendered boundaries.
  // The focus-mode rules are position: fixed, so viewport-relative rectangles are
  // the correct reference (the fixed map stage starts at the viewport top). Only
  // measure while focus mode is active on a mobile layout; otherwise the elements
  // are laid out in the normal page flow and their rectangles are meaningless for
  // the fixed chrome.
  function syncMobileFocusChromeMetrics() {
    if (!isFocusMode() || !isMobileLayout()) return;
    const toggle = focusToggle;
    if (toggle) {
      const rect = toggle.getBoundingClientRect();
      if (rect.height > 0) setRootMetric("--mobile-focus-height", rect.height);
    }
    const navBand = documentRef.querySelector(".radius-controls");
    if (navBand) {
      const rect = navBand.getBoundingClientRect();
      if (rect.height > 0) setRootMetric("--mobile-nav-bottom", rect.bottom);
    }
    if (focusFilterSummary && !focusFilterSummary.hidden) {
      const rect = focusFilterSummary.getBoundingClientRect();
      if (rect.height > 0) setRootMetric("--mobile-summary-bottom", rect.bottom);
    }
    const zoomControl = wrapQuery(".leaflet-control-zoom");
    if (zoomControl) {
      const rect = zoomControl.getBoundingClientRect();
      if (rect.width > 0) setRootMetric("--mobile-zoom-clearance", windowRef.innerWidth - rect.left);
    }
    const attribution = wrapQuery(".leaflet-control-attribution");
    if (attribution) {
      const rect = attribution.getBoundingClientRect();
      if (rect.height > 0) setRootMetric("--mobile-attribution-clearance", windowRef.innerHeight - rect.top);
    }
  }

  function wrapQuery(selector) {
    return mapElement?.closest?.(".map-wrap")?.querySelector?.(selector) || null;
  }

  let mapMaintenanceFrame = null;
  let mapSizeInvalidationPending = false;

  function scheduleMaintenance({ invalidateSize = false } = {}) {
    mapSizeInvalidationPending ||= invalidateSize;
    if (scheduler?.pending()) return;
    if (isMobileLayout() && getMobileView() !== "map") return;
    if (mapMaintenanceFrame !== null) return;
    mapMaintenanceFrame = requestFrame(() => {
      mapMaintenanceFrame = null;
      syncMapSheetOverlap();
      syncMobileLayerRowOffset();
      if (!mapSizeInvalidationPending) return;
      mapSizeInvalidationPending = false;
      const finishInvalidation = audit.begin('view-toggle:leaflet-invalidate-size');
      captureBoundaryDiagnostic('invalidate-size:before');
      getMap()?.invalidateSize?.({ pan: false });
      captureBoundaryDiagnostic('invalidate-size:after');
      finishInvalidation();
      queuePoliceBoundaryWork('map-size-invalidated');
    });
  }

  function scheduleViewMaintenance({ view, mobile, focusSelection, persist }) {
    mapSizeInvalidationPending ||= mobile && view === "map";
    if (mapMaintenanceFrame !== null) cancelFrame(mapMaintenanceFrame);
    mapMaintenanceFrame = null;
    const generation = scheduler.afterPaint(() => {
      if (!viewStillCurrent(view, mobile)) return;
      audit.mark('view-toggle:first-frame-after-switch', { view, generation });
      const finishMaintenance = audit.begin('view-toggle:deferred-maintenance', { view, generation });
      syncMapAttributionPosition();
      syncMapSheetOverlap();
      if (mobile && view === "map" && mapSizeInvalidationPending) {
        mapSizeInvalidationPending = false;
        const finishInvalidation = audit.begin('view-toggle:leaflet-invalidate-size');
        captureBoundaryDiagnostic('map-reveal-invalidate-size:before');
        getMap()?.invalidateSize?.({ pan: false });
        captureBoundaryDiagnostic('map-reveal-invalidate-size:after');
        finishInvalidation();
        queuePoliceBoundaryWork('map-revealed-after-invalidation');
      }
      if (focusSelection && mobile && view === "map" && getFocusedCallId()) {
        const finishSelection = audit.begin('view-toggle:selected-incident-sync');
        selectFocusedCall();
        finishSelection();
      }
      if (persist) {
        const finishPersistence = audit.begin('view-toggle:preference-persistence');
        persistPreferences();
        finishPersistence();
      }
      finishMaintenance();
      audit.mark('view-toggle:maintenance-complete', { view, generation });
    });
    audit.mark('view-toggle:maintenance-scheduled', { view, generation });
  }

  return { scheduleMaintenance, scheduleViewMaintenance, syncMapSheetOverlap, syncMapAttributionPosition, wrapQuery };
}
