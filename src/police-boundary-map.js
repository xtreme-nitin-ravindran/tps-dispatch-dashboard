// The police-boundary overlay block (Stories 38E/38G): owns the division layer
// lifecycle, the generation-guarded geometry initialization, the toggle/redraw
// scheduling, and the optional boundary debug panel/export. Extracted from
// app.js with injectable dependencies; app.js keeps accessor call sites for
// theme changes, view switches, and preference persistence.
import { capturePoliceBoundaryRenderState, createPoliceBoundaryLayer, diagnosePoliceBoundaryGeometry, policeBoundaryRingCount, policeBoundarySymbolPositions } from './police-boundary-overlay.js';

export function createPoliceBoundaryMap({
  getMap = () => null,
  mapElement = null,
  L = globalThis.L,
  isMobileLayout = () => false,
  getMobileView = () => 'map',
  getSheetState = () => 'collapsed',
  getRendererMode = () => 'canvas',
  isDebugEnabled = false,
  audit = null,
  scheduler = null,
  markReady = () => {},
  rememberPreferences = () => {},
  syncLayerControls = () => {},
  captureRoadClosureState = null,
  requestAnimationFrame = globalThis.requestAnimationFrame,
  cancelAnimationFrame = globalThis.cancelAnimationFrame,
  fetch = globalThis.fetch,
  document = globalThis.document,
  navigator = globalThis.navigator,
  URL = globalThis.URL,
  Blob = globalThis.Blob,
  console = globalThis.console,
  structuredClone = globalThis.structuredClone,
  getComputedStyle = globalThis.getComputedStyle
} = {}) {
  let divisionLayer = null;
  let divisionGeometryLayer = null;
  let divisionRenderer = null;
  let divisionDataPromise = null;
  let boundaryVisible = true;
  let boundaryRenderFrame = null;
  let boundaryRenderGeneration = 0;
  let boundaryDirty = true;
  let boundaryLifecycleEvent = 'startup';
  let boundaryDebugCapture = null;
  let boundaryGeojson = null;
  let boundaryGlyphLayer = null;
  let boundaryControl = null;
  const boundaryDebugHistory = [];

  function mapAllowsBoundaryWork() {
    const map = getMap();
    if (!map || !divisionLayer || !boundaryVisible || !map.hasLayer(divisionLayer)) return false;
    if (isMobileLayout() && getMobileView() !== 'map') return false;
    const rect = mapElement?.getBoundingClientRect?.();
    const size = map.getSize?.();
    return Boolean(rect?.width > 0 && rect?.height > 0 && size?.x > 0 && size?.y > 0);
  }

  function redrawPoliceBoundaries() {
    divisionGeometryLayer?.eachLayer?.(layer => layer.redraw?.());
  }

  function captureBoundaryDiagnostic(reason) {
    if (!isDebugEnabled) return null;
    const map = getMap();
    const police = capturePoliceBoundaryRenderState({
      map,
      layer: divisionGeometryLayer,
      lifecycleEvent: reason,
      scheduling: {
        boundaryDirty,
        boundaryRenderFramePending: boundaryRenderFrame !== null,
        layoutTransitionPending: scheduler.pending(),
        generation: boundaryRenderGeneration
      }
    });
    const roads = captureRoadClosureState?.(map);
    boundaryDebugCapture = {
      ...police,
      sheetState: getSheetState(),
      mobileView: getMobileView(),
      police: {
        layerId: divisionGeometryLayer?._leaflet_id ?? null,
        rendererId: divisionRenderer?._leaflet_id ?? null,
        pane: divisionRenderer?.options?.pane || 'overlayPane',
        visible: Boolean(divisionGeometryLayer && map?.hasLayer?.(divisionGeometryLayer))
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
    if (!isDebugEnabled) return;
    requestAnimationFrame(() => {
      captureBoundaryDiagnostic(reason);
      audit.record('police-boundary-render-diagnostic', {
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

  function boundaryGlyphIcon() {
    return L.divIcon({
      className: 'police-boundary-symbol',
      html: '<span aria-hidden="true">🚔</span>',
      iconSize: [20, 20],
      iconAnchor: [10, 10]
    });
  }

  function renderBoundaryGlyphs(reason) {
    const map = getMap();
    if (!map || !boundaryGlyphLayer || !boundaryVisible || !boundaryGeojson) return;
    boundaryGlyphLayer.clearLayers();
    const positions = policeBoundarySymbolPositions(boundaryGeojson, map);
    for (const position of positions) {
      L.marker(position, { icon: boundaryGlyphIcon(), interactive: false, keyboard: false, title: '' }).addTo(boundaryGlyphLayer);
    }
    boundaryLifecycleEvent = reason;
  }

  function clearBoundaryGlyphs() {
    boundaryGlyphLayer?.clearLayers?.();
  }

  // The legend key + badge glyph live in Leaflet's built-in layers control, whose
  // `_update` empties and rebuilds the overlay label on every layer add/remove.
  // This is therefore idempotent and re-applied on each boundary geometry change.
  function applyBoundaryLegendGlyph() {
    const label = boundaryControl?.getContainer?.()?.querySelector('.leaflet-control-layers-overlays label');
    if (!label) return;
    label.setAttribute('data-mobile-label', 'Police Divisions');
    if (label.querySelector('.police-key-wrap')) return;
    const keyWrap = document.createElement('span');
    keyWrap.className = 'police-key-wrap';
    keyWrap.setAttribute('aria-hidden', 'true');
    const key = document.createElement('span');
    key.className = 'police-key';
    const sign = document.createElement('span');
    sign.className = 'police-sign';
    keyWrap.append(key, sign);
    label.insertBefore(keyWrap, label.querySelector('span'));
  }

  async function initializePoliceBoundaries(generation, reason) {
    const map = getMap();
    if (!mapAllowsBoundaryWork() || generation !== boundaryRenderGeneration) return;
    if (divisionGeometryLayer) {
      const finishRender = audit.begin('police-boundary-layer-render', { reason, reused: true });
      if (!map.hasLayer(divisionGeometryLayer)) divisionGeometryLayer.addTo(map);
      requestAnimationFrame(applyBoundaryLegendGlyph);
      if (boundaryDirty) redrawPoliceBoundaries();
      boundaryDirty = false;
      boundaryLifecycleEvent = reason;
      finishRender();
      audit.mark('police-boundary-redraw-complete', { reason });
      captureBoundaryDebugAfterPaint(reason);
      return;
    }
    const finishBoundary = audit.begin('police-boundary-layer-initialization', { reason });
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
      const rendererMode = getRendererMode();
      if (!map.getPane('policeBoundaryPane')) {
        const pane = map.createPane('policeBoundaryPane');
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
      divisionGeometryLayer.addTo(map);
      if (!boundaryGlyphLayer) {
        boundaryGlyphLayer = L.layerGroup();
        boundaryGlyphLayer.addTo(map);
      }
      boundaryGeojson = boundaries;
      renderBoundaryGlyphs(reason);
      requestAnimationFrame(applyBoundaryLegendGlyph);
      const geometryAfter = diagnosePoliceBoundaryGeometry(boundaries);
      boundaryDirty = false;
      boundaryLifecycleEvent = reason;
      audit.record('police-boundary-geometry-diagnostic', {
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
      markReady();
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
    const map = getMap();
    divisionLayer = L.layerGroup();
    map.on('overlayadd overlayremove', event => {
      if (event.layer !== divisionLayer) return;
      const finishToggle = audit.begin('interaction:police-boundaries');
      boundaryVisible = event.type === 'overlayadd';
      boundaryLifecycleEvent = event.type;
      if (boundaryVisible) queuePoliceBoundaryWork('overlay-enabled');
      else {
        captureBoundaryDiagnostic('boundaries-off');
        boundaryRenderGeneration += 1;
        if (boundaryRenderFrame !== null) cancelAnimationFrame(boundaryRenderFrame);
        boundaryRenderFrame = null;
        if (divisionGeometryLayer && map.hasLayer(divisionGeometryLayer)) {
          map.removeLayer(divisionGeometryLayer);
        }
        clearBoundaryGlyphs();
        requestAnimationFrame(applyBoundaryLegendGlyph);
      }
      rememberPreferences();
      finishToggle({ visible: boundaryVisible, constructionDeferred: boundaryVisible && !divisionGeometryLayer });
    });
    boundaryControl = L.control.layers(null, { "Police Divisions": divisionLayer }, {
      collapsed: false, position: "topright"
    });
    boundaryControl.addTo(map);
    // Story 40D: keep the full official wording in the DOM/attribution but show a
    // concise "Police Divisions" label on the compact mobile control. The legend
    // key + badge glyph are applied after the control rebuilds its overlay label
    // (see applyBoundaryLegendGlyph).
    requestAnimationFrame(applyBoundaryLegendGlyph);
    syncLayerControls();
    if (boundaryVisible) {
      divisionLayer.addTo(map);
      queuePoliceBoundaryWork('initial-visible-map');
    }
    markReady();
    for (const eventName of ['zoomstart', 'zoomend', 'movestart', 'moveend', 'resize']) {
      map.on(eventName, () => {
        boundaryLifecycleEvent = eventName;
        if (eventName.endsWith('end') || eventName === 'resize') captureBoundaryDebugAfterPaint(eventName);
        if (eventName === 'zoomend') renderBoundaryGlyphs(eventName);
      });
    }
    map.on('roadclosureredraw', () => captureBoundaryDebugAfterPaint('road-closure-redraw-complete'));
    if (isDebugEnabled) {
      globalThis.__sirentoPoliceBoundaryDebug = {
        capture: () => captureBoundaryDiagnostic(boundaryLifecycleEvent),
        latest: () => boundaryDebugCapture,
        history: () => structuredClone(boundaryDebugHistory),
        renderer: () => getRendererMode()
      };
      installBoundaryDebugExport();
    }
  }

  return {
    setup: setupDivisionOverlay,
    mapAllowsBoundaryWork,
    redrawPoliceBoundaries,
    captureBoundaryDiagnostic,
    queuePoliceBoundaryWork,
    hasGeometry: () => Boolean(divisionGeometryLayer),
    isVisible: () => boundaryVisible,
    markDirty: reason => { boundaryDirty = true; boundaryLifecycleEvent = reason; },
    setStyle: options => divisionGeometryLayer?.setStyle?.(options),
    invalidatePendingWork: reason => {
      boundaryDirty = true;
      boundaryLifecycleEvent = reason;
      boundaryRenderGeneration += 1;
      if (boundaryRenderFrame !== null) cancelAnimationFrame(boundaryRenderFrame);
      boundaryRenderFrame = null;
    },
    staleScheduledWork: () => {
      boundaryDirty = true;
      boundaryRenderGeneration += 1;
      if (boundaryRenderFrame !== null) cancelAnimationFrame(boundaryRenderFrame);
      boundaryRenderFrame = null;
    },
    setVisible: visible => { boundaryVisible = visible; }
  };
}
