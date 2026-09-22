import { reportedAge, callExplanation, locationConfidence } from "./src/call-presentation.js?v=confidence-1";
import { distanceKm } from "./src/nearby.js";
import { policeUnitLabel } from "./src/tps/unit-label.js?v=3";
import { incidentCategory } from "./src/tfs/category.js";
import { locationDisplay, expandLocationAbbreviations } from "./src/location-display.js?v=hydro-corridor-1";
import { isWithinHistoryWindow } from "./src/tfs/time.js";

const CONFIG = {
  snapshotUrl: "./data/current.json",
  refreshCheckMs: 30_000
};

const state = {
  nearby: null,
  radiusKm: 2,
  hours: 24,
  calls: [],
  filtered: [],
  lastIngest: null,
  fetchedAt: null,
  search: "",
  division: "all",
  serviceFilter: "all",
  eventFilter: "all"
};

const els = {
  lastUpdated: document.querySelector("#lastUpdated"),
  windowLabel: document.querySelector("#windowLabel"),
  searchInput: document.querySelector("#searchInput"),
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
  divisionBars: document.querySelector("#divisionBars"),
  eventToggles: document.querySelectorAll("[data-event-filter]"),
  dispatchMap: document.querySelector("#dispatchMap"),
  mapStatus: document.querySelector("#mapStatus"),
  sourceUpdated: document.querySelector("#sourceUpdated"),
  mapEmpty: document.querySelector("#mapEmpty"),
  callTemplate: document.querySelector("#callTemplate"),
  footerClock: document.querySelector("#footerClock")
};

const TORONTO_CENTER = [43.7001, -79.42];
let dispatchMap = null;
let mapMarkers = new Map();
let focusedCallId = null;
let rowHighlightTimer;
let mapHasFitted = false;

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
  const response = await fetch(`${CONFIG.snapshotUrl}?ts=${Date.now()}`, { cache: "no-store" });
  if (!response.ok) throw new Error(`Official TFS snapshot returned HTTP ${response.status}`);
  const payload = await response.json();
  const rows = Array.isArray(payload) ? payload : (payload.incidents || []);
  return {
    calls: rows.map(normalizeCall).sort((a, b) => b.timestamp - a.timestamp),
    feeds: payload.feeds,
    fetchedAt: payload.fetchedAt || null,
    updatedAt: payload.sourceUpdatedAt || payload.fetchedAt || null
  };
}

let sourceHighlightTimer;

async function loadData({ silent = false } = {}) {

  try {
    const snapshot = await fetchSnapshot();
    const previousSourceTime = parseLooseTime(state.lastIngest)?.getTime();
    const callsChanged = JSON.stringify(state.calls) !== JSON.stringify(snapshot.calls);
    state.calls = snapshot.calls;
    state.lastIngest = snapshot.updatedAt;
    state.fetchedAt = snapshot.fetchedAt;
    const sourceTime = parseLooseTime(snapshot.updatedAt);
    const feedLabel = (name, feed) => {
      const checked = parseLooseTime(feed?.fetchedAt);
      const time = parseLooseTime(feed?.sourceUpdatedAt) || checked;
      const stale = !checked || Date.now() - checked.getTime() > 10 * 60 * 1000;
      const label = name === "TPS" ? "TPS checked" : "TFS";
      return `${label}: ${time ? `${formatDate(time)} · ${formatTime(time)}` : "not loaded"}${feed?.status === "unavailable" ? " (unavailable; showing saved calls)" : stale ? " (stale)" : ""}`;
    };
    els.sourceUpdated.textContent = [
      feedLabel("TFS", snapshot.feeds?.TFS || {fetchedAt:snapshot.fetchedAt, sourceUpdatedAt:snapshot.updatedAt}),
      feedLabel("TPS", snapshot.feeds?.TPS)
    ].join(" | ") + " Toronto";
    if (callsChanged) {
      applyFilters();
    }
    updateFreshness();
    if (previousSourceTime != null && sourceTime && sourceTime.getTime() !== previousSourceTime) {
      clearTimeout(sourceHighlightTimer);
      els.sourceUpdated.classList.add('source-just-updated');
      sourceHighlightTimer = setTimeout(() => {
        els.sourceUpdated.classList.remove('source-just-updated');
      }, 4000);
    }
  } catch (error) {
    console.error(error);
    if (!state.calls.length) {
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

  els.divisionSelect.innerHTML = `<option value="all">All police divisions</option>` +
    divisions.map(d => `<option value="${encodeURIComponent(d)}">${d}</option>`).join("");

  const exists = divisions.includes(current);
  state.division = exists ? current : "all";
  els.divisionSelect.value = state.division === "all" ? "all" : encodeURIComponent(state.division);
}

function applyFilters({ map = true } = {}) {
  const q = state.search.trim().toLowerCase();

  const eligibleCalls = state.calls.filter(call => {
    if (state.nearby && distanceKm(state.nearby, coordinatesForCall(call)) > state.radiusKm) return false;
    if (state.serviceFilter !== "all" && call.source !== state.serviceFilter) return false;
    if (!isWithinHistoryWindow(call.timestamp, state.hours)) return false;
    if (state.eventFilter === "ongoing" && !call.isOngoing) return false;
    if (state.eventFilter !== "all" && state.eventFilter !== "ongoing" && call.eventCategory !== state.eventFilter) return false;
    if (!q) return true;

    return [
      call.description,
      call.location,
      displayLocation(call).text,
      call.division,
      call.divisionId,
      call.id,
      call.keyword
    ].some(v => v.toLowerCase().includes(q));
  });

  // Build the facet before applying its own selection, so other divisions remain available.
  populateDivisionFilter(eligibleCalls);
  state.filtered = eligibleCalls.filter(call => state.division === "all" || call.division === state.division);
  render(map);
}

function render(map = true) {
  if (els.windowLabel) {
    els.windowLabel.textContent = `${state.hours} hour${state.hours === 1 ? "" : "s"}`;
  }
  renderStats();
  renderCalls();
  if (map) renderMap();
  renderDivisionBars();
  els.eventToggles.forEach(toggle => {
    const active = toggle.dataset.eventFilter === state.eventFilter;
    toggle.classList.toggle("active", active);
    toggle.setAttribute("aria-pressed", String(active));
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

function renderCalls() {
  els.resultCount.textContent = `${state.filtered.length} RESULT${state.filtered.length === 1 ? "" : "S"}`;

  if (!state.filtered.length) {
    els.callList.innerHTML = `
      <div class="empty-state">
        <strong>No calls match these filters.</strong>
        <p>Try another time window, division, or search term.</p>
      </div>`;
    return;
  }

  const fragment = document.createDocumentFragment();

  state.filtered.forEach(call => {
    const node = els.callTemplate.content.cloneNode(true);
    const row = node.querySelector(".call-row");
    row.dataset.callId = call.id;
    row.classList.toggle("selected", call.id === focusedCallId);
    row.tabIndex = 0;
    row.setAttribute("role", "button");
    row.setAttribute("aria-label", `${call.description} at ${displayLocation(call).text}`);
    node.querySelector(".time-main").textContent = formatTime(call.time);
    node.querySelector(".time-ago").textContent = reportedAge(call.time);
    node.querySelector(".time-ago").dataset.reportedAt = call.time.toISOString();
    node.querySelector(".call-title").textContent = call.description;
    const explanation = node.querySelector('.call-explanation');
    explanation.textContent = callExplanation(call.description);
    explanation.hidden = !explanation.textContent;
    node.querySelector(".ongoing-badge").hidden = !call.isOngoing;
    node.querySelector(".source-badge").textContent = call.source;
    node.querySelector(".police-division-badge").textContent = call.source === "TFS" && call.division !== "Unknown"
      ? `${call.division} (estimated)` : call.division;
    node.querySelector(".call-vehicles").hidden = call.source === "TPS";
    node.querySelector(".call-location").textContent = displayLocation(call).text;
    node.querySelector(".location-confidence").textContent = locationConfidence(call);
    const alarm = node.querySelector(".call-alarm");
    const alarmValue = node.querySelector(".alarm-value");
    const units = node.querySelector(".unit-list");
    if (call.isFireRelated && call.alarmLevel) {
      alarm.hidden = false;
      alarmValue.textContent = call.alarmLevel;
    }
    units.innerHTML = call.unitGroups.length
      ? call.unitGroups.map(group => `<div><strong>${escapeText(group.type)} #:</strong> ${escapeText(group.values)}</div>`).join("")
      : "Not provided by public feed";
    node.querySelector(".call-date").textContent = formatDate(call.time);
    fragment.appendChild(node);
  });

  els.callList.replaceChildren(fragment);
}

function initMap() {
  if (dispatchMap || !els.dispatchMap || typeof L === "undefined") return;

  dispatchMap = L.map(els.dispatchMap, {
    zoomControl: false,
    attributionControl: true
  }).setView(TORONTO_CENTER, 10);

  L.control.zoom({ position: "bottomright" }).addTo(dispatchMap);
  L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", {
    attribution: '&copy; OpenStreetMap contributors',
    subdomains: "abc",
    maxZoom: 19
  }).addTo(dispatchMap);
  loadDivisionOverlay();
}

async function loadDivisionOverlay() {
  try {
    const response = await fetch("./data/police-divisions.geojson?v=station-details-1");
    if (!response.ok) throw new Error("Division boundaries unavailable");
    const boundaries = await response.json();
    const details = properties => {
      const content = document.createElement("div");
      const title = document.createElement("strong");
      title.textContent = properties.UNIT_NAME || `Division ${properties.AREA_NAME}`;
      const address = document.createElement("div");
      address.textContent = properties.ADDRESS
        ? `Station: ${properties.ADDRESS}, ${properties.CITY || "Toronto"}`
        : "Station address unavailable";
      content.append(title, address);
      return content;
    };
    const layer = L.geoJSON(boundaries, {
      style: { color: "#93c5fd", weight: 1.5, opacity: 0.65, fillOpacity: 0.035 },
      attribution: "Division boundaries © Toronto Police Service",
      onEachFeature(feature, polygon) {
        polygon.bindTooltip(details(feature.properties), { sticky: true });
        polygon.bindPopup(details(feature.properties));
      }
    }).addTo(dispatchMap);
    L.control.layers(null, { "Police division boundaries": layer }, {
      collapsed: false, position: "topright"
    }).addTo(dispatchMap);
  } catch (error) {
    console.warn("Could not load the optional division overlay", error);
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

function markerIcon(selected = false, approximate = false) {
  return L.divIcon({
    className: "dispatch-marker-wrap",
    html: `<span class="dispatch-marker${approximate ? " approximate" : ""}${selected ? " selected" : ""}"></span>`,
    iconSize: [18, 18],
    iconAnchor: [9, 9]
  });
}

function renderMapMarkers() {
  mapMarkers.forEach(marker => marker.remove());
  mapMarkers = new Map();

  const locatedCalls = state.filtered
    .map(call => ({ call, coordinates: coordinatesForCall(call) }))
    .filter(item => item.coordinates);

  locatedCalls.forEach(({ call, coordinates }) => {
    const marker = L.marker(coordinates, { icon: markerIcon(call.id === focusedCallId, isApproximateLocation(call)) })
      .bindTooltip(`<strong>${call.source}: ${escapeText(call.description)}</strong><br>${escapeText(displayLocation(call).text)}`, { direction: "top" })
      .on("click", () => selectCall(call.id, { pan: false, revealRow: true }));
    marker.addTo(dispatchMap);
    mapMarkers.set(call.id, marker);
  });

  els.mapStatus.textContent = locatedCalls.length ? `${locatedCalls.length}/${state.filtered.length} LOCATED` : "NO MAPPED LOCATIONS";
  els.mapEmpty.hidden = locatedCalls.length > 0;
  if (locatedCalls.length && !mapHasFitted) {
    mapHasFitted = true;
    dispatchMap.fitBounds(L.latLngBounds(locatedCalls.map(item => item.coordinates)), { padding: [24, 24], maxZoom: 12 });
  }
}

function renderMap() {
  initMap();
  if (!dispatchMap) return;

  if (!state.filtered.some(call => call.id === focusedCallId)) focusedCallId = null;
  renderMapMarkers();
  els.mapEmpty.querySelector("strong").textContent = "No mapped locations";
  els.mapEmpty.querySelector("span").textContent = "No locations in this view could be resolved from the published data.";
}

async function selectCall(callId, { pan = true, revealRow = false } = {}) {
  const call = state.filtered.find(item => item.id === callId);
  if (!call) return;

  focusedCallId = callId;

  let selectedRow;
  document.querySelectorAll(".call-row").forEach(row => {
    const selected = row.dataset.callId === callId;
    row.classList.toggle("selected", selected);
    row.classList.remove("pin-highlight");
    if (selected) selectedRow = row;
  });
  clearTimeout(rowHighlightTimer);
  if (revealRow && selectedRow) {
    selectedRow.focus({ preventScroll: true });
    selectedRow.scrollIntoView({
      behavior: window.matchMedia("(prefers-reduced-motion: reduce)").matches ? "instant" : "smooth",
      block: "center"
    });
    selectedRow.classList.add("pin-highlight");
    rowHighlightTimer = setTimeout(() => selectedRow.classList.remove("pin-highlight"), 3500);
  }

  mapMarkers.forEach((marker, id) => {
    const mappedCall = state.filtered.find(item => item.id === id);
    marker.setIcon(markerIcon(id === callId, isApproximateLocation(mappedCall)));
  });
  const marker = mapMarkers.get(callId);
  if (marker) {
    if (pan) {
      dispatchMap.stop();
      dispatchMap.setView(marker.getLatLng(), isApproximateLocation(call) ? 14 : 17, { animate: false });
    }
    marker.openTooltip();
  }
}

function renderDivisionBars() {
  const counts = [...countBy(state.filtered, c => c.division).entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, 10);

  if (!counts.length) {
    els.divisionBars.innerHTML = `<div class="empty-state" style="min-height:160px;padding:20px">No activity to chart.</div>`;
    return;
  }

  const max = counts[0][1];
  els.divisionBars.innerHTML = counts.map(([division, count]) => `
    <div class="bar-item">
      <span class="bar-label">${division}</span>
      <div class="bar-track"><div class="bar-fill" style="width:${Math.max(4, (count / max) * 100)}%"></div></div>
      <span class="bar-count">${count}</span>
    </div>
  `).join("");
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

function formatDate(date) {
  return new Intl.DateTimeFormat("en-CA", {
    month: "short",
    day: "numeric",
    timeZone: "America/Toronto"
  }).format(date);
}

function relativeTime(date) {
  const diffMs = Date.now() - date.getTime();
  const minutes = Math.max(0, Math.floor(diffMs / 60_000));
  if (minutes < 1) return "now";
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  return `${Math.floor(hours / 24)}d ago`;
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
  await loadData({ silent: true });
}

document.querySelector('#historyHours').addEventListener('change', event => {
  state.hours = Number(event.target.value);
  applyFilters();
});

els.divisionSelect.addEventListener("change", (e) => {
  state.division = e.target.value === "all" ? "all" : decodeURIComponent(e.target.value);
  applyFilters();
});

els.searchInput.addEventListener("input", (e) => {
  state.search = e.target.value;
  applyFilters();
});

els.eventToggles.forEach(toggle => {
  toggle.addEventListener("click", () => {
    state.eventFilter = toggle.dataset.eventFilter;
    applyFilters();
  });
});

els.callList.addEventListener("click", (event) => {
  const row = event.target.closest(".call-row");
  if (row) selectCall(row.dataset.callId);
});

els.callList.addEventListener("keydown", (event) => {
  if (event.key !== "Enter" && event.key !== " ") return;
  const row = event.target.closest(".call-row");
  if (!row) return;
  event.preventDefault();
  selectCall(row.dataset.callId);
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

refreshLoop();

document.querySelector("#serviceFilter").addEventListener("change", event => {
  state.serviceFilter = event.target.value;
  applyFilters();
});

const nearButton = document.querySelector('#nearMe');
const nearStatus = document.querySelector('#nearStatus');
const nearControls = document.querySelector('#nearControls');
let locationRequest = 0;
function updateNearbyView() {
  mapHasFitted = false;
  applyFilters();
  if (dispatchMap && state.nearby) dispatchMap.setView(state.nearby, state.radiusKm <= 2 ? 14 : 12);
  nearStatus.textContent = `Within ${state.radiusKm} km of your location. Other filters still apply. Distances use approximate call locations; unmapped calls are excluded.`;
}
nearButton.addEventListener('click', () => {
  if (!navigator.geolocation) {
    nearStatus.textContent = 'Location is unavailable in this browser. You can search by street or neighbourhood instead.';
    return;
  }
  const request = ++locationRequest;
  nearButton.disabled = true;
  nearButton.textContent = 'Finding your location…';
  nearStatus.textContent = 'Allow location access when your browser asks.';
  navigator.geolocation.getCurrentPosition(position => {
    if (request !== locationRequest) return;
    state.nearby = [position.coords.latitude, position.coords.longitude];
    nearButton.disabled = false;
    nearButton.textContent = 'Update my location';
    nearControls.hidden = false;
    updateNearbyView();
  }, error => {
    if (request !== locationRequest) return;
    nearButton.disabled = false;
    nearButton.textContent = state.nearby ? 'Update my location' : 'Calls near me';
    nearStatus.textContent = (error.code === 1 ? 'Location permission was denied.' : 'Could not get your location. Please try again.') + (state.nearby ? ' Your previous nearby filter remains active.' : ' You can search by street or neighbourhood instead.');
  }, { enableHighAccuracy: false, timeout: 10000, maximumAge: 60000 });
});
document.querySelector('#nearRadius').addEventListener('change', event => {
  state.radiusKm = Number(event.target.value);
  if (state.nearby) updateNearbyView();
});
document.querySelector('#clearNearby').addEventListener('click', () => {
  locationRequest++;
  state.nearby = null;
  nearButton.disabled = false;
  nearButton.textContent = 'Calls near me';
  nearControls.hidden = true;
  nearStatus.textContent = 'Uses your location with permission. Your location stays in this browser session.';
  mapHasFitted = false;
  applyFilters();
});

setInterval(() => {
  document.querySelectorAll('[data-reported-at]').forEach(label => {
    label.textContent = reportedAge(label.dataset.reportedAt);
  });
}, 60000);
