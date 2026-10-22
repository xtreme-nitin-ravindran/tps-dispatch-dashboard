// The incident marker/cluster rendering block: owns the per-incident markers,
// the cluster representations and their reconciliation, the expanded-cluster
// connector fan, the marker aging/appearance updates, and the coalesced render
// scheduling. Extracted from app.js with injectable dependencies; app.js keeps
// the selection strategy (expandedCluster, focusGroup) and thin name bindings.
import { MAX_EXPANDED_CLUSTER_SIZE, connectorFan, canExpandCluster, clusterPoints } from './map-clusters.js?v=story-39a-1';
import { incidentGroupKey, reconcileIncidentLayers } from './incident-layer-diff.js';

export function createIncidentMarkerLayer({
  getMap = () => null,
  getCallLayer = () => null,
  getCalls = () => [],
  getNearby = () => null,
  getRadiusKm = () => null,
  getFocusedCallId = () => null,
  getSirenIds = () => new Set(),
  getExpandedCluster = () => new Set(),
  setExpandedCluster = () => {},
  isMobileLayout = () => false,
  getMobileSheetState = () => 'collapsed',
  setMobileSheetState = () => {},
  selectCall = () => {},
  reopenPopup = () => {},
  createIncidentCard = () => document.createElement('article'),
  coordinatesForCall = () => null,
  isApproximate = () => false,
  distanceKm = () => 0,
  distanceLabel = () => '',
  audit = null,
  markerAgeLabel = tier => tier,
  markerAgeTier = () => 'fresh',
  markerGlyph = () => '',
  setMapStatus = () => {},
  getNearbyOriginLayer = () => null,
  getMapHasFitted = () => false,
  setMapHasFitted = () => {},
  L = globalThis.L,
  document = globalThis.document,
  requestAnimationFrame = globalThis.requestAnimationFrame
} = {}) {
  let mapMarkers = new Map();
  let renderedIncidentLayers = new Map();
  let scheduledMarkerRender = null;

  function markerAccessibleLabel(call, selected, now = Date.now()) {
    const age = markerAgeLabel(markerAgeTier(call.timestamp, now));
    return `${selected ? "Selected incident: " : "Incident: "}${call.source} ${call.eventCategory}, ${call.description}, ${age}`;
  }

  function markerIcon(call, selected = false, sirenMatch = false, now = Date.now()) {
    const ageTier = markerAgeTier(call.timestamp, now);
    const approximate = isApproximate(call);
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
    const call = marker && getCalls().find(item => item.id === id);
    if (!call) return;
    const selected = id === getFocusedCallId();
    const label = markerAccessibleLabel(call, selected, now);
    const sirenMatch = getSirenIds().has(id);
    marker.setIcon(markerIcon(call, selected, sirenMatch, now));
    marker.getElement()?.setAttribute("aria-label", label);
    marker.getElement()?.setAttribute("title", label);
  }

  function scheduleRender() {
    if (scheduledMarkerRender !== null) return;
    scheduledMarkerRender = requestAnimationFrame(() => {
      scheduledMarkerRender = null;
      render();
    });
  }

  function assertConnectorLayerInvariants() {
    let connectors = 0;
    getCallLayer().eachLayer(layer => {
      if (layer.options?.className === 'cluster-connector') connectors += 1;
    });
    if (connectors > MAX_EXPANDED_CLUSTER_SIZE) {
      throw new RangeError(`rendered connector count ${connectors} exceeded ${MAX_EXPANDED_CLUSTER_SIZE}`);
    }
    if (!getExpandedCluster().size && connectors) {
      throw new Error('stale cluster connectors remained after cluster collapse');
    }
  }

  function incidentRepresentationVersion(group, expanded, sirenIds) {
    if (!expanded && group.length > 1) {
      return JSON.stringify({
        incidents: group.map(({call, coordinates}) => [call.id, coordinates, call.timestamp, sirenIds.has(call.id)]),
        focusedCallId: group.some(({call}) => call.id === getFocusedCallId()) ? getFocusedCallId() : null
      });
    }
    return JSON.stringify(group.map(({call, coordinates}) => [
      call, coordinates, sirenIds.has(call.id), getNearby()
    ]));
  }

  function render() {
    const map = getMap();
    const callLayer = getCallLayer();
    const finishMarkers = audit.begin('marker-cluster-creation', { incidents: getCalls().length });
    const sirenIds = getSirenIds();

    const locatedCalls = getCalls()
      .map(call => ({ call, coordinates: coordinatesForCall(call) }))
      .filter(item => item.coordinates);

    const addMarker = ({call, coordinates}, position = coordinates, layers = []) => {
      const tooltip = document.createElement('span');
      tooltip.textContent = `${call.source}: ${call.description}`;
      const selected = call.id === getFocusedCallId();
      const accessibleLabel = markerAccessibleLabel(call, selected);
      const marker = L.marker(position, {
        title: accessibleLabel,
        alt: accessibleLabel,
        icon: markerIcon(call, selected, sirenIds.has(call.id))
      })
        .bindTooltip(tooltip, { direction: "top" })
        .bindPopup(createIncidentCard(call, {
          distance: distanceLabel(distanceKm(getNearby(), coordinates)),
          variant: "popup"
        }), { minWidth: 280, maxWidth: 360, closeOnClick: false })
        .on("click", event => {
          const mobile = isMobileLayout();
          if (mobile) setMobileSheetState(getMobileSheetState() === "collapsed" ? "half" : getMobileSheetState());
          selectCall(call.id);
          if (!mobile) setTimeout(() => reopenPopup(event.target), 0);
        });
      marker.addTo(callLayer);
      layers.push(marker);
      mapMarkers.set(call.id, marker);
      return marker;
    };
    const groups = clusterPoints(locatedCalls, point => map.project(point, map.getZoom()));
    const representations = groups.map(group => {
      const expanded = canExpandCluster(group) && group.every(item => getExpandedCluster().has(item.call.id));
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
        const pixel = map.latLngToLayerPoint(center);
        const fan = connectorFan(group, pixel);
        if (fan.length > MAX_EXPANDED_CLUSTER_SIZE) throw new RangeError('connector count exceeded expansion limit');
        fan.forEach(({item, endpoint}) => {
          const position = map.layerPointToLatLng(L.point(endpoint.x,endpoint.y));
          const connector = L.polyline([center,position],{className:'cluster-connector',color:'#b7c8d9',weight:1,interactive:false}).addTo(callLayer);
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
          if (map.getZoom() < 18) map.setView(center,Math.min(18,map.getZoom()+2));
          else if (canExpandCluster(group)) { setExpandedCluster(new Set(group.map(item => item.call.id))); render(); }
        }).addTo(callLayer);
      layers.push(cluster);
      const selectedItem = group.length > 1 && group.find(item => item.call.id === getFocusedCallId());
      if (selectedItem && !canExpandCluster(group)) {
        const marker = addMarker(selectedItem, selectedItem.coordinates, layers);
        markers.set(selectedItem.call.id, marker);
      }
      renderedIncidentLayers.set(key, {layers, markers});
    }

    const mapStatusText = locatedCalls.length ? `${locatedCalls.length}/${getCalls().length} LOCATED` : "NO MAPPED LOCATIONS";
    setMapStatus(mapStatusText);
    getNearbyOriginLayer()?.clearLayers();
    if (getNearby() && getRadiusKm() !== null) {
      L.circle(getNearby(), { className: 'nearby-radius', radius: getRadiusKm() * 1000, color: '#63e6be', weight: 1, opacity: .65, fillOpacity: .035, interactive: false }).addTo(getNearbyOriginLayer());
      L.circleMarker(getNearby(), { className: 'nearby-origin', radius: 6, color: '#fff', weight: 2, fillColor: '#63e6be', fillOpacity: 1, interactive: false }).addTo(getNearbyOriginLayer());
    }
    if (!getMapHasFitted() && getNearby() && getRadiusKm() !== null) {
      setMapHasFitted(true);
      map.setView(getNearby(), getRadiusKm() <= 0.5 ? 15 : getRadiusKm() <= 2 ? 14 : 12);
    } else if (locatedCalls.length && !getMapHasFitted()) {
      setMapHasFitted(true);
      map.fitBounds(L.latLngBounds(locatedCalls.map(item => item.coordinates)), { padding: [24, 24], maxZoom: 12 });
    }
    assertConnectorLayerInvariants();
    finishMarkers({ locatedCalls: locatedCalls.length, representations: representations.length });
  }

  return { render, scheduleRender, updateAppearance: updateMarkerAppearance, updateAll: updateMarkerAppearances, getMarker: id => mapMarkers.get(id) };
}
