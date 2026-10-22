import { loadTtcUiFixture } from '../ttc/fixture.js';
import { mergeTtcDisruptions } from '../ttc/presentation.js';
import { renderTtc, createTtcDetail, clearTtcSelection, setTtcVisibility, bindTtcListInteractions } from '../ttc/ui.js';
import { sourceStatus, sourceStatusText } from "../source-status.js?v=source-states-1";
import { canExpandCluster, focusGroup } from "../map-clusters.js?v=story-39a-1";
import { activeSecondaryFilterCount, filterDefaults, filterSummary, incidentDeepLink, readFilters, shareView, shareIncidentView, readSharedIncident, shareIncident, loadPreferences, savePreferences } from "../view-controls.js";
import * as disruptionUi from "../disruptions/ui.js?v=story-38b-1";
import { withTtcNearbyFixture } from "../disruptions/ttc-nearby-fixture.js";
import { compactAge, compactReportedAge, locationConfidence, callStatus, sourceName, respondingUnitLabel } from "../call-presentation.js?v=responding-units-1";
import { distanceKm, distanceLabel, withinGeographicScope } from "../nearby.js?v=radius-controls-1";
import { policeUnitLabel } from "../tps/unit-label.js?v=3";
import { incidentCategory } from "../tfs/category.js";
import { locationDisplay, expandLocationAbbreviations } from "../location-display.js?v=hydro-corridor-1";
import { isWithinHistoryWindow } from "../tfs/time.js";
import { nearbySummary } from "../nearby-summary.js";
import { mobileNearbySummary } from "../mobile-nearby-summary.js";
import { nearbyEmptyState, nextNearbyRadius, radiusLabel } from "../nearby-empty-state.js";
import { nearbyCtaCopy } from "../cta-copy.js";
import { rankSirenMatches, SIREN_RADIUS_KM } from "../siren-matches.js";
import { incidentArrivalState, reconcileIncidentSelection } from "../incident-selection.js";
import { markerAgeLabel, markerAgeTier, markerGlyph } from "../marker-age.js";
import { incidentBadge, incidentBadgeExpiry } from "../incident-badge.js?v=incident-badges-1";
import { incidentMatchesSearch } from "../incident-search.js";
import { escapeHtml } from "../html-escape.js";
import { DISPATCH_GLOSSARY_FOOTER, glossaryDefinition } from "../dispatch-glossary.js?v=glossary-1";
import { applyTheme, normalizeThemePreference } from "../theme.js";
import { createRefreshFreshnessTracker } from "../refresh-freshness.js";
import { mobileSheetActionLabel, mobileSheetStateAfterDrag, nextMobileSheetState } from "../mobile-bottom-sheet.js";
import { NEARBY_SORT_DEFAULT, sortNearbyCalls } from "../nearby-sort.js";
import { offlineStatus } from "../offline-status.js";
import { MAX_SAVED_LOCATIONS, addSavedLocation, deleteSavedLocation, loadSavedLocationState, referenceCoordinates, renameSavedLocation, savedLocationForContext, selectCurrentLocation, selectSavedLocation } from "../saved-locations.js";
const { captureRoadClosureRenderState, createClosureDetail, renderDisruptions, setRoadOverlayVisibility } = disruptionUi;
import { createLocalWatch, defaultWatchRadius, loadLocalWatch, saveLocalWatch, watchFixtureState, watchLocationContext, watchSupportState } from '../watch-config.js';
import { clearWatchActivation, createHttpWatchSubscriptionAdapter, createPushFixtureRuntime, createPushSubscriptionController, loadWatchActivation, pushFixtureOptions, saveWatchActivation, vapidPublicKeyFrom, watchApiBaseUrlFrom } from '../push-subscription.js';
import { mobileAuditFixtureFilters, mobileAuditFixtureOptions, mobileAuditFixtureSnapshot } from '../mobile-audit-fixture.js';
import { runSynchronousAuditWork, uxAudit, uxReliabilityFixtureOptions, waitForAuditDelay } from '../ux-reliability-audit.js';
import { INCIDENT_LIST_BATCH_SIZE, incidentFilterKey, incidentListKey, nextIncidentBatch } from '../incident-list-window.js';
import { createFrameScheduler } from '../frame-scheduler.js';
import { createMapPopups } from '../map-popups.js';
import { createMapMaintenance } from '../map-maintenance.js';
import { createPoliceBoundaryMap } from '../police-boundary-map.js';
import { createIncidentMarkerLayer } from '../incident-markers.js';

uxAudit.mark('app-bootstrap-begins');

const CONFIG = {
  snapshotUrl: "https://data-sirento.nitin.run/data/current.json",
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
const mobileDisruptionsControl = document.querySelector('#mobileDisruptionsControl');
const mobileMapFocusToggle = document.querySelector('#mobileMapFocusToggle');
const mobileFocusFilterSummary = document.querySelector('#mobileFocusFilterSummary');
const mobileBottomSheet = document.querySelector('#mobileBottomSheet');
const mobileSheetToggle = document.querySelector('#mobileSheetToggle');
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
let mapPopups = createMapPopups(null);
let callLayer;
let expandedCluster = new Set();
let focusedCallId = null;
let focusedClosureId = null;
let rowHighlightTimer;
let mapHasFitted = false;
let lastRadiusKm = 2;
let sirenMode = false;
let sirenMatches = [];
let choosingArea = false;
let nearbyOriginKind = "device";
let liveLocation = null;
let nearbyOriginLayer = null;
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
let mobileFocusMode = false;
let mobileFocusScrollY = 0;
const initialParams = new URLSearchParams(location.search);
const mobileAuditFixture = mobileAuditFixtureOptions(location);
const boundaryDebugEnabled = initialParams.get('policeBoundaryDebug') === '1';
const boundaryLifecycleScheduler = createFrameScheduler();
const policeBoundaryMap = createPoliceBoundaryMap({
  getMap: () => dispatchMap,
  mapElement: els.dispatchMap,
  L,
  isMobileLayout: isMobileViewLayout,
  getMobileView: () => mobileView,
  getSheetState: () => mobileSheetState,
  getRendererMode: () => mobileAuditFixture?.boundaryRenderer || 'canvas',
  isDebugEnabled: boundaryDebugEnabled,
  audit: uxAudit,
  scheduler: boundaryLifecycleScheduler,
  markReady: () => { auditReadiness.boundaries = true; markFullyRenderedWhenReady(); },
  rememberPreferences,
  syncLayerControls: syncFullscreenLayerControls,
  captureRoadClosureState: captureRoadClosureRenderState
});

const incidentMarkers = createIncidentMarkerLayer({
  getMap: () => dispatchMap,
  getCallLayer: () => callLayer,
  getCalls: () => state.filtered,
  getNearby: () => state.nearby,
  getRadiusKm: () => state.radiusKm,
  getFocusedCallId: () => focusedCallId,
  getSirenIds: () => new Set(sirenMatches.map(match => match.call.id)),
  getExpandedCluster: () => expandedCluster,
  setExpandedCluster: set => { expandedCluster = set; },
  isMobileLayout: isMobileViewLayout,
  getMobileSheetState: () => mobileSheetState,
  setMobileSheetState,
  selectCall: id => selectCall(id, { pan: false, revealRow: true }),
  reopenPopup: layer => mapPopups.reopenBound(layer),
  createIncidentCard,
  coordinatesForCall,
  isApproximate: isApproximateLocation,
  distanceKm,
  distanceLabel,
  audit: uxAudit,
  markerAgeLabel,
  markerAgeTier,
  markerGlyph,
  setMapStatus: text => { els.mapStatus.textContent = text; document.querySelector('#mobileMapStatus').textContent = text; },
  getNearbyOriginLayer: () => nearbyOriginLayer,
  getMapHasFitted: () => mapHasFitted,
  setMapHasFitted: value => { mapHasFitted = value; }
});
// Thin name bindings preserve the app's wiring and the source-text pins.
const renderMapMarkers = () => incidentMarkers.render();
const scheduleMapMarkerRender = () => incidentMarkers.scheduleRender();
const updateMarkerAppearance = (id, now) => incidentMarkers.updateAppearance(id, now);
const updateMarkerAppearances = now => incidentMarkers.updateAll(now);
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
  if (!boundaryColor || !policeBoundaryMap.hasGeometry()) return;
  if (!policeBoundaryMap.mapAllowsBoundaryWork()) {
    policeBoundaryMap.markDirty('theme-change-while-map-hidden');
    return;
  }
  policeBoundaryMap.setStyle({ color: boundaryColor });
}
function rememberPreferences(stateOverrides = {}) {
  try { savePreferences(localStorage,{...state,...stateOverrides},{roads:document.querySelector('#roadOverlay').checked,boundaries:policeBoundaryMap.isVisible(),theme:themePreference,mobileView}); } catch { /* Browsing still works when storage is blocked. */ }
}

function isMobileViewLayout() {
  return mobileLayoutMedia.matches;
}

let mapSheetObserver = null;
const viewTransitionScheduler = createFrameScheduler();
const maintenance = createMapMaintenance({
  mapElement: els.dispatchMap,
  bottomSheet: mobileBottomSheet,
  focusToggle: mobileMapFocusToggle,
  focusFilterSummary: mobileFocusFilterSummary,
  getMap: () => dispatchMap,
  scheduler: viewTransitionScheduler,
  isMobileLayout: isMobileViewLayout,
  getMobileView: () => mobileView,
  isFocusMode: () => mobileFocusMode,
  audit: uxAudit,
  captureBoundaryDiagnostic: policeBoundaryMap.captureBoundaryDiagnostic,
  queuePoliceBoundaryWork: policeBoundaryMap.queuePoliceBoundaryWork,
  viewStillCurrent: (view, mobile) => view === mobileView && mobile === isMobileViewLayout(),
  selectFocusedCall: () => selectCall(focusedCallId, { panIfNeeded: true }),
  persistPreferences: rememberPreferences,
  getFocusedCallId: () => focusedCallId
});
// Thin name bindings preserve the app's listener wiring and the source-text
// regression pins; the implementations live in map-maintenance.js.
const scheduleMapMaintenance = options => maintenance.scheduleMaintenance(options);
const syncMapSheetOverlap = () => maintenance.syncMapSheetOverlap();
const syncMapAttributionPosition = () => maintenance.syncMapAttributionPosition();
const wrapQuery = selector => maintenance.wrapQuery(selector);

function syncIncidentListSurface(mobile = isMobileViewLayout()) {
  const host = mobile && mobileView === "map" ? mobileSheetCallList : callsListHome;
  if (els.callList.parentElement !== host) host.append(els.callList);
}

function setMobileView(view, { focusSelection = false, persist = true } = {}) {
  if (view !== "map" && view !== "calls") return;
  const mobile = isMobileViewLayout();
  if (view === mobileView && view === presentedMobileView && mobile === presentedMobileLayout) return;
  // Keep the existing siren panel below search/navigation on mobile, including rotation.
  const sirenPanel = document.querySelector('#sirenResults');
  const sirenAnchor = document.querySelector(mobile ? '.radius-controls' : '.controls-card');
  if (mobile) sirenAnchor.after(sirenPanel);
  else sirenAnchor.before(sirenPanel);
  const finishState = uxAudit.begin('view-toggle:state-update', { target: view });
  mobileView = view;
  if (mobileFocusMode && view !== 'map') closeFullscreenPanels();
  if (mobile && view === 'calls' && expandedCluster.size) {
    expandedCluster.clear();
    if (dispatchMap) renderMapMarkers();
  }
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
  if (mobile && view === 'calls' && policeBoundaryMap.isVisible()) {
    policeBoundaryMap.invalidatePendingWork('map-hidden-by-calls-view');
  }
  maintenance.scheduleViewMaintenance({ view, mobile, focusSelection, persist });
}

mobileViewToggles.forEach(toggle => toggle.addEventListener("click", auditInteraction(`view:${toggle.dataset.mobileView}`, () => {
  mobileViewInteracted = true;
  setMobileView(toggle.dataset.mobileView, { focusSelection: toggle.dataset.mobileView === "map" });
  // WebKit can anchor to the footer when the long list moves out of the sheet.
  // Keep the view switch in sight after the new surface has been laid out.
  requestAnimationFrame(() => toggle.scrollIntoView({ block: 'nearest', inline: 'nearest', behavior: 'instant' }));
})));
mobileDisruptionsControl?.addEventListener('click', auditInteraction('mobile:disruptions', () => {
  if (!isMobileViewLayout()) return;
  if (mobileView === 'map') {
    mobileViewInteracted = true;
    setMobileView('calls');
  }
  requestAnimationFrame(() => {
    const disruptions = document.querySelector('#disruptions');
    disruptions?.scrollIntoView({
      block: 'start',
      behavior: window.matchMedia('(prefers-reduced-motion: reduce)').matches ? 'instant' : 'smooth'
    });
    disruptions?.focus({ preventScroll: true });
  });
}));
// Fullscreen panels reuse the live controls, including Leaflet's own checkbox.
// Remember their homes so normal mobile/desktop layout and handlers are restored.
const mapInfoPanel = document.querySelector('#mapInfo');
const mapLayersPanel = document.querySelector('#mobileMapLayersPanel');
const mapLayersBody = document.querySelector('#mobileMapLayersBody');
const mapLayersToggle = document.querySelector('#mobileMapLayersToggle');
const mapInfoToggle = document.querySelector('#mobileMapInfoToggle');
const mapLayersClose = document.querySelector('#mobileMapLayersClose');
const mapInfoClose = document.querySelector('#mobileMapInfoClose');
const mapControlHomes = new Map();
let normalMapInfoOpen = false;
const sourceTimesHelp = document.querySelector('.source-times-help');
const sourceTimesExplanation = document.querySelector('#source-timestamps');
const sourceTimesHome = document.createComment('source times explanation home');
sourceTimesExplanation.before(sourceTimesHome);

sourceTimesHelp.addEventListener('click', event => {
  if (!mobileFocusMode) return;
  event.preventDefault();
  sourceTimesHelp.closest('.map-info-heading').after(sourceTimesExplanation);
  const panelTop = mapInfoPanel.getBoundingClientRect().top;
  const headerHeight = mapInfoClose.closest('.mobile-map-panel-heading').getBoundingClientRect().height;
  mapInfoPanel.scrollTop += sourceTimesExplanation.getBoundingClientRect().top - panelTop - headerHeight - 12;
  sourceTimesExplanation.focus({ preventScroll: true });
});

function syncFullscreenLayerControls() {
  if (mobileFocusMode) {
    const controls = [wrapQuery('.leaflet-control-layers'), ...document.querySelectorAll('.map-layer-toggle')];
    for (const control of controls) {
      if (!control || mapControlHomes.has(control)) continue;
      const home = document.createComment('fullscreen layer control home');
      control.before(home);
      mapControlHomes.set(control, home);
      mapLayersBody.append(control);
    }
  } else {
    for (const [control, home] of mapControlHomes) {
      home.replaceWith(control);
    }
    mapControlHomes.clear();
  }
}

function closeFullscreenPanels({ restoreFocus = false } = {}) {
  const launcher = mapInfoPanel.open ? mapInfoToggle : !mapLayersPanel.hidden ? mapLayersToggle : null;
  mapLayersPanel.hidden = true;
  sourceTimesHome.after(sourceTimesExplanation);
  mapInfoPanel.open = false;
  mapLayersToggle.setAttribute('aria-expanded', 'false');
  mapInfoToggle.setAttribute('aria-expanded', 'false');
  if (restoreFocus) launcher?.focus({ preventScroll: true });
}

function toggleFullscreenPanel(kind) {
  if (!mobileFocusMode || mobileView !== 'map') return;
  const layers = kind === 'layers';
  const wasOpen = layers ? !mapLayersPanel.hidden : mapInfoPanel.open;
  closeFullscreenPanels();
  if (wasOpen) {
    (layers ? mapLayersToggle : mapInfoToggle).focus({ preventScroll: true });
    return;
  }
  if (layers) mapLayersPanel.hidden = false;
  else mapInfoPanel.open = true;
  (layers ? mapLayersToggle : mapInfoToggle).setAttribute('aria-expanded', 'true');
  (layers ? mapLayersClose : mapInfoClose).focus({ preventScroll: true });
  scheduleMapMaintenance();
}

mapLayersToggle.addEventListener('click', () => toggleFullscreenPanel('layers'));
mapInfoToggle.addEventListener('click', () => toggleFullscreenPanel('info'));
mapLayersClose.addEventListener('click', () => closeFullscreenPanels({ restoreFocus: true }));
mapInfoClose.addEventListener('click', () => closeFullscreenPanels({ restoreFocus: true }));
document.addEventListener('keydown', event => {
  if (event.key !== 'Escape' || !mobileFocusMode || (mapLayersPanel.hidden && !mapInfoPanel.open)) return;
  event.preventDefault();
  closeFullscreenPanels({ restoreFocus: true });
});

function setMobileFocusMode(on) {
  const next = Boolean(on) && isMobileViewLayout();
  if (next === mobileFocusMode) return;
  if (next) normalMapInfoOpen = mapInfoPanel.open;
  closeFullscreenPanels();
  mobileFocusMode = next;
  for (const chrome of [mobileFocusFilterSummary, document.querySelector('.radius-controls')]) {
    if (next) mapSheetObserver?.observe(chrome);
    else mapSheetObserver?.unobserve(chrome);
  }
  syncFullscreenLayerControls();
  if (!next) mapInfoPanel.open = normalMapInfoOpen;
  document.documentElement.dataset.mobileFocus = next ? "on" : "off";
  mobileMapFocusToggle?.setAttribute("aria-pressed", String(next));
  mobileMapFocusToggle?.setAttribute("aria-label", next ? "Exit full screen map" : "Full screen map");
  const icon = mobileMapFocusToggle?.querySelector(".mobile-map-focus-icon");
  if (icon) icon.textContent = next ? "×" : "⛶";
  // Story 40F: update the sheet-overlap variable synchronously so the Leaflet
  // bottom-corner controls (attribution, zoom) move with the focused layout in
  // the same frame. Otherwise the attribution briefly overlaps the bottom sheet
  // until the deferred maintenance frame runs.
  syncMapSheetOverlap();
  if (next) {
    mobileFocusScrollY = window.scrollY || window.pageYOffset || 0;
    if (mobileView !== "map") setMobileView("map", { persist: false });
    scheduleMapMaintenance({ invalidateSize: true });
  } else {
    scheduleMapMaintenance({ invalidateSize: true });
    requestAnimationFrame(() => window.scrollTo({ top: mobileFocusScrollY, behavior: "instant" }));
  }
  syncFocusFilterSummary();
}

mobileMapFocusToggle?.addEventListener("click", auditInteraction('mobile:map-focus', () => {
  if (!isMobileViewLayout()) return;
  setMobileFocusMode(!mobileFocusMode);
}));

setMobileView(mobileView, { persist: false });
mobileLayoutMedia.addEventListener?.("change", () => {
  if (!isMobileViewLayout() && mobileFocusMode) setMobileFocusMode(false);
  setMobileView(mobileView, { persist: false });
});

function setMobileSheetState(nextState) {
  if (!mobileBottomSheet || !["collapsed", "half", "expanded"].includes(nextState)) return;
  const previousState = mobileSheetState;
  const changed = previousState !== nextState;
  if (changed) policeBoundaryMap.captureBoundaryDiagnostic(`sheet:${previousState}->${nextState}:requested`);
  mobileSheetState = nextState;
  mobileBottomSheet.dataset.sheetState = nextState;
  document.documentElement.dataset.mobileSheetState = nextState;
  mobileSheetToggle.setAttribute("aria-expanded", String(nextState !== "collapsed"));
  mobileSheetToggle.setAttribute("aria-label", mobileSheetActionLabel(nextState));
  mobileSheetStateControls.forEach(control => {
    control.setAttribute("aria-pressed", String(control.dataset.sheetTarget === nextState));
  });
  if (!changed) {
    scheduleMapMaintenance({ invalidateSize: true });
    return;
  }
  policeBoundaryMap.staleScheduledWork();
  boundaryLifecycleScheduler.afterLayoutTransition(() => {
    if (mobileSheetState !== nextState || !dispatchMap || (isMobileViewLayout() && mobileView !== 'map')) return;
    syncMapSheetOverlap();
    policeBoundaryMap.captureBoundaryDiagnostic(`sheet:${nextState}:layout-settled`);
    dispatchMap.invalidateSize({ pan: false });
    policeBoundaryMap.captureBoundaryDiagnostic(`sheet:${nextState}:invalidate-size-complete`);
    policeBoundaryMap.queuePoliceBoundaryWork(`sheet:${nextState}:post-invalidation`);
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
// Orientation changes resize the usable viewport; only the visible map needs new geometry.
window.addEventListener("orientationchange", () => {
  if (isMobileViewLayout() && mobileView !== "map") return;
  scheduleMapMaintenance({ invalidateSize: true });
});
window.visualViewport?.addEventListener("resize", scheduleMapMaintenance);
window.visualViewport?.addEventListener("scroll", scheduleMapMaintenance);
document.addEventListener("scroll", scheduleMapMaintenance, { passive: true, capture: true });
document.addEventListener("touchmove", scheduleMapMaintenance, { passive: true });
document.addEventListener("touchend", scheduleMapMaintenance, { passive: true });
window.addEventListener("pageshow", scheduleMapMaintenance);
if (globalThis.ResizeObserver) {
  mapSheetObserver = new ResizeObserver(scheduleMapMaintenance);
  mapSheetObserver.observe(els.dispatchMap);
  mapSheetObserver.observe(mobileBottomSheet);
  const layerRow = els.dispatchMap?.closest?.(".map-wrap")?.querySelector?.(".map-layer-toggle");
  if (layerRow) mapSheetObserver.observe(layerRow);
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

let ttcGeometry;
async function fetchTtcGeometry() {
  try {
    const response=await fetch(CONFIG.snapshotUrl.replace('current.json','ttc-diversions.json')+`?ts=${Date.now()}`,{cache:'no-store',signal:AbortSignal.timeout(4000)});
    return response.ok ? await response.json() : {status:'unavailable'};
  } catch { return {status:'unavailable'}; }
}

async function fetchSnapshot() {
  const ttcFixture=await loadTtcUiFixture();
  const finishFetch = uxAudit.begin('incident-snapshot-fetch');
  if (mobileAuditFixture) {
    await waitForAuditDelay(uxReliabilityFixture?.incidentDelayMs || 0);
    const payload = mobileAuditFixtureSnapshot(mobileAuditFixture.state);
    finishFetch({ source: 'mobile-audit-fixture', incidents: payload.incidents.length });
    const finishNormalization = uxAudit.begin('incident-normalization');
    const snapshot = {
      calls: payload.incidents.map(row => normalizeCall(row)).sort((a, b) => b.timestamp - a.timestamp),
      disruptions: mergeTtcDisruptions(payload.disruptions,ttcFixture?.ttcAlerts,ttcFixture?.ttcDiversions,ttcFixture?.transit),
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
  if(!ttcFixture) void fetchTtcGeometry().then(geometry=>{
    ttcGeometry=geometry;
    if(state.disruptions) {state.disruptions={...state.disruptions,ttcDiversions:geometry};renderTtc(state.disruptions,dispatchMap,{origin:radiusFilterOrigin(),radius:state.radiusKm});}
  });
  const response = await fetch(`${CONFIG.snapshotUrl}?ts=${Date.now()}`, { cache: "no-store" });
  if (!response.ok) throw new Error(`Official TFS snapshot returned HTTP ${response.status}`);
  const payload = await response.json();
  const rows = Array.isArray(payload) ? payload : (payload.incidents || []);
  finishFetch({ source: 'production-snapshot', incidents: rows.length });
  const finishNormalization = uxAudit.begin('incident-normalization');
  const snapshot = {
    calls: rows.map(row => normalizeCall(row))
      .sort((a, b) => b.timestamp - a.timestamp),
    disruptions: mergeTtcDisruptions(withTtcNearbyFixture(payload.disruptions),ttcFixture?.ttcAlerts || payload.ttcAlerts,ttcFixture?.ttcDiversions || ttcGeometry),
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
    const callsChanged = JSON.stringify(state.calls) !== JSON.stringify(snapshot.calls);
    const readingPosition = callsChanged && snapshotLoaded ? captureCallReadingPosition() : null;
    const firstSnapshot = !snapshotLoaded;
    if (firstSnapshot) await yieldForLoadingPaint();
    snapshotLoaded = true;
    const previousSourceTime = parseLooseTime(state.lastIngest)?.getTime();
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
      applyFilters({ preserveReadingPosition: readingPosition });
    }
    const availability = incidentAvailability();
    setIncidentLoadPhase(!availability.hasRelevantCachedData && availability.allUnavailable ? 'unavailable' : 'ready');
    renderNearbySummary();
    auditReadiness.data = true;
    markFullyRenderedWhenReady();
    restorePendingIncident();
    if (delayedSecondary && callsChanged && readingPosition) restoreCallReadingPosition(readingPosition);
    const finishSecondary = uxAudit.begin('secondary-feed-preparation');
    if (delayedSecondary) {
      await waitForAuditDelay(uxReliabilityFixture.secondaryDelayMs);
      state.disruptions = snapshot.disruptions;
    }
    renderDisruptions(state.disruptions, radiusFilterOrigin(), state.radiusKm, dispatchMap);
    renderTtc(state.disruptions,dispatchMap,{origin:radiusFilterOrigin(),radius:state.radiusKm});
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
    if (!delayedSecondary && callsChanged && readingPosition) restoreCallReadingPosition(readingPosition);
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
          <p>${escapeHtml(error.message)}</p>
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
    divisions.map(d => `<option value="${encodeURIComponent(d)}">${escapeHtml(d)}</option>`).join("");

  const exists = divisions.includes(current);
  state.division = exists ? current : "all";
  els.divisionSelect.value = state.division === "all" ? "all" : encodeURIComponent(state.division);
}

function applyFilters({ map = true, preserveReadingPosition = null } = {}) {
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
  expandedCluster.clear();
  document.querySelector("#filterSummary").textContent = filterSummary(state);
  syncMobileFilterIndicator();
  syncFocusFilterSummary();
  syncSearchControl();
  render(map, preserveReadingPosition);
  if (map && previouslyFocusedCallId !== focusedCallId) {
    updateMarkerAppearance(previouslyFocusedCallId);
    updateMarkerAppearance(focusedCallId);
  }
  rememberPreferences();
  return true;
}

function render(map = true, preserveReadingPosition = null) {
  if (els.windowLabel) {
    els.windowLabel.textContent = `${state.hours} hour${state.hours === 1 ? "" : "s"}`;
  }
  renderStats();
  renderNearbySummary();
  renderSirenResults();
  renderCalls(preserveReadingPosition);
  if (map) renderMap();
  renderDisruptions(state.disruptions, radiusFilterOrigin(), state.radiusKm, dispatchMap);
  renderTtc(state.disruptions,dispatchMap,{origin:radiusFilterOrigin(),radius:state.radiusKm});
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
        coordinatesForCall,
        hours: state.hours
      })
    : null;
  const summaryText = empty?.message
    || nearbySummary(state.filtered, state.radiusKm, Date.now(), state.nearby, coordinatesForCall, state.hours);
  const mobileSummaryText = mobileNearbySummary(
    state.filtered, state.radiusKm, Date.now(), state.nearby, coordinatesForCall, state.hours
  );
  document.querySelector("#nearbySummaryText").textContent = summaryText;
  document.querySelector("#mobileNearbySummaryText").textContent = mobileSummaryText;
  if (!focusedClosureId && mobileSheetSummary) mobileSheetSummary.textContent = mobileSummaryText;
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
    `<div><strong>${escapeHtml(group.type)}:</strong> ${escapeHtml(group.values)}</div>`).join("");

  const hint = row.querySelector(".show-map-hint");
  hint.hidden = variant === "popup" || !coordinatesForCall(call);
  const shareButton = row.querySelector('.share-incident');
  shareButton.setAttribute('aria-label', `Share incident: ${call.description}`);
  shareButton.addEventListener('click', event => handleIncidentShare(event, call));
  finishFirstCard({ connected: row.isConnected, titleLength: call.description.length });
  return row;
}

// Capture the actual scroll owner: desktop list, mobile sheet, or document.
// Keep surviving neighbouring cards as fallbacks when the visible call expires.
function captureCallReadingPosition() {
  const list = els.callList;
  const owners = [];
  let top = 0;
  let bottom = window.innerHeight;
  for (let node = list; node; node = node.parentElement) {
    if (!/(auto|scroll)/.test(getComputedStyle(node).overflowY)) continue;
    const rect = node.getBoundingClientRect();
    top = Math.max(top, rect.top);
    bottom = Math.min(bottom, rect.bottom);
    owners.push({ node, scrollTop: node.scrollTop });
  }
  const cards = [...list.querySelectorAll('.incident-card')];
  let visibleIndex = cards.findIndex(card => {
    const rect = card.getBoundingClientRect();
    return rect.top >= top && rect.top < bottom;
  });
  if (visibleIndex < 0) visibleIndex = cards.findIndex(card => {
    const rect = card.getBoundingClientRect();
    return rect.bottom > top && rect.top < bottom;
  });
  const anchors = visibleIndex < 0 ? [] : cards.map((card, index) => ({
    id: card.dataset.callId,
    index,
    top: card.getBoundingClientRect().top,
    distance: Math.abs(index - visibleIndex)
  })).sort((a, b) => a.distance - b.distance);
  return { count: renderedIncidentCount, owners, pageTop: window.scrollY, anchors };
}

function restoreCallReadingPosition(position) {
  for (const owner of position.owners) owner.node.scrollTop = owner.scrollTop;
  window.scrollTo({ top: position.pageTop, behavior: 'instant' });
  const cards = new Map([...els.callList.querySelectorAll('.incident-card')]
    .map(card => [card.dataset.callId, card]));
  // Seed deferred layout with real refreshed heights before restoring the anchor.
  // Otherwise content-visibility's default estimate causes a second scroll jump.
  const measured = [...cards.values()].map(card => {
    const style = getComputedStyle(card);
    const inset = ['paddingTop', 'paddingBottom', 'borderTopWidth', 'borderBottomWidth']
      .reduce((sum, key) => sum + parseFloat(style[key]), 0);
    return [card, card.getBoundingClientRect().height - inset];
  });
  for (const [card, height] of measured) {
    card.style.containIntrinsicBlockSize = `auto ${height}px`;
    card.style.removeProperty('content-visibility');
  }
  const anchor = position.anchors.find(item => cards.has(item.id));
  if (!anchor) return;
  const delta = cards.get(anchor.id).getBoundingClientRect().top - anchor.top;
  const owner = position.owners.find(item => item.node.scrollHeight > item.node.clientHeight);
  if (owner) owner.node.scrollTop += delta;
  else window.scrollTo({ top: window.scrollY + delta, behavior: 'instant' });
}

function renderCalls(preserveReadingPosition = null) {
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
      const nextIndices = new Map(sortedIncidentCalls.map((call, index) => [call.id, index]));
      const survivingAnchor = preserveReadingPosition?.anchors.find(anchor => nextIndices.has(anchor.id));
      const anchorIndex = survivingAnchor ? nextIndices.get(survivingAnchor.id) : -1;
      const batchSize = preserveReadingPosition
        ? Math.max(INCIDENT_LIST_BATCH_SIZE, preserveReadingPosition.count + Math.max(0, anchorIndex - (survivingAnchor?.index ?? 0)), anchorIndex + 1) : INCIDENT_LIST_BATCH_SIZE;
      const batch = nextIncidentBatch(sortedIncidentCalls, renderedIncidentCount, batchSize);
      batch.items.forEach(call => {
        const distance = distanceLabel(distanceKm(state.nearby, coordinatesForCall(call)));
        const card = createIncidentCard(call, { distance });
        if (preserveReadingPosition) card.style.contentVisibility = 'visible';
        fragment.appendChild(card);
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
  mapPopups = createMapPopups(dispatchMap);

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
  dispatchMap.on('roadclosureselect', event => { clearTtcSelection(); selectClosure(event.item,event.layer); });
  dispatchMap.on('ttcselect',event=>{
    clearIncidentForTtc();
    if(isMobileViewLayout()) setMobileView('map',{persist:false});
    selectClosure(event.item,event.layer,true);
  });
  dispatchMap.on('ttcselectionexpired',()=>{if(focusedClosureId?.startsWith('ttc:')) clearClosureSelection();});
  dispatchMap.on('ttcselectionupdated',event=>{if(focusedClosureId === `ttc:${event.item.id}`) mobileClosureDetail.querySelector('.ttc-detail')?.replaceWith(ttcDetailFor(event.item));});
  dispatchMap.on("zoomend", () => {
    expandedCluster.clear();
    scheduleMapMarkerRender();
  });
  dispatchMap.on("click", event => {
    if (!choosingArea) return;
    chooseManualArea([event.latlng.lat, event.latlng.lng]);
  });
  policeBoundaryMap.setup();
  auditReadiness.map = true;
  finishCreation();
  markFullyRenderedWhenReady();
}

function clearIncidentForTtc() {
  const previous=focusedCallId;
  focusedCallId=null;
  if (expandedCluster.size || previous) {
    expandedCluster.clear();
    if (dispatchMap) renderMapMarkers();
  }
  mapPopups.closeImmediately();
  if(previous) updateMarkerAppearance(previous);
  for(const row of document.querySelectorAll('.incident-card.selected')) {
    row.classList.remove('selected','pin-highlight');
    if(row.hasAttribute('role')) row.setAttribute('aria-pressed','false');
  }
}

function clearClosureSelection() {
  clearTtcSelection();
  disruptionUi.syncClosureCardSelection(null);
  const hadClosure=focusedClosureId !== null;
  focusedClosureId=null;
  mapPopups.closeImmediately();
  if (mobileClosureDetail) {
    mobileClosureDetail.hidden=true;
    mobileClosureDetail.replaceChildren();
  }
  mobileSheetCallList.hidden=false;
  mobileCallsFeedStatus.hidden=callsFeedStatus.hidden;
  if (hadClosure) renderNearbySummary();
}

// The TTC detail chrome is shared by the mobile sheet and both bubbles; one
// helper keeps the three call sites on the same variant (Story 74 hardening).
function ttcDetailFor(item) { return createTtcDetail(item,{variant:'detail'}); }
function selectClosure(closure, layer, ttc=false) {
  if (!closure) return;
  focusedClosureId=(ttc ? 'ttc:' : '')+String(closure.id ?? '');
  const detail=ttc ? ttcDetailFor(closure) : createClosureDetail(closure);
  if (!ttc) disruptionUi.syncClosureCardSelection(closure.id);
  if (isMobileViewLayout()) {
    const back=document.createElement('button');
    back.type='button';back.className='closure-detail-back';back.textContent='← Back to incident list';
    back.addEventListener('click',()=>{clearClosureSelection();mobileSheetToggle.focus({preventScroll:true});});
    mobileClosureDetail.replaceChildren(back,detail);
    mobileClosureDetail.hidden=false;
    mobileSheetCallList.hidden=true;
    mobileCallsFeedStatus.hidden=true;
    mobileSheetSummary.textContent=ttc ? closure.routes.map(r=>r.label).join(' · ') || 'TTC disruption' : closure.street || closure.title || 'Road closure';
    setMobileSheetState(mobileSheetState === 'collapsed' ? 'half' : mobileSheetState);
    if(ttc) {
      document.querySelector('#mobileSheetBody').scrollTop=0;back.focus({preventScroll:true});
      // Story 74: mobile map taps open the bubble too, mirroring the
      // road-closure bubble (Story 66). The sheet keeps its own live detail
      // node (ttcselectionupdated replaces it on refresh), so the bubble gets
      // a separate snapshot node instead of moving the sheet's node into the
      // popup the way the road branch does.
      const anchor=layer?.getLatLng?.() || layer?.getBounds?.().getCenter?.();
      if(anchor) mapPopups.openAt(ttcDetailFor(closure),anchor);
    }
    else {
      // Story 74 hardening: the sheet keeps its detail node (the popup used to
      // move it out of the sheet, leaving only the Back button), and the bubble
      // gets its own snapshot node at the clicked symbol.
      const anchor=layer?.getLatLng?.() || layer?.getBounds?.().getCenter?.();
      mapPopups.openAt(createClosureDetail(closure),anchor);
    }
    return;
  }
  if(ttc) {
    const host=[...document.querySelectorAll('#observedDiversionsList .incident-card')].find(el=>el.dataset.ttcId===closure.id);
    if(host) {host.classList.add('selected');if(layer) {host.scrollIntoView({block:'nearest'});host.focus({preventScroll:true});}}
    // Story 74: the map bubble mirrors the road-closure bubble and anchors on
    // the clicked sign marker (or the hit line's center when no sign resolved).
    // The map-level popup replaces its content per selection, so sequential
    // clicks can never accumulate duplicate detail blocks.
    const anchor=layer?.getLatLng?.() || layer?.getBounds?.().getCenter?.();
    if(anchor) mapPopups.openAt(detail,anchor);
  } else mapPopups.openBound(detail,layer);
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
  const marker = incidentMarkers.getMarker(callId);
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
bindTtcListInteractions();

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
    policeBoundaryMap.setVisible(saved.boundaries);
    themePreference = saved.theme;
    document.querySelector('#themePreference').value = themePreference;
    syncTheme();
    if (!mobileViewInteracted) setMobileView(saved.mobileView, { persist: false });
    syncFilterControls();
  }
} catch { /* Defaults remain usable when storage is blocked. */ }
if (mobileAuditFixture) {
  document.querySelector('#roadOverlay').checked = mobileAuditFixture.roads;
  policeBoundaryMap.setVisible(mobileAuditFixture.boundaries);
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
function focusFilterSummaryText() {
  const parts = [];
  const originLabel = nearbyOriginKind === 'map'
    ? 'the selected area'
    : nearbyOriginKind === 'saved'
      ? savedLocationForContext(state)?.label || 'the saved location'
      : 'your location';
  if (state.radiusKm === null) parts.push('Toronto-wide');
  else if (state.nearby) parts.push(`Within ${state.radiusKm} km of ${originLabel}`);
  else parts.push(`${state.radiusKm} km radius`);
  parts.push(state.hours < 24 ? `Last ${state.hours} hour${state.hours === 1 ? '' : 's'}` : state.hours === 24 ? 'Last 24 hours' : `Last ${state.hours / 24} days`);
  if (state.serviceFilter !== 'all') parts.push(state.serviceFilter === 'TFS' ? 'Fire' : 'Police');
  if (state.eventFilter !== 'all') parts.push(`Event: ${state.eventFilter}`);
  if (state.division !== 'all') parts.push(state.division);
  if (state.search) parts.push(`Search: “${state.search}”`);
  return parts.join(' · ');
}
function syncFocusFilterSummary() {
  if (!mobileFocusFilterSummary) return;
  const visible = mobileFocusMode && isMobileViewLayout();
  mobileFocusFilterSummary.hidden = !visible;
  if (visible) {
    const availability = incidentAvailability();
    const warnings = [
      ...availability.unavailable.map(feed => `${feed.name} data unavailable`),
      ...availability.stale.map(feed => `${feed.name} data may be stale`)
    ];
    if (availability.unavailable.length && availability.hasRelevantCachedData) warnings.push('Previously loaded calls remain visible');
    mobileFocusFilterSummary.textContent = [focusFilterSummaryText(), ...warnings].join(' · ');
  }
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

document.querySelector('#ttcOverlay').addEventListener('change',event=>setTtcVisibility(event.target.checked));
