import { sourceStatus, sourceStatusText } from "./src/source-status.js?v=source-states-1";
import { canExpandCluster, clusterPoints, spreadPoint, focusGroup } from "./src/map-clusters.js?v=story-38g-1";
import { incidentGroupKey, reconcileIncidentLayers } from "./src/incident-layer-diff.js";
import { activeSecondaryFilterCount, filterDefaults, filterSummary, incidentDeepLink, readFilters, shareView, shareIncidentView, readSharedIncident, shareIncident, loadPreferences, savePreferences } from "./src/view-controls.js";
import * as disruptionUi from "./src/disruptions/ui.js?v=story-38b-1";
import { withTtcNearbyFixture } from "./src/disruptions/ttc-nearby-fixture.js";
import { compactAge, compactReportedAge, locationConfidence, callStatus, sourceName, respondingUnitLabel } from "./src/call-presentation.js?v=responding-units-1";
import { distanceKm, distanceLabel, withinGeographicScope } from "./src/nearby.js?v=radius-controls-1";
import { policeUnitLabel } from "./src/tps/unit-label.js?v=3";
import { incidentCategory } from "./src/tfs/category.js";
import { locationDisplay, expandLocationAbbreviations } from "./src/location-display.js?v=hydro-corridor-1";
import { isWithinHistoryWindow } from "./src/tfs/time.js";
import { nearbySummary } from "./src/nearby-summary.js";
import { mobileNearbySummary } from "./src/mobile-nearby-summary.js";
import { nearbyEmptyState, nextNearbyRadius, radiusLabel } from "./src/nearby-empty-state.js";
import { nearbyCtaCopy } from "./src/cta-copy.js";
import { rankSirenMatches, SIREN_RADIUS_KM } from "./src/siren-matches.js";
import { incidentArrivalState, reconcileIncidentSelection } from "./src/incident-selection.js";
import { markerAgeLabel, markerAgeTier, markerGlyph } from "./src/marker-age.js";
import { incidentBadge, incidentBadgeExpiry } from "./src/incident-badge.js?v=incident-badges-1";
import { incidentMatchesSearch } from "./src/incident-search.js";
import { DISPATCH_GLOSSARY_FOOTER, glossaryDefinition } from "./src/dispatch-glossary.js?v=glossary-1";
import { applyTheme, normalizeThemePreference } from "./src/theme.js";
import { createRefreshFreshnessTracker } from "./src/refresh-freshness.js";
import { mobileMapSheetOverlap, mobileSheetActionLabel, mobileSheetStateAfterDrag, nextMobileSheetState } from "./src/mobile-bottom-sheet.js";
import { capturePoliceBoundaryRenderState, createPoliceBoundaryLayer, diagnosePoliceBoundaryGeometry, policeBoundaryRingCount } from "./src/police-boundary-overlay.js";
import { NEARBY_SORT_DEFAULT, sortNearbyCalls } from "./src/nearby-sort.js";
import { offlineStatus } from "./src/offline-status.js";
import { MAX_SAVED_LOCATIONS, addSavedLocation, deleteSavedLocation, loadSavedLocationState, referenceCoordinates, renameSavedLocation, savedLocationForContext, selectCurrentLocation, selectSavedLocation } from "./src/saved-locations.js";
const { captureRoadClosureRenderState, createClosureDetail, renderDisruptions, setRoadOverlayVisibility } = disruptionUi;
import { createLocalWatch, defaultWatchRadius, loadLocalWatch, saveLocalWatch, watchFixtureState, watchLocationContext, watchSupportState } from './src/watch-config.js';
import { clearWatchActivation, createHttpWatchSubscriptionAdapter, createPushFixtureRuntime, createPushSubscriptionController, loadWatchActivation, pushFixtureOptions, saveWatchActivation, vapidPublicKeyFrom, watchApiBaseUrlFrom } from './src/push-subscription.js';
import { mobileAuditFixtureFilters, mobileAuditFixtureOptions, mobileAuditFixtureSnapshot } from './src/mobile-audit-fixture.js';
import { runSynchronousAuditWork, uxAudit, uxReliabilityFixtureOptions, waitForAuditDelay } from './src/ux-reliability-audit.js';
import { INCIDENT_LIST_BATCH_SIZE, incidentFilterKey, incidentListKey, nextIncidentBatch } from './src/incident-list-window.js';
import { createViewTransitionScheduler } from './src/mobile-view-transition.js';
import { createPoliceBoundaryLifecycleScheduler } from './src/police-boundary-lifecycle.js';

uxAudit.mark('app-bootstrap-begins');

const CONFIG = {
  snapshotUrl: "https://raw.githubusercontent.com/xtreme-nitin-ravindran/tps-dispatch-dashboard/data/data/current.json",
  refreshCheckMs: 30_000
};

const state = {
  nearby: null,
  savedLocations: [],
  locationContext: { type: "current" },
  radiusKm: null,
  hours: 24,
  calls: [],
  filtered: [],
  feeds: {},
  lastIngest: null,
  fetchedAt: null,
  search: "",
  division: "all",
  serviceFilter: "all",
  eventFilter: "all",
  nearbySort: NEARBY_SORT_DEFAULT
};

const els = {
  lastUpdated: document.querySelector("#lastUpdated"),
  windowLabel: document.querySelector("#windowLabel"),
  searchInput: document.querySelector("#searchInput"),
  clearSearch: document.querySelector("#clearSearch"),
  mobileFiltersToggle: document.querySelector("#mobileFiltersToggle"),
  mobileFilterCount: document.querySelector("#mobileFilterCount"),
  divisionSelect: document.querySelector("#divisionSelect"),
  callsCount: document.querySelector("#callsCount"),
  callsCountFoot: document.querySelector("#callsCountFoot"),
  divisionCount: document.querySelector("#divisionCount"),
  busiestDivision: document.querySelector("#busiestDivision"),
  busiestDivisionFoot: document.querySelector("#busiestDivisionFoot"),
  topCall: document.querySelector("#topCall"),
  topCallFoot: document.querySelector("#topCallFoot"),
  resultCount: document.querySelector("#resultCount"),
  callList: document.querySelector("#callList"),
  eventToggles: document.querySelectorAll("[data-event-filter]"),
  dispatchMap: document.querySelector("#dispatchMap"),
  mapLoadStatus: document.querySelector("#mapLoadStatus"),
  mapStatus: document.querySelector("#mapStatus"),
  sourceUpdated: document.querySelector("#sourceUpdated"),
  callTemplate: document.querySelector("#callTemplate"),
  footerClock: document.querySelector("#footerClock")
};
const refreshStatus = document.querySelector('#refreshStatus');
const offlineStatusElement = document.querySelector('#offlineStatus');
const refreshFreshnessIndicator = document.querySelector('#refreshFreshness');
const refreshFreshness = createRefreshFreshnessTracker({
  onChange(label) {
    refreshFreshnessIndicator.textContent = label;
    refreshFreshnessIndicator.hidden = !label;
  }
});
const callsFeedStatus = document.querySelector('#callsFeedStatus');
const radiusToggles = document.querySelectorAll('[data-radius-km]');
const mobileViewToggles = document.querySelectorAll('[data-mobile-view]');
const mobileBottomSheet = document.querySelector('#mobileBottomSheet');
const mobileSheetToggle = document.querySelector('#mobileSheetToggle');
const mobileSheetStateLabel = document.querySelector('#mobileSheetState');
const mobileSheetSummary = document.querySelector('#mobileSheetSummary');
const mobileSheetStateControls = document.querySelectorAll('[data-sheet-target]');
const mobileSheetCallList = document.querySelector('#mobileSheetCallList');
const callsListHome = els.callList.parentElement;
const mobileCallsFeedStatus = document.querySelector('#mobileCallsFeedStatus');
const mobileClosureDetail = document.querySelector('#mobileClosureDetail');
const nearbySort = document.querySelector('#nearbySort');
const expandNearbyRadius = document.querySelector('#expandNearbyRadius');
const quickLookDataStatus = document.querySelector('#quickLookDataStatus');

const TORONTO_CENTER = [43.7001, -79.42];
let dispatchMap = null;
let mapMarkers = new Map();
let callLayer;
let expandedCluster = new Set();
let renderedIncidentLayers = new Map();
let scheduledMarkerRender = null;
let focusedCallId = null;
let focusedClosureId = null;
let rowHighlightTimer;
let mapHasFitted = false;
let lastRadiusKm = 2;
let boundaryVisible = true;
let sirenMode = false;
let sirenMatches = [];
let choosingArea = false;
let nearbyOriginKind = "device";
let liveLocation = null;
let nearbyOriginLayer = null;
let divisionLayer = null;
let divisionGeometryLayer = null;
let divisionRenderer = null;
let divisionDataPromise = null;
let boundaryRenderFrame = null;
let boundaryRenderGeneration = 0;
let boundaryDirty = true;
let boundaryLifecycleEvent = 'startup';
let boundaryDebugCapture = null;
const boundaryDebugHistory = [];
let incidentBadgeTimer = null;
let incidentDatasetRevision = 0;
let appliedIncidentFilterKey = null;
let renderedIncidentListKey = null;
let sortedIncidentCalls = [];
let renderedIncidentCount = 0;
const renderedIncidentIds = new Set();
let glossaryPopoverSequence = 0;
let themePreference = "system";
let mobileView = "map";
let mobileViewInteracted = false;
let presentedMobileView = null;
let presentedMobileLayout = null;
let mobileSheetState = "collapsed";
let mobileSheetDrag = null;
let suppressNextMobileSheetClick = false;
const initialParams = new URLSearchParams(location.search);
const mobileAuditFixture = mobileAuditFixtureOptions(location);
const boundaryDebugEnabled = initialParams.get('policeBoundaryDebug') === '1';
const boundaryLifecycleScheduler = createPoliceBoundaryLifecycleScheduler();
const uxReliabilityFixture = uxReliabilityFixtureOptions(location);
let uxFixtureLazyWorkPending = Boolean(uxReliabilityFixture?.lazyWorkMs);
let mapInitializationScheduled = false;
const loadPhases = { shell: 'ready', incidents: 'loading', map: 'loading', secondary: 'loading' };
document.documentElement.dataset.shellLoadState = loadPhases.shell;
document.documentElement.dataset.incidentLoadState = loadPhases.incidents;
document.documentElement.dataset.mapLoadState = loadPhases.map;
document.documentElement.dataset.secondaryLoadState = loadPhases.secondary;

function setIncidentLoadPhase(phase) {
  loadPhases.incidents = phase;
  document.documentElement.dataset.incidentLoadState = phase;
  const loading = phase === 'loading';
  els.callList.setAttribute('aria-busy', String(loading));
  if (loading) els.resultCount.textContent = 'LOADING';
  if (quickLookDataStatus) {
    quickLookDataStatus.hidden = phase === 'ready';
    const unavailable = ['error', 'unavailable'].includes(phase);
    quickLookDataStatus.classList.toggle('is-error', unavailable);
    quickLookDataStatus.textContent = unavailable
      ? 'Call data is temporarily unavailable. Location controls are still ready.'
      : 'Loading calls… Location controls are ready.';
  }
  if (!focusedClosureId && mobileSheetSummary && phase !== 'ready') {
    mobileSheetSummary.textContent = ['error', 'unavailable'].includes(phase)
      ? 'Calls temporarily unavailable' : 'Loading nearby calls…';
  }
}

function setMapLoadPhase(phase, message = '') {
  loadPhases.map = phase;
  document.documentElement.dataset.mapLoadState = phase;
  els.dispatchMap?.setAttribute('aria-busy', String(phase === 'loading'));
  if (!els.mapLoadStatus) return;
  els.mapLoadStatus.hidden = phase === 'ready';
  els.mapLoadStatus.classList.toggle('is-error', phase === 'error');
  const label = els.mapLoadStatus.querySelector('span:last-child');
  if (label && message) label.textContent = message;
  els.mapLoadStatus.querySelector('.loader')?.toggleAttribute('hidden', phase !== 'loading');
}

function setSecondaryLoadPhase(phase) {
  loadPhases.secondary = phase;
  document.documentElement.dataset.secondaryLoadState = phase;
}

function yieldForLoadingPaint() {
  return new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)));
}

setIncidentLoadPhase('loading');
setMapLoadPhase('loading', 'Loading map…');
let fullyRenderedMarked = false;
const auditReadiness = { data: false, map: false, tiles: false, boundaries: false, secondary: false };

function markFullyRenderedWhenReady() {
  if (!fullyRenderedMarked && Object.values(auditReadiness).every(Boolean)) {
    fullyRenderedMarked = true;
    uxAudit.mark('first-fully-rendered-ui');
  }
}

function runFirstInteractionFixtureWork() {
  if (!uxFixtureLazyWorkPending) return;
  uxFixtureLazyWorkPending = false;
  runSynchronousAuditWork(uxReliabilityFixture.lazyWorkMs);
}

function auditInteraction(name, callback) {
  return (...args) => {
    const end = uxAudit.begin(`interaction:${name}`);
    const endVisualResponse = uxAudit.begin(`visual-response:${name}`);
    requestAnimationFrame(() => requestAnimationFrame(() => endVisualResponse({ view: mobileView })));
    try {
      runFirstInteractionFixtureWork();
      return callback(...args);
    } finally {
      end({ view: mobileView, filteredCalls: state.filtered.length });
    }
  };
}
let pendingSharedIncidentId = readSharedIncident(initialParams);
const pushFixtures = pushFixtureOptions(location);
const loopbackFixtureHost = new Set(['localhost', '127.0.0.1', '::1']).has(location.hostname);
const notificationArrivalFixture = pushFixtures?.arrival || (loopbackFixtureHost
  ? pendingSharedIncidentId === 'fixture-incident-1' ? 'present'
    : pendingSharedIncidentId === 'fixture-expired-incident' ? 'missing' : null
  : null);
const systemTheme = window.matchMedia("(prefers-color-scheme: dark)");
const themeColorMeta = document.querySelector('meta[name="theme-color"]');
const mobileViewQuery = "(max-width: 680px), (max-width: 950px) and (max-height: 500px) and (pointer: coarse)";
const mobileLayoutMedia = window.matchMedia(mobileViewQuery);
const nearbyOptions = document.querySelector('.nearby-options');
function syncTheme() {
  applyTheme(document.documentElement, themeColorMeta, themePreference, systemTheme.matches);
  const boundaryColor = getComputedStyle(document.documentElement).getPropertyValue("--boundary-marker").trim();
  if (!boundaryColor || !divisionGeometryLayer) return;
  if (!mapAllowsBoundaryWork()) {
    boundaryDirty = true;
    boundaryLifecycleEvent = 'theme-change-while-map-hidden';
    return;
  }
  divisionGeometryLayer.setStyle({ color: boundaryColor });
}
function rememberPreferences(stateOverrides = {}) {
  try { savePreferences(localStorage,{...state,...stateOverrides},{roads:document.querySelector('#roadOverlay').checked,boundaries:boundaryVisible,theme:themePreference,mobileView}); } catch { /* Browsing still works when storage is blocked. */ }
}

function isMobileViewLayout() {
  return mobileLayoutMedia.matches;
}

function syncMapAttributionPosition() {
  dispatchMap?.attributionControl?.setPosition(isMobileViewLayout() ? "topleft" : "bottomright");
}

let mapMaintenanceFrame = null;
let mapSizeInvalidationPending = false;
const viewTransitionScheduler = createViewTransitionScheduler();
function syncMapSheetOverlap() {
  if (!els.dispatchMap || !mobileBottomSheet) return;
  const overlap = mobileMapSheetOverlap(
    els.dispatchMap.getBoundingClientRect(),
    mobileBottomSheet.getBoundingClientRect(),
    isMobileViewLayout() && mobileView === "map"
  );
  els.dispatchMap.style.setProperty("--mobile-map-sheet-overlap", `${overlap}px`);
}

function scheduleMapMaintenance({ invalidateSize = false } = {}) {
  mapSizeInvalidationPending ||= invalidateSize;
  if (viewTransitionScheduler.pending()) return;
  if (isMobileViewLayout() && mobileView !== "map") return;
  if (mapMaintenanceFrame !== null) return;
  mapMaintenanceFrame = requestAnimationFrame(() => {
    mapMaintenanceFrame = null;
    syncMapSheetOverlap();
    if (!mapSizeInvalidationPending) return;
    mapSizeInvalidationPending = false;
    const finishInvalidation = uxAudit.begin('view-toggle:leaflet-invalidate-size');
    captureBoundaryDiagnostic('invalidate-size:before');
    dispatchMap?.invalidateSize({ pan: false });
    captureBoundaryDiagnostic('invalidate-size:after');
    finishInvalidation();
    queuePoliceBoundaryWork('map-size-invalidated');
  });
}

function scheduleViewMaintenance({ view, mobile, focusSelection, persist }) {
  mapSizeInvalidationPending ||= mobile && view === "map";
  if (mapMaintenanceFrame !== null) cancelAnimationFrame(mapMaintenanceFrame);
  mapMaintenanceFrame = null;
  const generation = viewTransitionScheduler.schedule(() => {
    if (view !== mobileView || mobile !== isMobileViewLayout()) return;
    uxAudit.mark('view-toggle:first-frame-after-switch', { view, generation });
    const finishMaintenance = uxAudit.begin('view-toggle:deferred-maintenance', { view, generation });
    syncMapAttributionPosition();
    syncMapSheetOverlap();
    if (mobile && view === "map" && mapSizeInvalidationPending) {
      mapSizeInvalidationPending = false;
      const finishInvalidation = uxAudit.begin('view-toggle:leaflet-invalidate-size');
      captureBoundaryDiagnostic('map-reveal-invalidate-size:before');
      dispatchMap?.invalidateSize({ pan: false });
      captureBoundaryDiagnostic('map-reveal-invalidate-size:after');
      finishInvalidation();
      queuePoliceBoundaryWork('map-revealed-after-invalidation');
    }
    if (focusSelection && mobile && view === "map" && focusedCallId) {
      const finishSelection = uxAudit.begin('view-toggle:selected-incident-sync');
      selectCall(focusedCallId, { panIfNeeded: true });
      finishSelection();
    }
    if (persist) {
      const finishPersistence = uxAudit.begin('view-toggle:preference-persistence');
      rememberPreferences();
      finishPersistence();
    }
    finishMaintenance();
    uxAudit.mark('view-toggle:maintenance-complete', { view, generation });
  });
  uxAudit.mark('view-toggle:maintenance-scheduled', { view, generation });
}

function syncIncidentListSurface(mobile = isMobileViewLayout()) {
  const host = mobile && mobileView === "map" ? mobileSheetCallList : callsListHome;
  if (els.callList.parentElement !== host) host.append(els.callList);
}

function setMobileView(view, { focusSelection = false, persist = true } = {}) {
  if (view !== "map" && view !== "calls") return;
  const mobile = isMobileViewLayout();
  if (view === mobileView && view === presentedMobileView && mobile === presentedMobileLayout) return;
  const finishState = uxAudit.begin('view-toggle:state-update', { target: view });
  mobileView = view;
  finishState({ mobile });
  const finishPresentation = uxAudit.begin('view-toggle:presentation');
  document.documentElement.dataset.mobileView = view;
  mobileViewToggles.forEach(toggle => {
    const active = toggle.dataset.mobileView === view;
    toggle.classList.toggle("active", active);
    toggle.setAttribute("aria-pressed", String(active));
  });
  const layout = mobile ? 'mobile' : 'desktop';
  if (nearbyOptions?.dataset.layout !== layout) {
    nearbyOptions.open = !mobile;
    nearbyOptions.dataset.layout = layout;
  }
  const mapView = document.querySelector("#mapView");
  const callsView = document.querySelector("#callsView");
  if (mobile) {
    mapView?.setAttribute("aria-hidden", String(view !== "map"));
    callsView?.setAttribute("aria-hidden", String(view !== "calls"));
    mobileBottomSheet?.setAttribute("aria-hidden", String(view !== "map"));
  } else {
    mapView?.removeAttribute("aria-hidden");
    callsView?.removeAttribute("aria-hidden");
    mobileBottomSheet?.removeAttribute("aria-hidden");
  }
  finishPresentation();
  uxAudit.mark('view-toggle:visual-state-committed', { view, mobile });
  const finishOwnership = uxAudit.begin('view-toggle:list-ownership');
  syncIncidentListSurface(mobile);
  finishOwnership({ cards: els.callList.querySelectorAll('.incident-card').length });
  presentedMobileView = view;
  presentedMobileLayout = mobile;
  if (mobile && view === 'calls' && boundaryVisible) {
    boundaryDirty = true;
    boundaryLifecycleEvent = 'map-hidden-by-calls-view';
    boundaryRenderGeneration += 1;
    if (boundaryRenderFrame !== null) cancelAnimationFrame(boundaryRenderFrame);
    boundaryRenderFrame = null;
  }
  scheduleViewMaintenance({ view, mobile, focusSelection, persist });
}

mobileViewToggles.forEach(toggle => toggle.addEventListener("click", auditInteraction(`view:${toggle.dataset.mobileView}`, () => {
  mobileViewInteracted = true;
  setMobileView(toggle.dataset.mobileView, { focusSelection: toggle.dataset.mobileView === "map" });
})));
setMobileView(mobileView, { persist: false });
mobileLayoutMedia.addEventListener?.("change", () => setMobileView(mobileView, { persist: false }));

function setMobileSheetState(nextState) {
  if (!mobileBottomSheet || !["collapsed", "half", "expanded"].includes(nextState)) return;
  const previousState = mobileSheetState;
  const changed = previousState !== nextState;
  if (changed) captureBoundaryDiagnostic(`sheet:${previousState}->${nextState}:requested`);
  mobileSheetState = nextState;
  mobileBottomSheet.dataset.sheetState = nextState;
  document.documentElement.dataset.mobileSheetState = nextState;
  mobileSheetStateLabel.textContent = nextState[0].toUpperCase() + nextState.slice(1);
  mobileSheetToggle.setAttribute("aria-expanded", String(nextState !== "collapsed"));
  mobileSheetToggle.setAttribute("aria-label", mobileSheetActionLabel(nextState));
  mobileSheetStateControls.forEach(control => {
    control.setAttribute("aria-pressed", String(control.dataset.sheetTarget === nextState));
  });
  if (!changed) {
    scheduleMapMaintenance({ invalidateSize: true });
    return;
  }
  boundaryDirty = true;
  boundaryRenderGeneration += 1;
  if (boundaryRenderFrame !== null) cancelAnimationFrame(boundaryRenderFrame);
  boundaryRenderFrame = null;
  boundaryLifecycleScheduler.afterLayoutTransition(() => {
    if (mobileSheetState !== nextState || !dispatchMap || (isMobileViewLayout() && mobileView !== 'map')) return;
    syncMapSheetOverlap();
    captureBoundaryDiagnostic(`sheet:${nextState}:layout-settled`);
    dispatchMap.invalidateSize({ pan: false });
    captureBoundaryDiagnostic(`sheet:${nextState}:invalidate-size-complete`);
    queuePoliceBoundaryWork(`sheet:${nextState}:post-invalidation`);
  });
}

mobileSheetToggle?.addEventListener("click", auditInteraction('bottom-sheet', () => {
  if (suppressNextMobileSheetClick) {
    suppressNextMobileSheetClick = false;
    return;
  }
  const direction = mobileSheetState === "expanded" ? -2 : 1;
  setMobileSheetState(nextMobileSheetState(mobileSheetState, direction));
}));

mobileSheetToggle?.addEventListener("pointerdown", event => {
  if (event.pointerType === "mouse" && event.button !== 0) return;
  mobileSheetDrag = { pointerId: event.pointerId, startY: event.clientY, handled: false };
  mobileSheetToggle.setPointerCapture?.(event.pointerId);
});

mobileSheetToggle?.addEventListener("pointerup", event => {
  if (!mobileSheetDrag || mobileSheetDrag.pointerId !== event.pointerId) return;
  const nextState = mobileSheetStateAfterDrag(mobileSheetState, event.clientY - mobileSheetDrag.startY);
  suppressNextMobileSheetClick = nextState !== mobileSheetState;
  if (suppressNextMobileSheetClick) setMobileSheetState(nextState);
  mobileSheetDrag = null;
});

mobileSheetToggle?.addEventListener("pointercancel", () => { mobileSheetDrag = null; });
mobileSheetStateControls.forEach(control => control.addEventListener("click", auditInteraction(`bottom-sheet:${control.dataset.sheetTarget}`, () => {
  setMobileSheetState(control.dataset.sheetTarget);
})));
setMobileSheetState(mobileSheetState);
window.addEventListener("scroll", scheduleMapMaintenance, { passive: true });
window.addEventListener("resize", () => scheduleMapMaintenance({ invalidateSize: true }));
window.visualViewport?.addEventListener("resize", scheduleMapMaintenance);
window.visualViewport?.addEventListener("scroll", scheduleMapMaintenance);
document.addEventListener("scroll", scheduleMapMaintenance, { passive: true, capture: true });
document.addEventListener("touchmove", scheduleMapMaintenance, { passive: true });
document.addEventListener("touchend", scheduleMapMaintenance, { passive: true });
window.addEventListener("pageshow", scheduleMapMaintenance);
if (globalThis.ResizeObserver) {
  const mapSheetObserver = new ResizeObserver(scheduleMapMaintenance);
  mapSheetObserver.observe(els.dispatchMap);
  mapSheetObserver.observe(mobileBottomSheet);
}
scheduleMapMaintenance();

function escapeText(value) {
  return String(value ?? "").replace(/\s+/g, " ").trim();
}

function normalizeCall(row) {
  const eventType = escapeText(row.event_type || row.eventType).toLowerCase();
  const description = escapeText(row.description || "Call for Service");
  const eventCategory = incidentCategory(description);
  const isFireRelated = eventCategory === "fire";
  const rawTimestamp = row.timestamp ?? row.time_unix;
  const unix = Number(rawTimestamp);
  const date = Number.isFinite(unix) && unix > 0
    ? new Date(unix * (unix < 10_000_000_000 ? 1000 : 1))
    : parseLooseTime(rawTimestamp) || parseLooseTime(row.time);

  return {
    source: row.source === "TPS" ? "TPS" : "TFS",
    id: escapeText(row.id || row.event_id || "—"),
    timestamp: date?.getTime() || Date.now(),
    time: date || new Date(),
    updatedAt: parseLooseTime(row.lastMeaningfulUpdateAt),
    firstSeenAt: parseLooseTime(row.firstSeenAt),
    lastMeaningfulUpdateAt: parseLooseTime(row.lastMeaningfulUpdateAt),
    division: policeUnitLabel(row.geography?.division),
    divisionId: row.geography?.division || "Unknown",
    geography: row.geography,
    description,
    location: escapeText(row.location || "Location not published"),
    isFireRelated,
    isOngoing: typeof row.isOngoing === "boolean" ? row.isOngoing : eventType === "fire" && Number(row.cad) === 1,
    eventCategory,
    alarmLevel: isFireRelated && (row.alarmLevel ?? row.alarm_level) !== undefined
      ? escapeText(row.alarmLevel ?? row.alarm_level)
      : "",
    unitGroups: Array.isArray(row.vehicles)
      ? row.vehicles.map(vehicle => ({ type: vehicle.type, values: vehicle.numbers.join(", ") }))
      : formatUnitGroups(row.units),
    latitude: numberOrNull(row.latitude ?? row.lat),
    longitude: numberOrNull(row.longitude ?? row.lng ?? row.lon),
    highlight: Boolean(row.highlight),
    keyword: escapeText(row.keyword || "")
  };
}

function formatUnitGroups(units) {
  if (!units) return [];

  const groups = new Map();
  let currentType = "Other";
  const addUnit = (type, value) => {
    if (!value) return;
    if (!groups.has(type)) groups.set(type, []);
    groups.get(type).push(value);
  };

  for (const rawUnit of String(units).split(",")) {
    const unit = rawUnit.trim();
    if (!unit) continue;
    const match = unit.match(/^(Aerial|Fire\s+Invest(?:\.|igator)?|Hazmat|Air\s+Light|Pumper|Rescue|Ladder|Tower|Highrise|Cmd\.?\s*unit|Command)\s*[- ]?\s*(.*)$/i);
    const compact = unit.replace(/[\s.-]+/g, "");

    if (match) {
      currentType = normalizeUnitType(match[1]);
      addUnit(currentType, match[2]);
    } else if (/^\d+$/.test(unit) && currentType !== "Other") {
      addUnit(currentType, unit);
    } else if (/^C\d+$/i.test(compact)) {
      currentType = "Command Unit";
      addUnit(currentType, compact.slice(1));
    } else if (/^S\d+$/i.test(compact)) {
      currentType = "Squad Unit";
      addUnit(currentType, compact.slice(1));
    } else if (/^REHAB\d*$/i.test(compact)) {
      currentType = "Rehab Unit";
      addUnit(currentType, compact.slice(5) || "unit");
    } else {
      currentType = "Other Unit";
      addUnit(currentType, unit);
    }
  }

  return [...groups.entries()].map(([type, values]) => ({ type, values: values.join(", ") }));
}

function normalizeUnitType(type) {
  const normalized = type.toLowerCase().replace(/\s+/g, " ").trim();
  if (normalized === "aerial") return "Aerial Truck";
  if (normalized === "pumper") return "Fire Truck";
  if (normalized === "rescue") return "Rescue Truck";
  if (normalized === "ladder") return "Ladder Truck";
  if (normalized === "tower") return "Tower Truck";
  if (normalized === "highrise") return "High-Rise Unit";
  if (normalized === "hazmat") return "Hazmat Unit";
  if (normalized === "air light") return "Air/Light Unit";
  if (normalized.startsWith("fire invest")) return "Fire Investigator";
  if (normalized.startsWith("cmd") || normalized === "command") return "Command Unit";
  return normalized === "other"
    ? "Other Unit"
    : normalized.replace(/\b\w/g, character => character.toUpperCase()) + " Unit";
}

function numberOrNull(value) {
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

function parseLooseTime(value) {
  if (!value) return null;
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
}

async function fetchSnapshot() {
  const finishFetch = uxAudit.begin('incident-snapshot-fetch');
  if (mobileAuditFixture) {
    await waitForAuditDelay(uxReliabilityFixture?.incidentDelayMs || 0);
    const payload = mobileAuditFixtureSnapshot(mobileAuditFixture.state);
    finishFetch({ source: 'mobile-audit-fixture', incidents: payload.incidents.length });
    const finishNormalization = uxAudit.begin('incident-normalization');
    const snapshot = {
      calls: payload.incidents.map(row => normalizeCall(row)).sort((a, b) => b.timestamp - a.timestamp),
      disruptions: payload.disruptions,
      feeds: payload.feeds,
      fetchedAt: payload.fetchedAt,
      updatedAt: payload.sourceUpdatedAt
    };
    finishNormalization({ incidents: snapshot.calls.length });
    return snapshot;
  }
  if (notificationArrivalFixture) {
    const timestamp = new Date().toISOString();
    const incidents = notificationArrivalFixture === 'present' ? [{
      id: 'fixture-incident-1', source: 'TFS', description: 'Residential Fire Alarm',
      location: 'Queen St W / University Ave', timestamp, firstSeenAt: timestamp,
      lastSeenAt: timestamp, eventCategory: 'fire', isOngoing: true,
      geography: { coordinates: [43.6505, -79.386] }
    }] : [];
    finishFetch({ source: 'notification-arrival-fixture', incidents: incidents.length });
    const finishNormalization = uxAudit.begin('incident-normalization');
    const snapshot = {
      calls: incidents.map(row => normalizeCall(row)),
      disruptions: withTtcNearbyFixture({}),
      feeds: { TFS: { status: 'ok', fetchedAt: timestamp }, TPS: { status: 'ok', fetchedAt: timestamp } },
      fetchedAt: timestamp,
      updatedAt: timestamp
    };
    finishNormalization({ incidents: snapshot.calls.length });
    return snapshot;
  }
  const response = await fetch(`${CONFIG.snapshotUrl}?ts=${Date.now()}`, { cache: "no-store" });
  if (!response.ok) throw new Error(`Official TFS snapshot returned HTTP ${response.status}`);
  const payload = await response.json();
  const rows = Array.isArray(payload) ? payload : (payload.incidents || []);
  finishFetch({ source: 'production-snapshot', incidents: rows.length });
  const finishNormalization = uxAudit.begin('incident-normalization');
  const snapshot = {
    calls: rows.map(row => normalizeCall(row))
      .sort((a, b) => b.timestamp - a.timestamp),
    disruptions: withTtcNearbyFixture(payload.disruptions),
    feeds: payload.feeds,
    fetchedAt: payload.fetchedAt || null,
    updatedAt: payload.sourceUpdatedAt || payload.fetchedAt || null
  };
  finishNormalization({ incidents: snapshot.calls.length });
  return snapshot;
}

let sourceHighlightTimer;
let snapshotLoaded = false;

function restorePendingIncident() {
  if (!snapshotLoaded || pendingSharedIncidentId === null) return;
  const requestedId = pendingSharedIncidentId;
  pendingSharedIncidentId = null;
  let arrival = incidentArrivalState(requestedId, state.calls, state.filtered, { mobile: isMobileViewLayout() });
  const status = document.querySelector('#sharedIncidentStatus');
  if (!arrival.found) {
    focusedCallId = null;
    status.textContent = arrival.message;
    status.hidden = false;
    return;
  }
  if (arrival.needsReveal) {
    Object.assign(state, filterDefaults, { hours: 168, radiusKm: null });
    syncFilterControls();
    syncRadiusControls();
    applyFilters();
    arrival = incidentArrivalState(requestedId, state.calls, state.filtered, { mobile: isMobileViewLayout() });
  }
  status.hidden = true;
  if (arrival.mobileView && !mobileViewInteracted) setMobileView(arrival.mobileView, { persist: false });
  if (mobileAuditFixture) setMobileSheetState(mobileAuditFixture.sheet);
  else if (arrival.mobileSheetState) setMobileSheetState(arrival.mobileSheetState);
  selectCall(arrival.id, { revealRow: true, panIfNeeded: true });
}

function lastSuccessfulUpdateLabel() {
  const timestamp = parseLooseTime(state.fetchedAt || state.lastIngest);
  return timestamp ? `${formatDate(timestamp)} · ${formatTime(timestamp)} Toronto time` : null;
}

function renderOfflineStatus() {
  const status = offlineStatus({
    online: navigator.onLine,
    hasPreviouslyLoadedData: snapshotLoaded && state.calls.length > 0,
    lastSuccessfulUpdate: snapshotLoaded ? lastSuccessfulUpdateLabel() : null
  });
  offlineStatusElement.textContent = status.text;
  offlineStatusElement.hidden = status.hidden;
  document.documentElement.classList.toggle('is-offline', !status.hidden);
}

function setRefreshState(status) {
  refreshStatus.classList.toggle('is-updating',status === 'updating');
  refreshStatus.classList.toggle('is-error',status === 'error');
  refreshStatus.textContent = status === 'updating'
    ? 'Updating…'
    : status === 'error'
      ? snapshotLoaded ? 'Latest refresh failed. Previously loaded data remains visible.' : 'Dispatch data is temporarily unavailable.'
      : 'Updates from official TFS and TPS feeds.';
}

async function loadData() {
  setRefreshState('updating');
  try {
    const snapshot = await fetchSnapshot();
    const scrollTop = els.callList.scrollTop;
    const firstSnapshot = !snapshotLoaded;
    if (firstSnapshot) await yieldForLoadingPaint();
    snapshotLoaded = true;
    const previousSourceTime = parseLooseTime(state.lastIngest)?.getTime();
    const callsChanged = JSON.stringify(state.calls) !== JSON.stringify(snapshot.calls);
    const delayedSecondary = Boolean(uxReliabilityFixture?.secondaryDelayMs);
    state.disruptions = delayedSecondary ? undefined : snapshot.disruptions;
    state.calls = snapshot.calls;
    if (callsChanged || firstSnapshot) incidentDatasetRevision++;
    state.feeds = snapshot.feeds || {};
    state.lastIngest = snapshot.updatedAt;
    state.fetchedAt = snapshot.fetchedAt;
    renderOfflineStatus();
    const sourceTime = parseLooseTime(snapshot.updatedAt);
    const sources = [
      ['TFS', snapshot.feeds?.TFS || {fetchedAt:snapshot.fetchedAt, sourceUpdatedAt:snapshot.updatedAt}],
      ['TPS', snapshot.feeds?.TPS],
      ['Road restrictions', snapshot.disruptions?.roads],
      ['TTC alerts', snapshot.disruptions?.transit]
    ];
    const sourceSubjects = {'TFS':'TFS','TPS':'TPS','Road restrictions':'Road restriction','TTC alerts':'TTC alert'};
    els.sourceUpdated.replaceChildren(...sources.flatMap(([name,feed]) => {
      const info = sourceStatus(name,feed);
      const label = document.createElement('span');
      label.textContent = `${name}:`;
      const value = document.createElement('span');
      value.className = `source-time source-state-${info.status}`;
      value.textContent = sourceStatusText(sourceSubjects[name],feed);
      return [label, value];
    }));
    if (callsChanged || firstSnapshot) {
      applyFilters();
      els.callList.scrollTop = scrollTop;
    }
    const availability = incidentAvailability();
    setIncidentLoadPhase(!availability.hasRelevantCachedData && availability.allUnavailable ? 'unavailable' : 'ready');
    renderNearbySummary();
    auditReadiness.data = true;
    markFullyRenderedWhenReady();
    restorePendingIncident();
    const finishSecondary = uxAudit.begin('secondary-feed-preparation');
    if (delayedSecondary) {
      await waitForAuditDelay(uxReliabilityFixture.secondaryDelayMs);
      state.disruptions = snapshot.disruptions;
    }
    renderDisruptions(state.disruptions, radiusFilterOrigin(), state.radiusKm, dispatchMap);
    finishSecondary({
      roads: state.disruptions?.roads?.items?.length || 0,
      transit: state.disruptions?.transit?.items?.length || 0
    });
    auditReadiness.secondary = true;
    setSecondaryLoadPhase('ready');
    uxAudit.mark('road-closure-layer-initialized');
    markFullyRenderedWhenReady();
    updateFreshness();
    refreshFreshness.complete(true);
    setRefreshState('idle');
    if (previousSourceTime != null && sourceTime && sourceTime.getTime() !== previousSourceTime) {
      clearTimeout(sourceHighlightTimer);
      els.sourceUpdated.classList.add('source-just-updated');
      sourceHighlightTimer = setTimeout(() => {
        els.sourceUpdated.classList.remove('source-just-updated');
      }, 4000);
    }
  } catch (error) {
    console.error(error);
    refreshFreshness.complete(false);
    setRefreshState('error');
    if (!snapshotLoaded) {
      setIncidentLoadPhase('error');
      setSecondaryLoadPhase('error');
      els.resultCount.textContent = 'UNAVAILABLE';
      els.callList.innerHTML = `
        <div class="error-state">
          <strong>Couldn’t load the public dispatch feed.</strong>
          <p>${escapeText(error.message)}</p>
          <p>Some browsers or networks may block cross-origin requests. See README.md for the optional proxy setup.</p>
        </div>`;
    }
  }
}

function populateDivisionFilter(calls) {
  const current = state.division;
  const divisions = [...new Set(calls.map(c => c.division).filter(Boolean))]
    .sort((a, b) => a.localeCompare(b, undefined, { numeric: true }));

  // A zero-result nearby radius should not erase a division the user selected.
  if (!calls.length && state.radiusKm !== null && current !== "all" && !divisions.includes(current)) {
    divisions.push(current);
  }

  els.divisionSelect.innerHTML = `<option value="all">All police divisions</option>` +
    divisions.map(d => `<option value="${encodeURIComponent(d)}">${d}</option>`).join("");

  const exists = divisions.includes(current);
  state.division = exists ? current : "all";
  els.divisionSelect.value = state.division === "all" ? "all" : encodeURIComponent(state.division);
}

function applyFilters({ map = true } = {}) {
  const nextFilterKey = incidentFilterKey({
    datasetRevision: incidentDatasetRevision,
    radiusKm: state.radiusKm,
    nearby: state.nearby,
    serviceFilter: state.serviceFilter,
    eventFilter: state.eventFilter,
    division: state.division,
    hours: state.hours,
    search: state.search
  });
  if (nextFilterKey === appliedIncidentFilterKey) return false;
  const finishCalculation = uxAudit.begin('filter-sort-calculation', { inputCalls: state.calls.length });
  const eligibleCalls = state.calls.filter(call => {
    if (!withinGeographicScope(state.nearby, state.radiusKm, coordinatesForCall(call))) return false;
    if (state.serviceFilter !== "all" && call.source !== state.serviceFilter) return false;
    if (!isWithinHistoryWindow(call.timestamp, state.hours)) return false;
    if (state.eventFilter === "ongoing" && !call.isOngoing) return false;
    if (state.eventFilter !== "all" && state.eventFilter !== "ongoing" && call.eventCategory !== state.eventFilter) return false;
    return true;
  });

  // Build the facet before applying its own selection or search, so a query cannot reset the division.
  populateDivisionFilter(eligibleCalls);
  state.filtered = eligibleCalls.filter(call =>
    (state.division === "all" || call.division === state.division) &&
    incidentMatchesSearch(call, state.search, displayLocation(call).text)
  );
  appliedIncidentFilterKey = incidentFilterKey({
    datasetRevision: incidentDatasetRevision,
    radiusKm: state.radiusKm,
    nearby: state.nearby,
    serviceFilter: state.serviceFilter,
    eventFilter: state.eventFilter,
    division: state.division,
    hours: state.hours,
    search: state.search
  });
  finishCalculation({ eligibleCalls: eligibleCalls.length, outputCalls: state.filtered.length });
  const previouslyFocusedCallId = focusedCallId;
  focusedCallId = reconcileIncidentSelection(focusedCallId, state.filtered);
  document.querySelector("#filterSummary").textContent = filterSummary(state);
  syncMobileFilterIndicator();
  syncSearchControl();
  render(map);
  if (map && previouslyFocusedCallId !== focusedCallId) {
    updateMarkerAppearance(previouslyFocusedCallId);
    updateMarkerAppearance(focusedCallId);
  }
  rememberPreferences();
  return true;
}

function render(map = true) {
  if (els.windowLabel) {
    els.windowLabel.textContent = `${state.hours} hour${state.hours === 1 ? "" : "s"}`;
  }
  renderStats();
  renderNearbySummary();
  renderSirenResults();
  renderCalls();
  if (map) renderMap();
  renderDisruptions(state.disruptions, radiusFilterOrigin(), state.radiusKm, dispatchMap);
  els.eventToggles.forEach(toggle => {
    const active = toggle.dataset.eventFilter === state.eventFilter;
    toggle.classList.toggle("active", active);
    toggle.setAttribute("aria-pressed", String(active));
  });
}

function relevantIncidentFeeds() {
  const names=state.serviceFilter === 'all' ? ['TFS','TPS'] : [state.serviceFilter];
  return names.map(name => [name,state.feeds?.[name]]);
}

function incidentAvailability() {
  const feeds=relevantIncidentFeeds().map(([name,feed]) => ({name,...sourceStatus(name,feed)}));
  const unavailable=feeds.filter(feed => ['unavailable','not loaded'].includes(feed.status));
  const stale=feeds.filter(feed => feed.status === 'stale');
  const cachedSources=new Set(state.calls.map(call => call.source));
  return {
    unavailable,
    stale,
    hasRelevantCachedData:feeds.some(feed => cachedSources.has(feed.name)),
    allUnavailable:unavailable.length === feeds.length
  };
}

function renderIncidentFeedStatus() {
  const availability=incidentAvailability();
  const messages=[];
  for (const feed of availability.unavailable) {
    messages.push(feed.age
      ? `${feed.name} data is temporarily unavailable. Last successfully updated ${feed.age}. Previously loaded calls remain visible.`
      : `${feed.name} data is temporarily unavailable.`);
  }
  for (const feed of availability.stale) messages.push(`${feed.name}: Last successfully updated ${feed.age}. Data may be stale.`);
  callsFeedStatus.textContent=messages.join(' ');
  callsFeedStatus.hidden=!messages.length;
  const mobileMapDataWarning=document.querySelector('#mobileMapDataWarning');
  mobileMapDataWarning.textContent=messages.join(' ');
  mobileMapDataWarning.hidden=!messages.length;
  return availability;
}

function updateSirenMatches() {
  sirenMatches = sirenMode && state.nearby
    ? rankSirenMatches(state.calls, state.nearby)
    : [];
}

function renderSirenResults() {
  const panel = document.querySelector("#sirenResults");
  const list = document.querySelector("#sirenResultsList");
  panel.hidden = !sirenMode || !state.nearby;
  if (panel.hidden) {
    sirenMatches = [];
    list.replaceChildren();
    return;
  }

  updateSirenMatches();
  list.replaceChildren();
  if (!sirenMatches.length) {
    const empty = document.createElement("li");
    empty.className = "siren-results-empty";
    const availability=incidentAvailability();
    empty.textContent = availability.allUnavailable && !availability.hasRelevantCachedData
      ? 'Public dispatch data is temporarily unavailable.'
      : "No mapped public calls from the last 24 hours were found within 2 km.";
    list.append(empty);
    return;
  }

  for (const { call, distanceKm: distance } of sirenMatches) {
    const item = document.createElement("li");
    item.append(createIncidentCard(call, { distance: distanceLabel(distance), variant: "nearby" }));
    list.append(item);
  }
}

function renderNearbySummary() {
  const summary = document.querySelector("#nearbySummary");
  summary.hidden = false;
  document.querySelector("#nearbySummaryHeading").textContent = state.radiusKm === null ? "TORONTO SUMMARY" : "NEARBY SUMMARY";
  if (loadPhases.incidents === 'loading') {
    document.querySelector("#nearbySummaryText").textContent = 'Loading calls…';
    document.querySelector("#mobileNearbySummaryText").textContent = 'Loading calls…';
    if (!focusedClosureId && mobileSheetSummary) mobileSheetSummary.textContent = 'Loading nearby calls…';
    expandNearbyRadius.hidden = true;
    nearbySort.querySelector('[value="nearest"]').disabled = !state.nearby;
    return;
  }
  if (['error', 'unavailable'].includes(loadPhases.incidents)) {
    document.querySelector("#nearbySummaryText").textContent = 'Public dispatch data is temporarily unavailable.';
    document.querySelector("#mobileNearbySummaryText").textContent = 'Calls temporarily unavailable.';
    if (!focusedClosureId && mobileSheetSummary) mobileSheetSummary.textContent = 'Calls temporarily unavailable';
    expandNearbyRadius.hidden = true;
    nearbySort.querySelector('[value="nearest"]').disabled = !state.nearby;
    return;
  }
  const empty = !state.filtered.length
    ? nearbyEmptyState({
        radiusKm: state.radiusKm,
        origin: state.nearby,
        matchingCalls: callsMatchingNonGeographicFilters(),
        datasetIsEmpty: !state.calls.length,
        coordinatesForCall
      })
    : null;
  const summaryText = empty?.message
    || nearbySummary(state.filtered, state.radiusKm, Date.now(), state.nearby, coordinatesForCall);
  const mobileSummaryText = mobileNearbySummary(
    state.filtered, state.radiusKm, Date.now(), state.nearby, coordinatesForCall
  );
  document.querySelector("#nearbySummaryText").textContent = summaryText;
  document.querySelector("#mobileNearbySummaryText").textContent = mobileSummaryText;
  if (mobileSheetSummary) mobileSheetSummary.textContent = mobileSummaryText;
  expandNearbyRadius.hidden = empty?.nextRadiusKm === undefined;
  if (!expandNearbyRadius.hidden) {
    expandNearbyRadius.dataset.radiusKm = empty.nextRadiusKm === null ? 'toronto' : String(empty.nextRadiusKm);
    expandNearbyRadius.textContent = `Expand to ${radiusLabel(empty.nextRadiusKm)}`;
  }
  if (!state.nearby && state.nearbySort === 'nearest') state.nearbySort = NEARBY_SORT_DEFAULT;
  nearbySort.value = state.nearbySort;
  nearbySort.querySelector('[value="nearest"]').disabled = !state.nearby;
}

function callsMatchingNonGeographicFilters() {
  return state.calls.filter(call => {
    if (state.serviceFilter !== "all" && call.source !== state.serviceFilter) return false;
    if (!isWithinHistoryWindow(call.timestamp, state.hours)) return false;
    if (state.eventFilter === "ongoing" && !call.isOngoing) return false;
    if (state.eventFilter !== "all" && state.eventFilter !== "ongoing" && call.eventCategory !== state.eventFilter) return false;
    if (state.division !== "all" && call.division !== state.division) return false;
    return incidentMatchesSearch(call, state.search, displayLocation(call).text);
  });
}

function renderStats() {
  if (!els.callsCount) return;
  const calls = state.filtered;
  const divisions = countBy(calls, c => c.division);
  const descriptions = countBy(calls, c => c.description);

  const topDivision = maxEntry(divisions);
  const topDescription = maxEntry(descriptions);

  els.callsCount.textContent = calls.length.toLocaleString();
  els.callsCountFoot.textContent = state.search || state.division !== "all"
    ? "After current filters"
    : `Public calls in the last ${state.hours}h`;

  els.divisionCount.textContent = divisions.size.toLocaleString();

  els.busiestDivision.textContent = topDivision?.[0] || "—";
  els.busiestDivisionFoot.textContent = topDivision
    ? `${topDivision[1]} call${topDivision[1] === 1 ? "" : "s"}`
    : "No calls in current view";

  els.topCall.textContent = topDescription?.[0] || "—";
  els.topCallFoot.textContent = topDescription
    ? `${topDescription[1]} call${topDescription[1] === 1 ? "" : "s"}`
    : "No calls in current view";
}

async function handleIncidentShare(event, call) {
  event.preventDefault();
  event.stopPropagation();
  const button = event.currentTarget;
  const url = shareIncidentView(location.href, state, call.id);
  const status = button.closest('[data-call-id]').querySelector('.incident-share-status');
  try {
    const result = await shareIncident(navigator, {
      title: `${call.description} · SirenTO`,
      text: `${call.description} at ${displayLocation(call).text}`,
      url
    });
    status.textContent = result === 'copied' ? 'Link copied.' : result === 'manual' ? 'Copy unavailable.' : '';
    if (result === 'manual') {
      const output = document.querySelector('#shareLink');
      output.value = url;
      output.hidden = false;
      output.focus();
      output.select();
    }
  } catch {
    status.textContent = 'Could not copy link.';
  }
}

function createIncidentCard(call, { distance = "", variant = "list" } = {}) {
  const cardNumber = uxAudit.increment('incident-cards-created');
  const finishFirstCard = cardNumber === 1
    ? uxAudit.begin('first-card-container-to-meaningful-content', { variant })
    : () => null;
  const row = els.callTemplate.content.firstElementChild.cloneNode(true);
  const selected = variant !== "popup" && call.id === focusedCallId;
  row.dataset.callId = call.id;
  row.classList.add(`incident-card--${variant}`);
  row.classList.toggle("selected", selected);
  if (variant !== "popup" && coordinatesForCall(call)) {
    row.tabIndex = 0;
    row.setAttribute("role", "button");
    row.setAttribute("aria-pressed", String(selected));
    row.setAttribute("aria-label", `Show on map: ${call.description} at ${displayLocation(call).text}`);
  }

  row.querySelector(".call-title").textContent = call.description;
  const glossaryText = glossaryDefinition(call.description);
  if (glossaryText) {
    const glossaryId = `dispatch-glossary-${++glossaryPopoverSequence}`;
    const trigger = row.querySelector(".glossary-trigger");
    const popover = row.querySelector(".glossary-popover");
    trigger.hidden = false;
    trigger.setAttribute("aria-controls", glossaryId);
    trigger.setAttribute("aria-label", `What does “${call.description}” mean?`);
    popover.id = glossaryId;
    row.querySelector(".glossary-definition").textContent = glossaryText;
    row.querySelector(".glossary-footer").textContent = DISPATCH_GLOSSARY_FOOTER;
  }
  row.querySelector(".call-location").textContent = displayLocation(call).text;

  const distanceNode = row.querySelector(".distance-away");
  const distanceSeparator = row.querySelector(".distance-separator");
  distanceNode.textContent = distance;
  distanceNode.hidden = !distance;
  distanceSeparator.hidden = !distance;

  const reportedAge = row.querySelector(".time-ago");
  reportedAge.textContent = compactReportedAge(call.time);
  reportedAge.dataset.reportedAt = call.time.toISOString();
  row.querySelector(".reported-time").textContent = `Reported ${formatIncidentTime(call.time)}`;

  const updatedTime = row.querySelector(".updated-time");
  const updatedSeparator = row.querySelector(".updated-separator");
  updatedTime.hidden = !call.updatedAt;
  updatedSeparator.hidden = !call.updatedAt;
  if (call.updatedAt) {
    updatedTime.textContent = `Updated ${compactAge(call.updatedAt)}`;
    updatedTime.dataset.updatedAt = call.updatedAt.toISOString();
  }
  row.querySelector(".incident-source").textContent = sourceName(call.source);

  const changeBadge = row.querySelector(".incident-change-badge");
  const badge = incidentBadge(call);
  changeBadge.hidden = !badge;
  changeBadge.textContent = badge || "";
  changeBadge.classList.toggle("incident-change-badge--updated", badge === "UPDATED");

  // An "ONGOING" badge is a live-data claim, so do not carry it forward offline.
  const status = navigator.onLine ? callStatus(call) : null;
  const statusBadge = row.querySelector(".incident-status");
  statusBadge.hidden = !status;
  statusBadge.textContent = status || "";
  if (status) statusBadge.classList.add(`incident-status--${status.toLowerCase()}`);

  row.querySelector(".location-confidence").textContent = locationConfidence(call);

  const division = row.querySelector(".division-value");
  division.textContent = call.source === "TFS" && call.division !== "Unknown"
    ? `${call.division} (estimated)` : call.division;
  row.querySelector(".call-division").hidden = !call.division || call.division === "Unknown";

  const alarm = row.querySelector(".call-alarm");
  if (call.isFireRelated && call.alarmLevel) {
    alarm.hidden = false;
    row.querySelector(".alarm-value").textContent = call.alarmLevel;
  }
  const respondingUnits = respondingUnitLabel(call.respondingUnitCount);
  const respondingUnitsDetail = row.querySelector(".call-responding-units");
  respondingUnitsDetail.hidden = !respondingUnits;
  row.querySelector(".responding-unit-count").textContent = respondingUnits;
  const units = row.querySelector(".unit-list");
  const vehicles = row.querySelector(".call-vehicles");
  vehicles.hidden = !call.unitGroups.length;
  units.innerHTML = call.unitGroups.map(group =>
    `<div><strong>${escapeText(group.type)}:</strong> ${escapeText(group.values)}</div>`).join("");

  const hint = row.querySelector(".show-map-hint");
  hint.hidden = variant === "popup" || !coordinatesForCall(call);
  const shareButton = row.querySelector('.share-incident');
  shareButton.setAttribute('aria-label', `Share incident: ${call.description}`);
  shareButton.addEventListener('click', event => handleIncidentShare(event, call));
  finishFirstCard({ connected: row.isConnected, titleLength: call.description.length });
  return row;
}

function renderCalls() {
  const firstPass = uxAudit.increment('incident-render-passes') === 1;
  const finishRender = firstPass ? uxAudit.begin('first-incident-render', { incidents: state.filtered.length }) : () => null;
  if (loadPhases.incidents === 'loading' && !snapshotLoaded) {
    els.resultCount.textContent = 'LOADING';
    callsFeedStatus.hidden = true;
    if (mobileCallsFeedStatus) mobileCallsFeedStatus.hidden = true;
    finishRender({ cards: els.callList.querySelectorAll('.incident-card').length, loading: true });
    return;
  }
  const availability=renderIncidentFeedStatus();
  if (mobileCallsFeedStatus) {
    mobileCallsFeedStatus.textContent = callsFeedStatus.textContent;
    mobileCallsFeedStatus.hidden = Boolean(focusedClosureId) || callsFeedStatus.hidden;
  }
  if (!state.filtered.length && !availability.hasRelevantCachedData && availability.unavailable.length) {
    els.resultCount.textContent = availability.allUnavailable ? 'UNAVAILABLE' : '0 FROM AVAILABLE SOURCES';
  } else {
    els.resultCount.textContent = `${state.filtered.length} RESULT${state.filtered.length === 1 ? "" : "S"}`;
  }
  const availabilityKey = relevantIncidentFeeds()
    .map(([name, feed]) => `${name}:${feed?.status || 'not-loaded'}`)
    .join(',');
  const nextListKey = incidentListKey({
    filterKey: appliedIncidentFilterKey,
    sort: state.nearbySort,
    online: navigator.onLine,
    availability: availabilityKey
  });

  const renderList = list => {
    if (!list) return;
    if (state.filtered.length) {
      if (nextListKey === renderedIncidentListKey) return;
      const finishInitialBatch = uxAudit.begin('incident-list-initial-batch', {
        incidents: state.filtered.length,
        batchSize: INCIDENT_LIST_BATCH_SIZE
      });
      sortedIncidentCalls = sortNearbyCalls(state.filtered, state.nearbySort, state.nearby, coordinatesForCall);
      renderedIncidentCount = 0;
      renderedIncidentIds.clear();
      const fragment = document.createDocumentFragment();
      const batch = nextIncidentBatch(sortedIncidentCalls, renderedIncidentCount);
      batch.items.forEach(call => {
        const distance = distanceLabel(distanceKm(state.nearby, coordinatesForCall(call)));
        fragment.appendChild(createIncidentCard(call, { distance }));
        renderedIncidentIds.add(call.id);
      });
      renderedIncidentCount = batch.end;
      list.replaceChildren(fragment);
      appendIncidentLoadMoreControl(list, batch.remaining);
      renderedIncidentListKey = nextListKey;
      const selectedCall = focusedCallId && sortedIncidentCalls.find(call => call.id === focusedCallId);
      if (selectedCall) surfaceSelectedIncident(selectedCall);
      finishInitialBatch({ cards: list.querySelectorAll('.incident-card').length, remaining: batch.remaining });
      return;
    }
    if (nextListKey === renderedIncidentListKey) return;
    sortedIncidentCalls = [];
    renderedIncidentCount = 0;
    renderedIncidentIds.clear();
    let title=state.search.trim() ? 'No calls match your search.' : 'No calls match these filters.';
    let detail=state.search.trim()
      ? 'Clear the search or try a different call type, street, intersection, or division.'
      : 'Try another time window or division.';
    if (!availability.hasRelevantCachedData && availability.allUnavailable) {
      title='Public dispatch data is temporarily unavailable.';
      detail='The data source could not be checked. This is not a zero-call result.';
    } else if (!availability.hasRelevantCachedData && availability.unavailable.length) {
      title='No calls from the available sources match these filters.';
      detail='At least one selected data source could not be checked.';
    } else if (!state.calls.length) {
      title='No public dispatch calls currently reported.';
      detail='The data sources were checked successfully.';
    }
    list.innerHTML = `
      <div class="empty-state">
        <strong>${title}</strong>
        <p>${detail}</p>
      </div>`;
    renderedIncidentListKey = nextListKey;
  };

  renderList(els.callList);
  finishRender({ cards: els.callList.querySelectorAll('.incident-card').length });
  scheduleIncidentBadgeExpiry();
}

function currentIncidentListKey() {
  const availability = relevantIncidentFeeds()
    .map(([name, feed]) => `${name}:${feed?.status || 'not-loaded'}`)
    .join(',');
  return incidentListKey({
    filterKey: appliedIncidentFilterKey,
    sort: state.nearbySort,
    online: navigator.onLine,
    availability
  });
}

function appendIncidentLoadMoreControl(list, remaining) {
  list.querySelector('.incident-list-more')?.remove();
  if (!remaining) return;
  const control = document.createElement('div');
  control.className = 'incident-list-more';
  const button = document.createElement('button');
  button.type = 'button';
  button.textContent = `Show ${Math.min(INCIDENT_LIST_BATCH_SIZE, remaining)} more calls`;
  button.addEventListener('click', () => {
    button.disabled = true;
    button.textContent = 'Loading more calls…';
    requestAnimationFrame(() => appendNextIncidentBatch(list));
  });
  control.append(button);
  list.append(control);
}

function appendNextIncidentBatch(list = els.callList) {
  if (currentIncidentListKey() !== renderedIncidentListKey) return;
  const finishBatch = uxAudit.begin('incident-list-next-batch', { start: renderedIncidentCount });
  const batch = nextIncidentBatch(sortedIncidentCalls, renderedIncidentCount);
  const fragment = document.createDocumentFragment();
  for (const call of batch.items) {
    const surfaced = [...list.querySelectorAll('.incident-card--surfaced')]
      .find(row => row.dataset.callId === call.id);
    if (surfaced) {
      surfaced.classList.remove('incident-card--surfaced');
      fragment.append(surfaced);
      continue;
    }
    const distance = distanceLabel(distanceKm(state.nearby, coordinatesForCall(call)));
    fragment.append(createIncidentCard(call, { distance }));
    renderedIncidentIds.add(call.id);
  }
  renderedIncidentCount = batch.end;
  list.querySelector('.incident-list-more')?.remove();
  list.append(fragment);
  appendIncidentLoadMoreControl(list, batch.remaining);
  finishBatch({ cards: batch.items.length, remaining: batch.remaining });
  scheduleIncidentBadgeExpiry();
}

function surfaceSelectedIncident(call) {
  const previous = els.callList.querySelector('.incident-card--surfaced');
  if (previous && previous.dataset.callId !== call.id) {
    renderedIncidentIds.delete(previous.dataset.callId);
    previous.remove();
  }
  if (renderedIncidentIds.has(call.id)) return;
  const distance = distanceLabel(distanceKm(state.nearby, coordinatesForCall(call)));
  const row = createIncidentCard(call, { distance });
  row.classList.add('incident-card--surfaced');
  els.callList.prepend(row);
  renderedIncidentIds.add(call.id);
}

nearbySort.addEventListener('change', event => {
  const nextSort = event.target.value === 'nearest' && state.nearby ? 'nearest' : NEARBY_SORT_DEFAULT;
  if (nextSort === state.nearbySort) return;
  state.nearbySort = nextSort;
  nearbySort.value = state.nearbySort;
  renderCalls();
});

function updateIncidentBadges() {
  const calls = new Map(state.calls.map(call => [call.id, call]));
  document.querySelectorAll(".incident-card .incident-change-badge").forEach(node => {
    const call = calls.get(node.closest(".incident-card")?.dataset.callId);
    const badge = call ? incidentBadge(call) : null;
    node.hidden = !badge;
    node.textContent = badge || "";
    node.classList.toggle("incident-change-badge--updated", badge === "UPDATED");
  });
  scheduleIncidentBadgeExpiry();
}

function scheduleIncidentBadgeExpiry() {
  clearTimeout(incidentBadgeTimer);
  const now = Date.now();
  const expiries = state.calls.map(call => incidentBadgeExpiry(call, now)).filter(Number.isFinite);
  if (!expiries.length) return;
  incidentBadgeTimer = setTimeout(updateIncidentBadges, Math.max(0, Math.min(...expiries) - now + 25));
}

function initMap() {
  if (dispatchMap || !els.dispatchMap) return;
  if (typeof L === "undefined") {
    setMapLoadPhase('error', 'Map is temporarily unavailable.');
    return;
  }

  const finishCreation = uxAudit.begin('first-map-creation');
  dispatchMap = L.map(els.dispatchMap, {
    zoomControl: false,
    attributionControl: true
  }).setView(TORONTO_CENTER, 10);

  dispatchMap.attributionControl.setPrefix(false);
  syncMapAttributionPosition();

  L.control.zoom({ position: "bottomright" }).addTo(dispatchMap);
  const tileLayer = L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", {
    attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>',
    subdomains: "abc",
    maxZoom: 19
  });
  tileLayer.once('load', () => {
    auditReadiness.tiles = true;
    uxAudit.mark('first-leaflet-tile-ready');
    markFullyRenderedWhenReady();
  });
  tileLayer.once('tileload', () => setMapLoadPhase('ready'));
  tileLayer.once('tileerror', () => setMapLoadPhase('error', 'Map tiles are temporarily unavailable.'));
  tileLayer.addTo(dispatchMap);
  callLayer = L.layerGroup().addTo(dispatchMap);
  nearbyOriginLayer = L.layerGroup().addTo(dispatchMap);
  dispatchMap.on('roadclosureselect', event => selectClosure(event.item,event.layer));
  dispatchMap.on("zoomend", () => {
    expandedCluster.clear();
    scheduleMapMarkerRender();
  });
  dispatchMap.on("click", event => {
    if (!choosingArea) return;
    chooseManualArea([event.latlng.lat, event.latlng.lng]);
  });
  setupDivisionOverlay();
  auditReadiness.map = true;
  finishCreation();
  markFullyRenderedWhenReady();
}

function clearClosureSelection() {
  const hadClosure=focusedClosureId !== null;
  focusedClosureId=null;
  if (mobileClosureDetail) {
    mobileClosureDetail.hidden=true;
    mobileClosureDetail.replaceChildren();
  }
  mobileSheetCallList.hidden=false;
  mobileCallsFeedStatus.hidden=callsFeedStatus.hidden;
  if (hadClosure) renderNearbySummary();
}

function selectClosure(closure, layer) {
  if (!closure) return;
  focusedClosureId=String(closure.id ?? '');
  const detail=createClosureDetail(closure);
  if (isMobileViewLayout()) {
    const back=document.createElement('button');
    back.type='button';back.className='closure-detail-back';back.textContent='← Back to incident list';
    back.addEventListener('click',clearClosureSelection);
    mobileClosureDetail.replaceChildren(back,detail);
    mobileClosureDetail.hidden=false;
    mobileSheetCallList.hidden=true;
    mobileCallsFeedStatus.hidden=true;
    mobileSheetSummary.textContent=closure.street || closure.title || 'Road closure';
    setMobileSheetState(mobileSheetState === 'collapsed' ? 'half' : mobileSheetState);
    return;
  }
  layer?.bindPopup?.(detail,{minWidth:260,maxWidth:340,closeOnClick:false}).openPopup?.();
}

function mapAllowsBoundaryWork() {
  if (!dispatchMap || !divisionLayer || !boundaryVisible || !dispatchMap.hasLayer(divisionLayer)) return false;
  if (isMobileViewLayout() && mobileView !== 'map') return false;
  const rect = els.dispatchMap?.getBoundingClientRect?.();
  const size = dispatchMap.getSize?.();
  return Boolean(rect?.width > 0 && rect?.height > 0 && size?.x > 0 && size?.y > 0);
}

function redrawPoliceBoundaries() {
  divisionGeometryLayer?.eachLayer?.(layer => layer.redraw?.());
}

function captureBoundaryDiagnostic(reason) {
  if (!boundaryDebugEnabled) return null;
  const police = capturePoliceBoundaryRenderState({
    map: dispatchMap,
    layer: divisionGeometryLayer,
    lifecycleEvent: reason,
    scheduling: {
      boundaryDirty,
      boundaryRenderFramePending: boundaryRenderFrame !== null,
      layoutTransitionPending: boundaryLifecycleScheduler.pending(),
      generation: boundaryRenderGeneration
    }
  });
  const roads = captureRoadClosureRenderState?.(dispatchMap);
  boundaryDebugCapture = {
    ...police,
    sheetState: mobileSheetState,
    mobileView,
    police: {
      layerId: divisionGeometryLayer?._leaflet_id ?? null,
      rendererId: divisionRenderer?._leaflet_id ?? null,
      pane: divisionRenderer?.options?.pane || 'overlayPane',
      visible: Boolean(divisionGeometryLayer && dispatchMap?.hasLayer?.(divisionGeometryLayer))
    },
    roads,
    interaction: {
      sharedPane: Boolean(roads?.pane && roads.pane === (divisionRenderer?.options?.pane || 'overlayPane')),
      sharedRenderer: Boolean(roads?.rendererIds?.includes(divisionRenderer?._leaflet_id)),
      sharedCanvas: false
    }
  };
  boundaryDebugHistory.push(boundaryDebugCapture);
  if (boundaryDebugHistory.length > 80) boundaryDebugHistory.shift();
  const debugPanel = document.querySelector('#policeBoundaryDebugPanel');
  if (debugPanel) {
    debugPanel.dataset.lifecycleEvent = reason;
    debugPanel.dataset.issueCount = String(boundaryDebugCapture.issues.length);
    debugPanel.dataset.dimensionIssueCount = String(boundaryDebugCapture.dimensionIssues.length);
    debugPanel.dataset.rendererId = String(divisionRenderer?._leaflet_id ?? '');
    debugPanel.dataset.layerId = String(divisionGeometryLayer?._leaflet_id ?? '');
  }
  return boundaryDebugCapture;
}

function boundaryDiagnosticExport() {
  return {
    schema: 'sirento-police-boundary-debug-v1',
    exportedAt: new Date().toISOString(),
    userLocationIncluded: false,
    entries: boundaryDebugHistory
  };
}

function installBoundaryDebugExport() {
  if (document.querySelector('#policeBoundaryDebugPanel')) return;
  const panel = document.createElement('div');
  panel.id = 'policeBoundaryDebugPanel';
  panel.className = 'police-boundary-debug-panel';
  panel.style.position = 'fixed';
  panel.setAttribute('role', 'group');
  panel.setAttribute('aria-label', 'Police boundary diagnostics');
  const status = document.createElement('span');
  status.textContent = 'Boundary diagnostics active';
  const copy = document.createElement('button');
  copy.type = 'button';
  copy.textContent = 'Copy JSON';
  copy.addEventListener('click', async () => {
    captureBoundaryDiagnostic('manual-copy');
    try {
      await navigator.clipboard.writeText(JSON.stringify(boundaryDiagnosticExport(), null, 2));
      status.textContent = 'Diagnostics copied';
    } catch {
      status.textContent = 'Copy unavailable; use Download';
    }
  });
  const download = document.createElement('button');
  download.type = 'button';
  download.textContent = 'Download JSON';
  download.addEventListener('click', () => {
    captureBoundaryDiagnostic('manual-download');
    const url = URL.createObjectURL(new Blob([JSON.stringify(boundaryDiagnosticExport(), null, 2)], {type:'application/json'}));
    const anchor = document.createElement('a');
    anchor.href = url;
    anchor.download = `sirento-boundary-debug-${Date.now()}.json`;
    anchor.click();
    setTimeout(() => URL.revokeObjectURL(url), 0);
    status.textContent = 'Diagnostics downloaded';
  });
  panel.append(status, copy, download);
  document.body.append(panel);
}

function captureBoundaryDebugAfterPaint(reason) {
  if (!boundaryDebugEnabled) return;
  requestAnimationFrame(() => {
    captureBoundaryDiagnostic(reason);
    uxAudit.record('police-boundary-render-diagnostic', {
      reason, renderer: boundaryDebugCapture.renderer.kind, issues: boundaryDebugCapture.issues.length
    });
    if (boundaryDebugCapture.issues.length) {
      console.warn('Police boundary projected-geometry diagnostic', boundaryDebugCapture);
    }
  });
}

function boundaryDetails(properties) {
  const content = document.createElement("div");
  const title = document.createElement("strong");
  title.textContent = properties.UNIT_NAME || `Division ${properties.AREA_NAME}`;
  const address = document.createElement("div");
  address.textContent = properties.ADDRESS
    ? `Station: ${properties.ADDRESS}, ${properties.CITY || "Toronto"}`
    : "Station address unavailable";
  content.append(title, address);
  return content;
}

async function initializePoliceBoundaries(generation, reason) {
  if (!mapAllowsBoundaryWork() || generation !== boundaryRenderGeneration) return;
  if (divisionGeometryLayer) {
    const finishRender = uxAudit.begin('police-boundary-layer-render', { reason, reused: true });
    if (!dispatchMap.hasLayer(divisionGeometryLayer)) divisionGeometryLayer.addTo(dispatchMap);
    if (boundaryDirty) redrawPoliceBoundaries();
    boundaryDirty = false;
    boundaryLifecycleEvent = reason;
    finishRender();
    uxAudit.mark('police-boundary-redraw-complete', { reason });
    captureBoundaryDebugAfterPaint(reason);
    return;
  }
  const finishBoundary = uxAudit.begin('police-boundary-layer-initialization', { reason });
  try {
    divisionDataPromise ||= fetch("./data/police-divisions.geojson?v=station-details-1").then(response => {
      if (!response.ok) throw new Error("Division boundaries unavailable");
      return response.json();
    });
    const boundaries = await divisionDataPromise;
    if (!mapAllowsBoundaryWork() || generation !== boundaryRenderGeneration) {
      finishBoundary({ deferred: true });
      return;
    }
    const geometryBefore = diagnosePoliceBoundaryGeometry(boundaries);
    const rendererMode = mobileAuditFixture?.boundaryRenderer || 'canvas';
    if (!dispatchMap.getPane('policeBoundaryPane')) {
      const pane = dispatchMap.createPane('policeBoundaryPane');
      pane.style.zIndex = '430';
      pane.style.pointerEvents = 'none';
    }
    divisionRenderer = rendererMode === 'svg'
      ? L.svg({ padding: 0.5, pane: 'policeBoundaryPane' })
      : L.canvas({ padding: 0.5, pane: 'policeBoundaryPane' });
    const boundaryColor = getComputedStyle(document.documentElement).getPropertyValue("--boundary-marker").trim();
    divisionGeometryLayer = createPoliceBoundaryLayer(L, boundaries, {
      color: boundaryColor,
      renderer: divisionRenderer,
      onEachFeature(feature, polygon) {
        polygon.__policeBoundaryFeatureIndex = boundaries.features.indexOf(feature);
        polygon.__policeBoundaryRingCount = policeBoundaryRingCount(feature);
        polygon.bindTooltip(boundaryDetails(feature.properties), { sticky: true });
        polygon.bindPopup(boundaryDetails(feature.properties));
      }
    });
    divisionGeometryLayer.addTo(dispatchMap);
    const geometryAfter = diagnosePoliceBoundaryGeometry(boundaries);
    boundaryDirty = false;
    boundaryLifecycleEvent = reason;
    uxAudit.record('police-boundary-geometry-diagnostic', {
      ...geometryBefore,
      renderer: rendererMode,
      checksumAfterRender: geometryAfter.checksum,
      mutatedByRender: geometryBefore.checksum !== geometryAfter.checksum
    });
    finishBoundary({ visible: boundaryVisible, renderer: rendererMode });
    captureBoundaryDebugAfterPaint(reason);
  } catch (error) {
    divisionDataPromise = null;
    finishBoundary({ error: error.message });
    console.warn("Could not load the optional division overlay", error);
  } finally {
    auditReadiness.boundaries = true;
    markFullyRenderedWhenReady();
  }
}

function queuePoliceBoundaryWork(reason) {
  boundaryDirty = true;
  boundaryLifecycleEvent = reason;
  captureBoundaryDiagnostic(`${reason}:requested`);
  boundaryRenderGeneration += 1;
  const generation = boundaryRenderGeneration;
  if (boundaryRenderFrame !== null) cancelAnimationFrame(boundaryRenderFrame);
  boundaryRenderFrame = null;
  if (!mapAllowsBoundaryWork()) return;
  boundaryRenderFrame = requestAnimationFrame(() => {
    boundaryRenderFrame = requestAnimationFrame(() => {
      boundaryRenderFrame = null;
      void initializePoliceBoundaries(generation, reason);
    });
  });
}

function setupDivisionOverlay() {
  divisionLayer = L.layerGroup();
  dispatchMap.on('overlayadd overlayremove', event => {
    if (event.layer !== divisionLayer) return;
    const finishToggle = uxAudit.begin('interaction:police-boundaries');
    boundaryVisible = event.type === 'overlayadd';
    boundaryLifecycleEvent = event.type;
    if (boundaryVisible) queuePoliceBoundaryWork('overlay-enabled');
    else {
      captureBoundaryDiagnostic('boundaries-off');
      boundaryRenderGeneration += 1;
      if (boundaryRenderFrame !== null) cancelAnimationFrame(boundaryRenderFrame);
      boundaryRenderFrame = null;
      if (divisionGeometryLayer && dispatchMap.hasLayer(divisionGeometryLayer)) {
        dispatchMap.removeLayer(divisionGeometryLayer);
      }
    }
    rememberPreferences();
    finishToggle({ visible: boundaryVisible, constructionDeferred: boundaryVisible && !divisionGeometryLayer });
  });
  L.control.layers(null, { "Police division boundaries": divisionLayer }, {
    collapsed: false, position: "topright"
  }).addTo(dispatchMap);
  if (boundaryVisible) {
    divisionLayer.addTo(dispatchMap);
    queuePoliceBoundaryWork('initial-visible-map');
  }
  auditReadiness.boundaries = true;
  markFullyRenderedWhenReady();
  for (const eventName of ['zoomstart', 'zoomend', 'movestart', 'moveend', 'resize']) {
    dispatchMap.on(eventName, () => {
      boundaryLifecycleEvent = eventName;
      if (eventName.endsWith('end') || eventName === 'resize') captureBoundaryDebugAfterPaint(eventName);
    });
  }
  dispatchMap.on('roadclosureredraw', () => captureBoundaryDebugAfterPaint('road-closure-redraw-complete'));
  if (boundaryDebugEnabled) {
    globalThis.__sirentoPoliceBoundaryDebug = {
      capture: () => captureBoundaryDiagnostic(boundaryLifecycleEvent),
      latest: () => boundaryDebugCapture,
      history: () => structuredClone(boundaryDebugHistory),
      renderer: () => mobileAuditFixture?.boundaryRenderer || 'canvas'
    };
    installBoundaryDebugExport();
  }
}

function coordinatesForCall(call) {
  const point = call.geography?.coordinates;
  return Array.isArray(point) && point.length === 2 && point.every(Number.isFinite) ? point : null;
}

function displayLocation(call) {
  const location = call.geography || locationDisplay(call.location);
  return { ...location, text: expandLocationAbbreviations(location.text) };
}

function isApproximateLocation(call) {
  return displayLocation(call).approximate !== false;
}

function markerAccessibleLabel(call, selected, now = Date.now()) {
  const age = markerAgeLabel(markerAgeTier(call.timestamp, now));
  return `${selected ? "Selected incident: " : "Incident: "}${call.source} ${call.eventCategory}, ${call.description}, ${age}`;
}

function markerIcon(call, selected = false, sirenMatch = false, now = Date.now()) {
  const ageTier = markerAgeTier(call.timestamp, now);
  const approximate = isApproximateLocation(call);
  return L.divIcon({
    className: "dispatch-marker-wrap",
    html: `<span class="dispatch-marker service-${call.source.toLowerCase()} category-${call.eventCategory} age-${ageTier}${approximate ? " approximate" : ""}${selected ? " selected" : ""}${sirenMatch ? " siren-match" : ""}"><span class="dispatch-marker-glyph" aria-hidden="true">${markerGlyph(call.source, call.eventCategory)}</span></span>`,
    iconSize: [22, 22],
    iconAnchor: [11, 11]
  });
}

function updateMarkerAppearances(now = Date.now()) {
  mapMarkers.forEach((_marker, id) => updateMarkerAppearance(id, now));
}

function updateMarkerAppearance(id, now = Date.now()) {
  const marker = mapMarkers.get(id);
  const call = marker && state.filtered.find(item => item.id === id);
  if (!call) return;
  const selected = id === focusedCallId;
  const label = markerAccessibleLabel(call, selected, now);
  const sirenMatch = sirenMatches.some(match => match.call.id === id);
  marker.setIcon(markerIcon(call, selected, sirenMatch, now));
  marker.getElement()?.setAttribute("aria-label", label);
  marker.getElement()?.setAttribute("title", label);
}

function scheduleMapMarkerRender() {
  if (scheduledMarkerRender !== null) return;
  scheduledMarkerRender = requestAnimationFrame(() => {
    scheduledMarkerRender = null;
    renderMapMarkers();
  });
}

function incidentRepresentationVersion(group, expanded, sirenIds) {
  if (!expanded && group.length > 1) {
    return JSON.stringify({
      incidents: group.map(({call, coordinates}) => [call.id, coordinates, call.timestamp, sirenIds.has(call.id)]),
      focusedCallId: group.some(({call}) => call.id === focusedCallId) ? focusedCallId : null
    });
  }
  return JSON.stringify(group.map(({call, coordinates}) => [
    call, coordinates, sirenIds.has(call.id), state.nearby
  ]));
}

function renderMapMarkers() {
  const finishMarkers = uxAudit.begin('marker-cluster-creation', { incidents: state.filtered.length });
  const sirenIds = new Set(sirenMatches.map(match => match.call.id));

  const locatedCalls = state.filtered
    .map(call => ({ call, coordinates: coordinatesForCall(call) }))
    .filter(item => item.coordinates);

  const addMarker = ({call, coordinates}, position = coordinates, layers = []) => {
    const tooltip = document.createElement('span');
    tooltip.textContent = `${call.source}: ${call.description}`;
    const selected = call.id === focusedCallId;
    const accessibleLabel = markerAccessibleLabel(call, selected);
    const marker = L.marker(position, {
      title: accessibleLabel,
      alt: accessibleLabel,
      icon: markerIcon(call, selected, sirenIds.has(call.id))
    })
      .bindTooltip(tooltip, { direction: "top" })
      .bindPopup(createIncidentCard(call, {
        distance: distanceLabel(distanceKm(state.nearby, coordinates)),
        variant: "popup"
      }), { minWidth: 280, maxWidth: 360, closeOnClick: false })
      .on("click", event => {
        const mobile = isMobileViewLayout();
        if (mobile) setMobileSheetState(mobileSheetState === "collapsed" ? "half" : mobileSheetState);
        selectCall(call.id, { pan: false, revealRow: true });
        if (!mobile) setTimeout(() => event.target.openPopup(), 0);
      });
    marker.addTo(callLayer);
    layers.push(marker);
    mapMarkers.set(call.id, marker);
    return marker;
  };
  const groups = clusterPoints(locatedCalls, point => dispatchMap.project(point, dispatchMap.getZoom()));
  const representations = groups.map(group => {
    const expanded = canExpandCluster(group) && group.every(item => expandedCluster.has(item.call.id));
    const version = incidentRepresentationVersion(group, expanded, sirenIds);
    return {group, expanded, key: incidentGroupKey(group, expanded, version)};
  });
  const desiredKeys = representations.map(({key}) => key);
  const changes = reconcileIncidentLayers(renderedIncidentLayers, desiredKeys);
  for (const key of changes.remove) {
    renderedIncidentLayers.get(key).layers.forEach(layer => callLayer.removeLayer(layer));
    renderedIncidentLayers.delete(key);
  }
  mapMarkers = new Map();
  for (const {group, expanded, key} of representations) {
    const retained = renderedIncidentLayers.get(key);
    if (retained) {
      retained.markers.forEach((marker, id) => mapMarkers.set(id, marker));
      continue;
    }
    const layers = [];
    const markers = new Map();
    if (group.length === 1) {
      const marker = addMarker(group[0], group[0].coordinates, layers);
      markers.set(group[0].call.id, marker);
      renderedIncidentLayers.set(key, {layers, markers});
      continue;
    }
    const center = L.latLngBounds(group.map(item => item.coordinates)).getCenter();
    if (expanded) {
      const pixel = dispatchMap.latLngToLayerPoint(center);
      group.forEach((item,index) => {
        const spread = spreadPoint(index,group.length,pixel);
        const position = dispatchMap.layerPointToLatLng(L.point(spread.x,spread.y));
        const connector = L.polyline([item.coordinates,position],{className:'cluster-connector',color:'#b7c8d9',weight:1,interactive:false}).addTo(callLayer);
        layers.push(connector);
        const marker = addMarker(item,position,layers);
        markers.set(item.call.id, marker);
      });
      renderedIncidentLayers.set(key, {layers, markers});
      continue;
    }
    const matchingCluster = group.some(item => sirenIds.has(item.call.id));
    const newestTimestamp = Math.max(...group.map(item => item.call.timestamp));
    const clusterTier = markerAgeTier(newestTimestamp);
    const clusterLabel = `${group.length} calls; newest ${markerAgeLabel(clusterTier)}; zoom or expand`;
    const cluster = L.marker(center,{icon:L.divIcon({className:`call-cluster age-${clusterTier}${matchingCluster ? ' siren-match' : ''}`,html:String(group.length),iconSize:[40,40],iconAnchor:[20,20]}), title:clusterLabel, alt:clusterLabel})
      .on('click', () => {
        if (dispatchMap.getZoom() < 18) dispatchMap.setView(center,Math.min(18,dispatchMap.getZoom()+2));
        else if (canExpandCluster(group)) { expandedCluster = new Set(group.map(item => item.call.id)); renderMapMarkers(); }
      }).addTo(callLayer);
    layers.push(cluster);
    const selectedItem = group.length > 1 && group.find(item => item.call.id === focusedCallId);
    if (selectedItem && !canExpandCluster(group)) {
      const marker = addMarker(selectedItem, selectedItem.coordinates, layers);
      markers.set(selectedItem.call.id, marker);
    }
    renderedIncidentLayers.set(key, {layers, markers});
  }

  const mapStatusText = locatedCalls.length ? `${locatedCalls.length}/${state.filtered.length} LOCATED` : "NO MAPPED LOCATIONS";
  els.mapStatus.textContent = mapStatusText;
  document.querySelector('#mobileMapStatus').textContent = mapStatusText;
  nearbyOriginLayer?.clearLayers();
  if (state.nearby && state.radiusKm !== null) {
    L.circle(state.nearby, { className: 'nearby-radius', radius: state.radiusKm * 1000, color: '#63e6be', weight: 1, opacity: .65, fillOpacity: .035, interactive: false }).addTo(nearbyOriginLayer);
    L.circleMarker(state.nearby, { className: 'nearby-origin', radius: 6, color: '#fff', weight: 2, fillColor: '#63e6be', fillOpacity: 1, interactive: false }).addTo(nearbyOriginLayer);
  }
  if (!mapHasFitted && state.nearby && state.radiusKm !== null) {
    mapHasFitted = true;
    dispatchMap.setView(state.nearby, state.radiusKm <= 0.5 ? 15 : state.radiusKm <= 2 ? 14 : 12);
  } else if (locatedCalls.length && !mapHasFitted) {
    mapHasFitted = true;
    dispatchMap.fitBounds(L.latLngBounds(locatedCalls.map(item => item.coordinates)), { padding: [24, 24], maxZoom: 12 });
  }
  finishMarkers({ locatedCalls: locatedCalls.length, representations: representations.length });
}

function renderMap() {
  if (!dispatchMap && uxReliabilityFixture?.mapDelayMs) {
    if (!mapInitializationScheduled) {
      mapInitializationScheduled = true;
      setTimeout(() => {
        mapInitializationScheduled = false;
        initMap();
        if (dispatchMap) renderMapMarkers();
      }, uxReliabilityFixture.mapDelayMs);
    }
    return;
  }
  initMap();
  if (!dispatchMap) return;

  renderMapMarkers();
}

function selectCall(callId, { pan = true, revealRow = false, panIfNeeded = false } = {}) {
  const call = state.filtered.find(item => item.id === callId);
  if (!call) return;

  clearClosureSelection();

  const previouslyFocusedCallId = focusedCallId;
  focusedCallId = callId;
  surfaceSelectedIncident(call);
  if (pan && dispatchMap && coordinatesForCall(call)) {
    const reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    const zoom = dispatchMap.getZoom();
    const coordinates = coordinatesForCall(call);
    const located = state.filtered.map(item => ({call:item,coordinates:coordinatesForCall(item)})).filter(item=>item.coordinates);
    dispatchMap.stop();
    const focusedGroup = focusGroup(located,callId,point=>dispatchMap.project(point,zoom));
    const nextExpandedCluster = new Set(canExpandCluster(focusedGroup) ? focusedGroup.map(item=>item.call.id) : []);
    const clusterChanged = expandedCluster.size !== nextExpandedCluster.size ||
      [...expandedCluster].some(id => !nextExpandedCluster.has(id));
    const largeClusterSelectionChanged = focusedGroup.length > 1 && !canExpandCluster(focusedGroup) && previouslyFocusedCallId !== callId;
    if (clusterChanged || largeClusterSelectionChanged) {
      expandedCluster = nextExpandedCluster;
      renderMapMarkers();
    }
    if (!panIfNeeded || !dispatchMap.getBounds().contains(coordinates)) {
      dispatchMap.panTo(coordinates, { animate: !reducedMotion, duration: .35, easeLinearity: .25 });
    }
  }


  let selectedRow;
  document.querySelectorAll(".incident-card:not(.incident-card--popup)").forEach(row => {
    const selected = row.dataset.callId === callId;
    row.classList.toggle("selected", selected);
    if (row.hasAttribute("role")) row.setAttribute("aria-pressed", String(selected));
    row.classList.remove("pin-highlight");
    if (selected && row.classList.contains("incident-card--list")) {
      if (!selectedRow || (isMobileViewLayout() && row.closest("#mobileSheetCallList"))) selectedRow = row;
    }
  });
  clearTimeout(rowHighlightTimer);
  if (revealRow && selectedRow) {
    selectedRow.focus({ preventScroll: true });
    selectedRow.scrollIntoView({
      behavior: window.matchMedia("(prefers-reduced-motion: reduce)").matches ? "auto" : "smooth",
      block: "center"
    });
    selectedRow.classList.add("pin-highlight");
    rowHighlightTimer = setTimeout(() => selectedRow.classList.remove("pin-highlight"), 3500);
  }

  if (previouslyFocusedCallId !== callId) updateMarkerAppearance(previouslyFocusedCallId);
  updateMarkerAppearance(callId);
  const marker = mapMarkers.get(callId);
  if (marker) {
    marker.openTooltip();
  }
}

function countBy(items, selector) {
  const map = new Map();
  for (const item of items) {
    const key = selector(item) || "Unknown";
    map.set(key, (map.get(key) || 0) + 1);
  }
  return map;
}

function maxEntry(map) {
  return [...map.entries()].sort((a, b) => b[1] - a[1])[0] || null;
}

function formatTime(date) {
  return new Intl.DateTimeFormat("en-CA", {
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
    timeZone: "America/Toronto"
  }).format(date);
}

function formatIncidentTime(date) {
  return new Intl.DateTimeFormat("en-US", {
    hour: "numeric",
    minute: "2-digit",
    hour12: true,
    timeZone: "America/Toronto"
  }).format(date);
}

function formatDate(date) {
  return new Intl.DateTimeFormat("en-CA", {
    month: "short",
    day: "numeric",
    timeZone: "America/Toronto"
  }).format(date);
}

function updateFreshness() {
  const newest = state.calls[0]?.time;
  if (!els.lastUpdated) return;
  if (newest) {
    els.lastUpdated.textContent = `${formatDate(newest)} · ${formatTime(newest)}`;
  } else if (state.lastIngest) {
    els.lastUpdated.textContent = state.lastIngest;
  } else {
    els.lastUpdated.textContent = "Unknown";
  }
}

async function checkForChanges() {
  // Reload the snapshot even if sourceUpdatedAt is unchanged: a successful fetch
  // may update fetchedAt or correct normalized fields without changing that marker.
  await loadData();
}

document.querySelector('#historyHours').addEventListener('change', event => {
  const hours = Number(event.target.value);
  if (hours === state.hours) return;
  state.hours = hours;
  applyFilters();
});

els.divisionSelect.addEventListener("change", (e) => {
  const division = e.target.value === "all" ? "all" : decodeURIComponent(e.target.value);
  if (division === state.division) return;
  state.division = division;
  applyFilters();
});

els.searchInput.addEventListener("input", (e) => {
  if (e.target.value === state.search) return;
  state.search = e.target.value;
  applyFilters();
});

els.clearSearch.addEventListener("click", () => {
  if (!state.search) return;
  state.search = "";
  applyFilters();
  els.searchInput.focus();
});

els.eventToggles.forEach(toggle => {
  toggle.addEventListener("click", () => {
    if (toggle.dataset.eventFilter === state.eventFilter) return;
    state.eventFilter = toggle.dataset.eventFilter;
    applyFilters();
  });
});

function handleIncidentListClick(event) {
  if (event.target.closest("summary, .glossary-trigger, .glossary-popover, .share-incident")) return;
  const row = event.target.closest(".incident-card--list");
  if (!row) return;
  const showOnMap = event.target.closest(".show-map-hint");
  selectCall(row.dataset.callId, { pan: !isMobileViewLayout() || mobileView === "map" });
  if (showOnMap) {
    event.preventDefault();
    setMobileView("map", { focusSelection: true });
    els.dispatchMap.scrollIntoView({
      behavior: window.matchMedia("(prefers-reduced-motion: reduce)").matches ? "auto" : "smooth",
      block: "center"
    });
  }
}

function handleIncidentListKeydown(event) {
  if (event.target.closest(".show-map-hint, .glossary-trigger, .glossary-popover, .share-incident")) return;
  if (event.key !== "Enter" && event.key !== " ") return;
  const row = event.target.closest(".incident-card--list");
  if (!row) return;
  event.preventDefault();
  selectCall(row.dataset.callId, { pan: !isMobileViewLayout() || mobileView === "map" });
}

[els.callList].filter(Boolean).forEach(list => {
  list.addEventListener("click", auditInteraction('incident-selection', handleIncidentListClick));
  list.addEventListener("keydown", handleIncidentListKeydown);
});

function closeGlossaryPopovers(except = null) {
  document.querySelectorAll(".glossary-trigger[aria-expanded='true']").forEach(trigger => {
    if (trigger === except) return;
    trigger.setAttribute("aria-expanded", "false");
    const popover = document.getElementById(trigger.getAttribute("aria-controls"));
    if (popover) popover.hidden = true;
  });
}

document.addEventListener("click", event => {
  const trigger = event.target.closest(".glossary-trigger");
  if (!trigger) {
    if (!event.target.closest(".glossary-popover")) closeGlossaryPopovers();
    return;
  }
  const opening = trigger.getAttribute("aria-expanded") !== "true";
  closeGlossaryPopovers(trigger);
  trigger.setAttribute("aria-expanded", String(opening));
  const popover = document.getElementById(trigger.getAttribute("aria-controls"));
  if (popover) popover.hidden = !opening;
});

document.addEventListener("keydown", event => {
  if (event.key !== "Escape") return;
  const trigger = document.querySelector(".glossary-trigger[aria-expanded='true']");
  if (!trigger) return;
  closeGlossaryPopovers();
  trigger.focus();
});

async function refreshLoop() {
  try {
    await checkForChanges();
  } finally {
    setTimeout(refreshLoop, CONFIG.refreshCheckMs);
  }
}

setInterval(() => {
  els.footerClock.textContent = new Intl.DateTimeFormat("en-CA", {
    dateStyle: "medium",
    timeStyle: "medium",
    timeZone: "America/Toronto"
  }).format(new Date());
}, 1000);

try {
  const saved = loadPreferences(localStorage);
  if (saved && !mobileAuditFixture) {
    Object.assign(state,saved.filters);
    state.radiusKm = saved.radiusKm;
    document.querySelector('#roadOverlay').checked = saved.roads;
    boundaryVisible = saved.boundaries;
    themePreference = saved.theme;
    document.querySelector('#themePreference').value = themePreference;
    syncTheme();
    if (!mobileViewInteracted) setMobileView(saved.mobileView, { persist: false });
    syncFilterControls();
  }
} catch { /* Defaults remain usable when storage is blocked. */ }
if (mobileAuditFixture) {
  document.querySelector('#roadOverlay').checked = mobileAuditFixture.roads;
  boundaryVisible = mobileAuditFixture.boundaries;
  if (!mobileViewInteracted) setMobileView(mobileAuditFixture.view, { persist: false });
  setMobileSheetState(mobileAuditFixture.sheet);
  Object.assign(state, mobileAuditFixtureFilters(mobileAuditFixture.filters));
  syncFilterControls();
}
const savedLocationState = loadSavedLocationState(localStorage);
state.savedLocations = savedLocationState.locations;
state.locationContext = savedLocationState.locationContext;
systemTheme.addEventListener('change', syncTheme);
document.querySelector('#themePreference').addEventListener('change', event => {
  themePreference = normalizeThemePreference(event.target.value);
  event.target.value = themePreference;
  syncTheme();
  rememberPreferences();
});
if (initialParams.has('view')) {
  Object.assign(state, readFilters(initialParams));
  syncFilterControls();
}
refreshLoop();
renderOfflineStatus();
window.addEventListener('offline', () => {
  renderOfflineStatus();
  if (snapshotLoaded) render();
});
window.addEventListener('online', () => {
  renderOfflineStatus();
  if (snapshotLoaded) render();
  void checkForChanges();
});

document.querySelector("#serviceFilter").addEventListener("change", event => {
  if (event.target.value === state.serviceFilter) return;
  state.serviceFilter = event.target.value;
  applyFilters();
});

const nearButton = document.querySelector('#nearMe');
const hearSirensButton = document.querySelector('#hearSirens');
const nearStatus = document.querySelector('#nearStatus');
const nearControls = document.querySelector('#nearControls');
const chooseAreaButton = document.querySelector('#chooseArea');
const saveLocationButton = document.querySelector('#saveLocation');
const manageSavedLocationsButton = document.querySelector('#manageSavedLocations');
const savedLocationLimit = document.querySelector('#savedLocationLimit');
const savedLocationsDialog = document.querySelector('#savedLocationsDialog');
const savedLocationForm = document.querySelector('#savedLocationForm');
const savedLocationId = document.querySelector('#savedLocationId');
const savedLocationLabel = document.querySelector('#savedLocationLabel');
const savedLocationFormLabel = document.querySelector('#savedLocationFormLabel');
const savedLocationError = document.querySelector('#savedLocationError');
const savedLocationsList = document.querySelector('#savedLocationsList');
const savedLocationsEmpty = document.querySelector('#savedLocationsEmpty');
const locationContextSelect = document.querySelector('#locationContext');
const locationContextStatus = document.querySelector('#locationContextStatus');
const watchDialog = document.querySelector('#watchDialog');
const watchForm = document.querySelector('#watchForm');
const watchSupport = document.querySelector('#watchSupport');
const watchLocationLabel = document.querySelector('#watchLocationLabel');
const watchLocationRequired = document.querySelector('#watchLocationRequired');
const watchRadius = document.querySelector('#watchRadius');
const watchService = document.querySelector('#watchService');
const watchCategory = document.querySelector('#watchCategory');
const saveWatchButton = document.querySelector('#saveWatch');
const stopWatchButton = document.querySelector('#stopWatch');
const watchResult = document.querySelector('#watchResult');
const watchFixture = watchFixtureState(location);
const pushFixtureRuntime = createPushFixtureRuntime(location, {
  enabled: Boolean(watchFixture),
  unsupported: watchFixture === 'unsupported',
  permissionOverride: watchFixture === 'denied' ? 'denied' : null
});
const pushController = createPushSubscriptionController({
  environment: pushFixtureRuntime?.environment || window,
  adapter: pushFixtureRuntime?.adapter || createHttpWatchSubscriptionAdapter({
    baseUrl: watchApiBaseUrlFrom(document),
    storage: localStorage
  }),
  vapidPublicKey: pushFixtureRuntime?.vapidPublicKey || vapidPublicKeyFrom(document)
});
let pendingWatchLocation = null;
let locationRequest = 0;
let locationWatch = null;
let requestedRadiusKm = null;
function updateSavedLocationState(nextState) {
  state.savedLocations = nextState.locations;
  state.locationContext = nextState.locationContext;
  renderSavedLocations();
}
function syncLocationContextControl() {
  const selected = savedLocationForContext(state);
  locationContextSelect.replaceChildren(
    new Option('Current location', 'current'),
    ...state.savedLocations.map(location => new Option(location.label, location.id))
  );
  locationContextSelect.value = selected?.id || 'current';
  locationContextStatus.hidden = !selected;
  locationContextStatus.textContent = selected ? `Showing near ${selected.label}` : '';
}
function showSavedLocationError(error) {
  savedLocationError.textContent = error instanceof RangeError
    ? `You can save up to ${MAX_SAVED_LOCATIONS} locations.`
    : error.message;
  savedLocationError.hidden = false;
  savedLocationLabel.setAttribute('aria-invalid', 'true');
  savedLocationLabel.focus();
}
function resetSavedLocationForm() {
  savedLocationForm.reset();
  savedLocationId.value = '';
  savedLocationFormLabel.textContent = 'Location label';
  document.querySelector('#submitSavedLocation').textContent = 'Save';
  savedLocationError.hidden = true;
  savedLocationLabel.removeAttribute('aria-invalid');
}
function renderSavedLocations() {
  const atLimit = state.savedLocations.length >= MAX_SAVED_LOCATIONS;
  saveLocationButton.disabled = !state.nearby || atLimit;
  manageSavedLocationsButton.hidden = state.savedLocations.length === 0;
  savedLocationLimit.textContent = atLimit ? `You can save up to ${MAX_SAVED_LOCATIONS} locations.` : '';
  savedLocationsEmpty.hidden = state.savedLocations.length !== 0;
  savedLocationsList.replaceChildren(...state.savedLocations.map(location => {
    const item = document.createElement('li');
    item.dataset.savedLocationId = location.id;
    const label = document.createElement('span');
    label.textContent = location.label;
    const actions = document.createElement('div');
    actions.className = 'saved-location-item-actions';
    for (const [action, text] of [['rename', 'Rename'], ['delete', 'Delete']]) {
      const button = document.createElement('button');
      button.type = 'button';
      button.dataset.action = action;
      button.textContent = text;
      actions.append(button);
    }
    item.append(label, actions);
    return item;
  }));
  syncLocationContextControl();
}
function openSavedLocations(mode = 'manage') {
  resetSavedLocationForm();
  savedLocationForm.hidden = mode !== 'save';
  savedLocationsDialog.showModal();
  (mode === 'save' ? savedLocationLabel : document.querySelector('#closeSavedLocations')).focus();
}
saveLocationButton.addEventListener('click', () => openSavedLocations('save'));
manageSavedLocationsButton.addEventListener('click', () => openSavedLocations());
document.querySelector('#closeSavedLocations').addEventListener('click', () => savedLocationsDialog.close());
document.querySelector('#cancelSavedLocation').addEventListener('click', () => {
  resetSavedLocationForm();
  savedLocationForm.hidden = true;
  document.querySelector('#closeSavedLocations').focus();
});
savedLocationForm.addEventListener('submit', event => {
  event.preventDefault();
  savedLocationError.hidden = true;
  savedLocationLabel.removeAttribute('aria-invalid');
  try {
    const nextState = savedLocationId.value
      ? renameSavedLocation(localStorage, state, savedLocationId.value, savedLocationLabel.value)
      : addSavedLocation(localStorage, state, {
        label: savedLocationLabel.value,
        latitude: state.nearby?.[0],
        longitude: state.nearby?.[1]
      });
    updateSavedLocationState(nextState);
    resetSavedLocationForm();
    savedLocationForm.hidden = true;
    document.querySelector('#closeSavedLocations').focus();
  } catch (error) {
    showSavedLocationError(error);
  }
});
savedLocationsList.addEventListener('click', event => {
  const button = event.target.closest('button[data-action]');
  const item = button?.closest('[data-saved-location-id]');
  const savedLocation = item && state.savedLocations.find(location => location.id === item.dataset.savedLocationId);
  if (!savedLocation) return;
  if (button.dataset.action === 'rename') {
    resetSavedLocationForm();
    savedLocationForm.hidden = false;
    savedLocationId.value = savedLocation.id;
    savedLocationLabel.value = savedLocation.label;
    savedLocationFormLabel.textContent = 'Rename location';
    document.querySelector('#submitSavedLocation').textContent = 'Rename';
    savedLocationLabel.focus();
    savedLocationLabel.select();
    return;
  }
  if (button.dataset.action === 'delete' && button.dataset.confirm !== 'true') {
    button.dataset.confirm = 'true';
    button.textContent = 'Confirm delete';
    button.setAttribute('aria-label', `Confirm deleting ${savedLocation.label}`);
    button.focus();
    return;
  }
  const wasActive = state.locationContext.type === 'saved' && state.locationContext.id === savedLocation.id;
  updateSavedLocationState(deleteSavedLocation(localStorage, state, savedLocation.id));
  if (wasActive) useCurrentLocation();
  document.querySelector('#closeSavedLocations').focus();
});
savedLocationsDialog.addEventListener('close', resetSavedLocationForm);
renderSavedLocations();
function watchCapabilityState() {
  const presentation = watchSupportState(window);
  return watchFixture === 'ios' ? presentation : pushController.capability();
}
function watchStatusMessage(kind) {
  return {
    active: 'Watch notifications are active on this device.',
    denied: 'Notifications are blocked. Change this in your browser or device settings to activate the watch.',
    dismissed: 'Notification permission was not granted. Your watch settings were saved but remain inactive.',
    unsupported: 'Notifications are not supported in this browser or platform.',
    'ios-install': 'Add SirenTO to your Home Screen before notifications can be enabled.',
    missing: 'Watch settings are saved, but the push subscription is missing. Save again to recover it.',
    expired: 'The push subscription has expired. Save again to create a replacement.',
    orphaned: 'A browser subscription exists without a local watch. You can stop it below or save new watch settings.',
    idle: 'No watch notification subscription is active.',
    'backend-unavailable': 'Notification delivery is not configured yet. Your watch settings were saved but remain inactive.',
    'subscribe-failed': 'The browser could not create a push subscription. Your watch settings remain inactive.',
    unsubscribed: 'Watch notifications are turned off on this device.'
  }[kind] || 'Watch settings could not be activated.';
}
function renderWatchLifecycle(result, watch = loadLocalWatch(localStorage)) {
  watchResult.textContent = watchStatusMessage(result.kind);
  const hasSubscription = ['active', 'orphaned'].includes(result.kind) || Boolean(result.subscription);
  stopWatchButton.hidden = !hasSubscription;
  if (result.kind === 'active' && watch) {
    saveWatchActivation(localStorage, { version: 1, watchId: watch.id, active: true });
  } else if (!hasSubscription) {
    clearWatchActivation(localStorage);
  }
}
async function reconcileWatchSubscription({ showResult = false } = {}) {
  try {
    const watch = loadLocalWatch(localStorage);
    const result = await pushController.reconcile(watch);
    if (showResult || result.kind !== 'idle') renderWatchLifecycle(result, watch);
    return result;
  } catch {
    if (showResult) renderWatchLifecycle({ kind: 'subscribe-failed' });
    return { kind: 'subscribe-failed' };
  }
}
function openWatchConfiguration() {
  const support = watchCapabilityState();
  const saved = savedLocationForContext(state);
  pendingWatchLocation = watchLocationContext({
    fixture: watchFixture,
    locationContext: state.locationContext,
    savedLocation: saved,
    coordinates: state.nearby,
    originKind: nearbyOriginKind
  });
  const storedWatch = loadLocalWatch(localStorage);
  watchSupport.dataset.kind = support.kind;
  watchSupport.textContent = support.message;
  watchLocationLabel.textContent = pendingWatchLocation?.label || 'No location selected';
  watchLocationRequired.hidden = Boolean(pendingWatchLocation);
  watchRadius.value = String(storedWatch?.radiusKm || defaultWatchRadius(state.radiusKm));
  watchService.value = storedWatch?.service || 'all';
  watchCategory.value = storedWatch?.category || 'all';
  saveWatchButton.disabled = !pendingWatchLocation || support.kind !== 'supported';
  stopWatchButton.hidden = !loadWatchActivation(localStorage)?.active;
  watchResult.textContent = '';
  watchDialog.showModal();
  document.querySelector('#closeWatch').focus();
  void reconcileWatchSubscription({ showResult: true });
}
document.querySelector('#openWatch').addEventListener('click', openWatchConfiguration);
document.querySelector('#closeWatch').addEventListener('click', () => watchDialog.close());
watchForm.addEventListener('submit', async event => {
  event.preventDefault();
  if (!pendingWatchLocation || saveWatchButton.disabled) return;
  saveWatchButton.disabled = true;
  try {
    const existing = loadLocalWatch(localStorage);
    const id = existing?.id || globalThis.crypto?.randomUUID?.() || `local-${Date.now().toString(36)}`;
    const watch = createLocalWatch({
      id,
      location: pendingWatchLocation,
      radiusKm: Number(watchRadius.value),
      service: watchService.value,
      category: watchCategory.value
    });
    saveLocalWatch(localStorage, { ...watch, active: false });
    const result = await pushController.activate(watch, { explicitUserAction: true });
    if (result.kind === 'active') saveLocalWatch(localStorage, watch);
    renderWatchLifecycle(result, result.kind === 'active' ? watch : { ...watch, active: false });
  } catch {
    watchResult.textContent = 'These watch settings could not be saved on this device.';
  } finally {
    saveWatchButton.disabled = !pendingWatchLocation || watchCapabilityState().kind !== 'supported';
  }
});
stopWatchButton.addEventListener('click', async () => {
  stopWatchButton.disabled = true;
  try {
    const watch = loadLocalWatch(localStorage);
    const result = await pushController.unsubscribe(watch);
    if (watch) saveLocalWatch(localStorage, { ...watch, active: false });
    clearWatchActivation(localStorage);
    renderWatchLifecycle(result, watch);
  } catch {
    watchResult.textContent = 'The browser could not turn off this subscription.';
  } finally {
    stopWatchButton.disabled = false;
  }
});
window.addEventListener('load', () => {
  void reconcileWatchSubscription();
  if (pushFixtures?.push) {
    navigator.serviceWorker.ready.then(registration => registration.active?.postMessage({
      type: 'sirento.fixture.push', fixture: pushFixtures.push, arrival: pushFixtures.arrival
    })).catch(() => {});
  }
});
navigator.serviceWorker?.addEventListener?.('message', event => {
  if (event.data?.type === 'sirento.pushsubscriptionchange') {
    void reconcileWatchSubscription({ showResult: watchDialog.open });
    return;
  }
  if (event.data?.type !== 'sirento.notification.navigate' || typeof event.data.incidentId !== 'string') return;
  let destination;
  try { destination = incidentDeepLink(location.href, event.data.incidentId); } catch { return; }
  if (event.data.url !== destination) return;
  history.replaceState(null, '', destination);
  pendingSharedIncidentId = event.data.incidentId;
  restorePendingIncident();
});
window.addEventListener('popstate', () => {
  pendingSharedIncidentId = readSharedIncident(new URLSearchParams(location.search));
  restorePendingIncident();
});
function radiusFilterOrigin() {
  return state.radiusKm === null ? null : state.nearby;
}
function syncRadiusControls() {
  let activeToggle = null;
  radiusToggles.forEach(toggle => {
    const value = toggle.dataset.radiusKm === 'toronto' ? null : Number(toggle.dataset.radiusKm);
    const active = value === state.radiusKm;
    toggle.classList.toggle('active', active);
    toggle.setAttribute('aria-pressed', String(active));
    if (active) activeToggle = toggle;
  });
  if (activeToggle && isMobileViewLayout()) requestAnimationFrame(() => {
    activeToggle.scrollIntoView({ block: 'nearest', inline: 'nearest' });
  });
}
function clearLocationWatch() {
  if (locationWatch !== null && typeof navigator.geolocation?.clearWatch === 'function') {
    navigator.geolocation.clearWatch(locationWatch);
  }
  locationWatch = null;
}
function useSavedLocation(id) {
  updateSavedLocationState(selectSavedLocation(localStorage, state, id));
  const saved = savedLocationForContext(state);
  if (!saved) {
    useCurrentLocation();
    return;
  }
  locationRequest++;
  clearLocationWatch();
  requestedRadiusKm = null;
  state.nearby = referenceCoordinates(state, liveLocation);
  nearbyOriginKind = 'saved';
  nearControls.hidden = false;
  chooseAreaButton.hidden = false;
  mapHasFitted = false;
  updateNearbyView();
}
function useCurrentLocation() {
  updateSavedLocationState(selectCurrentLocation(localStorage, state));
  state.nearby = null;
  nearbyOriginKind = 'device';
  mapHasFitted = false;
  requestLocation(state.radiusKm === null ? null : state.radiusKm);
}
locationContextSelect.addEventListener('change', event => {
  if (event.target.value === 'current') useCurrentLocation();
  else useSavedLocation(event.target.value);
});
function updateNearbyView() {
  if (state.radiusKm !== null) mapHasFitted = false;
  applyFilters();
  syncRadiusControls();
  nearStatus.textContent = state.radiusKm === null
    ? state.nearby
      ? 'Toronto-wide view. Distance filtering is off; card distances still update from your location.'
      : 'Toronto-wide view. Distance filtering is off. Choose a radius to use your location.'
    : `Within ${state.radiusKm} km of ${nearbyOriginKind === 'map' ? 'the selected area' : nearbyOriginKind === 'saved' ? savedLocationForContext(state)?.label || 'the saved location' : 'your location'}. Distances use approximate call locations; unmapped calls are excluded.`;
}
function showLocationFallback(message) {
  nearStatus.textContent = `${message} Enable location in your browser, or choose an area manually.`;
  nearControls.hidden = false;
  chooseAreaButton.hidden = false;
}
function applyMobileAuditLocationFixture(locationState) {
  if (!mobileAuditFixture || locationState === 'none') return;
  const fixtureOrigin = [43.6534, -79.3862];
  if (locationState === 'unavailable') {
    showLocationFallback('Location is unavailable in this browser.');
    return;
  }
  if (locationState === 'denied') {
    showLocationFallback('Location permission was denied.');
    return;
  }
  state.nearby = fixtureOrigin;
  state.radiusKm = SIREN_RADIUS_KM;
  lastRadiusKm = SIREN_RADIUS_KM;
  nearbyOriginKind = locationState === 'manual' ? 'map' : locationState === 'saved' ? 'saved' : 'device';
  if (locationState === 'saved') {
    state.savedLocations = [{id:'mobile-audit-saved',label:'A deliberately long saved place label',latitude:fixtureOrigin[0],longitude:fixtureOrigin[1]}];
    state.locationContext = {type:'saved',id:'mobile-audit-saved'};
  }
  renderSavedLocations();
  nearControls.hidden = false;
  chooseAreaButton.hidden = false;
  updateNearbyView();
}
function beginAreaChoice() {
  initMap();
  choosingArea = true;
  sirenMode = true;
  chooseAreaButton.textContent = 'Click an area on the map…';
  nearStatus.textContent = 'Choose an area manually by clicking the map.';
  els.dispatchMap.classList.add('choosing-area');
  els.dispatchMap.scrollIntoView({ behavior: window.matchMedia('(prefers-reduced-motion: reduce)').matches ? 'instant' : 'smooth', block: 'center' });
}
function activateSirenView() {
  sirenMode = true;
  state.radiusKm = SIREN_RADIUS_KM;
  lastRadiusKm = SIREN_RADIUS_KM;
  Object.assign(state, filterDefaults);
  syncFilterControls();
  nearControls.hidden = false;
  chooseAreaButton.hidden = false;
  mapHasFitted = false;
  updateSirenMatches();
  updateNearbyView();
  document.querySelector('#sirenResults').scrollIntoView({ behavior: window.matchMedia('(prefers-reduced-motion: reduce)').matches ? 'instant' : 'smooth', block: 'nearest' });
}
function chooseManualArea(origin) {
  choosingArea = false;
  els.dispatchMap.classList.remove('choosing-area');
  chooseAreaButton.textContent = 'Choose a different area on the map';
  state.nearby = origin;
  renderSavedLocations();
  nearbyOriginKind = 'map';
  state.radiusKm = SIREN_RADIUS_KM;
  lastRadiusKm = SIREN_RADIUS_KM;
  activateSirenView();
  nearStatus.textContent = 'Showing recent calls within 2 km of the area you chose.';
}
function requestLocation(radiusKm = lastRadiusKm, forSiren = false) {
  if (state.locationContext.type === 'saved') {
    updateSavedLocationState(selectCurrentLocation(localStorage, state));
    state.nearby = null;
    nearbyOriginKind = 'device';
  }
  if (!navigator.geolocation) {
    showLocationFallback('Location is unavailable in this browser.');
    return;
  }
  requestedRadiusKm = radiusKm;
  let firstPosition = true;
  const request = ++locationRequest;
  clearLocationWatch();
  nearButton.disabled = true;
  hearSirensButton.disabled = true;
  nearButton.textContent = nearbyCtaCopy.loading;
  nearStatus.textContent = 'Allow location access when your browser asks.';
  const onPosition = position => {
    if (request !== locationRequest) return;
    state.nearby = [position.coords.latitude, position.coords.longitude];
    liveLocation = [...state.nearby];
    renderSavedLocations();
    nearbyOriginKind = 'device';
    if (requestedRadiusKm !== null) {
      state.radiusKm = requestedRadiusKm;
      lastRadiusKm = requestedRadiusKm;
      requestedRadiusKm = null;
    }
    nearButton.disabled = false;
    hearSirensButton.disabled = false;
    nearButton.textContent = nearbyCtaCopy.refresh;
    nearControls.hidden = false;
    choosingArea = false;
    els.dispatchMap.classList.remove('choosing-area');
    chooseAreaButton.textContent = 'Choose an area on the map';
    if (forSiren && firstPosition) activateSirenView();
    else updateNearbyView();
    firstPosition = false;
  };
  const onError = error => {
    if (request !== locationRequest) return;
    nearButton.disabled = false;
    hearSirensButton.disabled = false;
    nearButton.textContent = state.nearby ? nearbyCtaCopy.refresh : nearbyCtaCopy.primary;
    showLocationFallback(error.code === 1 ? 'Location permission was denied.' : 'Could not get your location.');
    if (error.code === 1) clearLocationWatch();
  };
  const options = { enableHighAccuracy: false, timeout: 10000, maximumAge: 60000 };
  if (typeof navigator.geolocation.watchPosition === 'function') {
    locationWatch = navigator.geolocation.watchPosition(onPosition, onError, options);
  } else {
    navigator.geolocation.getCurrentPosition(onPosition, onError, options);
  }
}
nearButton.addEventListener('click', () => {
  requestLocation(SIREN_RADIUS_KM, true);
});
hearSirensButton.addEventListener('click', () => {
  requestLocation(SIREN_RADIUS_KM, true);
});
chooseAreaButton.addEventListener('click', beginAreaChoice);
function selectNearbyRadius(value) {
  if (value === state.radiusKm || value === requestedRadiusKm) {
    syncRadiusControls();
    return;
  }
  sirenMode = false;
  sirenMatches = [];
  if (value === null) {
    requestedRadiusKm = null;
    state.radiusKm = null;
    mapHasFitted = false;
    updateNearbyView();
    return;
  }
  const radiusKm = value;
  lastRadiusKm = radiusKm;
  if (!state.nearby) {
    rememberPreferences({ radiusKm });
    requestLocation(radiusKm);
    return;
  }
  state.radiusKm = radiusKm;
  updateNearbyView();
}
radiusToggles.forEach(toggle => toggle.addEventListener('click', auditInteraction(`radius:${toggle.dataset.radiusKm}`, () => {
  selectNearbyRadius(toggle.dataset.radiusKm === 'toronto' ? null : Number(toggle.dataset.radiusKm));
})));
applyMobileAuditLocationFixture(mobileAuditFixture?.location);
if (mobileAuditFixture?.radius) {
  state.radiusKm = mobileAuditFixture.radius === 'toronto' ? null : Number(mobileAuditFixture.radius);
  updateNearbyView();
} else {
  syncRadiusControls();
}
expandNearbyRadius.addEventListener('click', () => {
  const nextRadiusKm = nextNearbyRadius(state.radiusKm);
  if (nextRadiusKm !== undefined) selectNearbyRadius(nextRadiusKm);
});
if (mobileAuditFixture?.location && mobileAuditFixture.location !== 'none') {
  // The explicit loopback fixture has already selected its deterministic location state.
} else if (state.radiusKm !== null) {
  lastRadiusKm = state.radiusKm;
  const restoredSavedLocation = savedLocationForContext(state);
  if (restoredSavedLocation) useSavedLocation(restoredSavedLocation.id);
  else requestLocation(state.radiusKm);
} else {
  const restoredSavedLocation = savedLocationForContext(state);
  if (restoredSavedLocation) useSavedLocation(restoredSavedLocation.id);
}
document.querySelector('#clearNearby').addEventListener('click', () => {
  locationRequest++;
  clearLocationWatch();
  requestedRadiusKm = null;
  state.nearby = null;
  renderSavedLocations();
  state.radiusKm = null;
  sirenMode = false;
  sirenMatches = [];
  choosingArea = false;
  nearbyOriginKind = 'device';
  els.dispatchMap.classList.remove('choosing-area');
  nearButton.disabled = false;
  hearSirensButton.disabled = false;
  nearButton.textContent = nearbyCtaCopy.primary;
  nearControls.hidden = true;
  nearStatus.textContent = 'Uses your location with permission. Your location stays in this browser session.';
  mapHasFitted = false;
  syncRadiusControls();
  applyFilters();
});

document.querySelector('#sirenResultsList').addEventListener('click', event => {
  if (event.target.closest('summary, .share-incident')) return;
  const result = event.target.closest('[data-call-id]');
  if (result) selectCall(result.dataset.callId);
});

document.querySelector('#sirenResultsList').addEventListener('keydown', event => {
  if (event.key !== 'Enter' && event.key !== ' ') return;
  if (event.target.closest('summary, .share-incident')) return;
  const result = event.target.closest('[data-call-id]');
  if (!result) return;
  event.preventDefault();
  selectCall(result.dataset.callId);
});

setInterval(() => {
  document.querySelectorAll('[data-reported-at]').forEach(label => {
    label.textContent = compactReportedAge(label.dataset.reportedAt);
  });
  document.querySelectorAll('[data-updated-at]').forEach(label => {
    label.textContent = `Updated ${compactAge(label.dataset.updatedAt)}`;
  });
  renderNearbySummary();
  updateMarkerAppearances();
}, 60000);

document.querySelector('#roadOverlay').addEventListener('change', auditInteraction('road-closures', () => {
  const visible=document.querySelector('#roadOverlay').checked;
  if (!visible) clearClosureSelection();
  rememberPreferences();
  if (setRoadOverlayVisibility) setRoadOverlayVisibility(dispatchMap,visible);
  else renderDisruptions(state.disruptions,radiusFilterOrigin(),state.radiusKm,dispatchMap);
}));

function syncSearchControl() {
  els.searchInput.value = state.search;
  els.clearSearch.hidden = !state.search;
}
function syncMobileFilterIndicator() {
  const count = activeSecondaryFilterCount(state);
  els.mobileFilterCount.textContent = count ? String(count) : '';
  els.mobileFilterCount.hidden = count === 0;
  els.mobileFiltersToggle.classList.toggle('active', count > 0);
  els.mobileFiltersToggle.setAttribute('aria-label', count ? `Filters, ${count} active` : 'Filters');
}
function setMobileFiltersOpen(open) {
  document.documentElement.classList.toggle('mobile-filters-open', open);
  els.mobileFiltersToggle.setAttribute('aria-expanded', String(open));
}
els.mobileFiltersToggle.addEventListener('click', auditInteraction('filters', () => {
  setMobileFiltersOpen(els.mobileFiltersToggle.getAttribute('aria-expanded') !== 'true');
}));
function syncFilterControls() {
  syncSearchControl();
  document.querySelector('#historyHours').value = state.hours;
  document.querySelector('#serviceFilter').value = state.serviceFilter;
  syncMobileFilterIndicator();
  syncRadiusControls();
}
document.querySelector('#clearFilters').addEventListener('click', () => {
  Object.assign(state, filterDefaults);
  state.radiusKm = null;
  syncFilterControls();
  document.querySelector('#clearNearby').click();
});

document.querySelector('#shareView').addEventListener('click', async () => {
  const url = shareView(location.href, state);
  const output = document.querySelector('#shareLink');
  output.value = url;
  output.hidden = false;
  const status = document.querySelector('#shareStatus');
  try {
    await navigator.clipboard.writeText(url);
    status.textContent = 'Link copied. Nearby location is not included.';
  } catch {
    output.focus(); output.select();
    status.textContent = 'Copy this link. Nearby location is not included.';
  }
});

uxAudit.mark('first-usable-ui', {
  definition: 'structure and loading status visible; search, radius, Map/Calls, and filters accept input'
});
