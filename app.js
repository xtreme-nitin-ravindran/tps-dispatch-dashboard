import { policeDivision } from "./src/police-divisions.js";
import { isWithinHistoryWindow } from "./src/tfs/time.js";

const CONFIG = {
  snapshotUrl: "./data/current.json",
  refreshCheckMs: 30_000
};

const state = {
  hours: 24,
  calls: [],
  filtered: [],
  lastIngest: null,
  fetchedAt: null,
  search: "",
  division: "all",
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
const TORONTO_BOUNDS = [[43.58, -79.65], [43.86, -79.12]];
const GEOCODE_LIMIT = 12;
const geocodeCache = loadGeocodeCache();
let policeBoundaries = null;
let dispatchMap = null;
let mapMarkers = new Map();
let mapRenderToken = 0;
let focusedCallId = null;

function escapeText(value) {
  return String(value ?? "").replace(/\s+/g, " ").trim();
}

function normalizeCall(row) {
  const eventType = escapeText(row.event_type || row.eventType).toLowerCase();
  const description = escapeText(row.description || "Call for Service");
  const eventCategory = eventType === "fire"
    ? (/\bmedical\b/i.test(description) ? "medical" : "fire")
    : "other";
  const isFireRelated = eventType === "fire" && !/\bmedical\b/i.test(description);
  const rawTimestamp = row.timestamp ?? row.time_unix;
  const unix = Number(rawTimestamp);
  const date = Number.isFinite(unix) && unix > 0
    ? new Date(unix * (unix < 10_000_000_000 ? 1000 : 1))
    : parseLooseTime(rawTimestamp) || parseLooseTime(row.time);

  return {
    id: escapeText(row.id || row.event_id || "—"),
    timestamp: date?.getTime() || Date.now(),
    time: date || new Date(),
    division: "Unknown",
    divisionId: "Unknown",
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
    fetchedAt: payload.fetchedAt || null,
    updatedAt: payload.sourceUpdatedAt || payload.fetchedAt || null
  };
}

let sourceHighlightTimer;

async function loadData({ silent = false } = {}) {

  try {
    const snapshot = await fetchSnapshot();
    const previousSourceTime = parseLooseTime(state.lastIngest)?.getTime();
    state.calls = snapshot.calls;
    assignPoliceDivisions();
    state.lastIngest = snapshot.updatedAt;
    state.fetchedAt = snapshot.fetchedAt;
    const sourceTime = parseLooseTime(snapshot.updatedAt);
    els.sourceUpdated.textContent = sourceTime
      ? `${formatDate(sourceTime)} · ${formatTime(sourceTime)} Toronto`
      : "Unknown";
    populateDivisionFilter();
    applyFilters();
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

function assignPoliceDivisions() {
  for (const call of state.calls) {
    call.division = policeDivision(call.location, coordinatesForCall(call), policeBoundaries);
    call.divisionId = call.division;
  }
}

function populateDivisionFilter() {
  const current = state.division;
  const divisions = [...new Set(state.calls.map(c => c.division).filter(Boolean))]
    .sort((a, b) => a.localeCompare(b, undefined, { numeric: true }));

  els.divisionSelect.innerHTML = `<option value="all">All police divisions</option>` +
    divisions.map(d => `<option value="${encodeURIComponent(d)}">${d}</option>`).join("");

  const exists = divisions.includes(current);
  state.division = exists ? current : "all";
  els.divisionSelect.value = state.division === "all" ? "all" : encodeURIComponent(state.division);
}

function applyFilters({ map = true } = {}) {
  const q = state.search.trim().toLowerCase();

  state.filtered = state.calls.filter(call => {
    if (!isWithinHistoryWindow(call.timestamp, state.hours)) return false;
    const divisionMatch = state.division === "all" || call.division === state.division;
    if (!divisionMatch) return false;
    if (state.eventFilter === "ongoing" && !call.isOngoing) return false;
    if (state.eventFilter !== "all" && state.eventFilter !== "ongoing" && call.eventCategory !== state.eventFilter) return false;
    if (!q) return true;

    return [
      call.description,
      call.location,
      call.division,
      call.divisionId,
      call.id,
      call.keyword
    ].some(v => v.toLowerCase().includes(q));
  });

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
    row.tabIndex = 0;
    row.setAttribute("role", "button");
    row.setAttribute("aria-label", `${call.description} at ${call.location}`);
    node.querySelector(".time-main").textContent = formatTime(call.time);
    node.querySelector(".time-ago").textContent = relativeTime(call.time);
    node.querySelector(".call-title").textContent = call.description;
    node.querySelector(".ongoing-badge").hidden = !call.isOngoing;
    node.querySelector(".division-badge").textContent = call.division;
    node.querySelector(".call-location").textContent = call.location;
    const alarm = node.querySelector(".call-alarm");
    const alarmValue = node.querySelector(".alarm-value");
    const units = node.querySelector(".unit-list");
    const unitNote = node.querySelector(".unit-note");
    if (call.isFireRelated && call.alarmLevel) {
      alarm.hidden = false;
      alarmValue.textContent = call.alarmLevel;
    }
    units.innerHTML = call.unitGroups.length
      ? call.unitGroups.map(group => `<div><strong>${escapeText(group.type)} #:</strong> ${escapeText(group.values)}</div>`).join("")
      : "Not provided by public feed";
    unitNote.hidden = !call.unitGroups.length;
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
}

function loadGeocodeCache() {
  try {
    return new Map(Object.entries(JSON.parse(localStorage.getItem("torontoDispatchGeocodes") || "{}")));
  } catch {
    return new Map();
  }
}

function saveGeocodeCache() {
  localStorage.setItem("torontoDispatchGeocodes", JSON.stringify(Object.fromEntries(geocodeCache)));
}

function coordinatesForCall(call) {
  if (call.latitude !== null && call.longitude !== null &&
    call.latitude >= 43.58 && call.latitude <= 43.86 &&
    call.longitude >= -79.65 && call.longitude <= -79.12) {
    return [call.latitude, call.longitude];
  }

  const cached = geocodeCache.get(call.location);
  return cached ? [cached.latitude, cached.longitude] : null;
}

async function geocodeLocation(location) {
  if (geocodeCache.has(location)) return geocodeCache.get(location);

  try {
    const normalized = location
      .replace(/\bSt E\b/g, "Street East")
      .replace(/\bSt W\b/g, "Street West")
      .replace(/\bLn E\b/g, "Lane East")
      .replace(/\bLn W\b/g, "Lane West");
    const queries = [...new Set([
      location,
      normalized,
      normalized.replace(/\s*\/\s*/g, " and ")
    ])];

    for (const query of queries) {
      const url = `https://photon.komoot.io/api/?limit=1&q=${encodeURIComponent(`${query}, Toronto, Ontario`)}`;
      const response = await fetch(url);
      if (!response.ok) continue;
      const payload = await response.json();
      const result = payload.features?.[0];
      const [longitude, latitude] = result?.geometry?.coordinates || [];
      const coordinates = { latitude: Number(latitude), longitude: Number(longitude) };
      if (Number.isFinite(coordinates.latitude) && Number.isFinite(coordinates.longitude) &&
        coordinates.latitude >= 43.58 && coordinates.latitude <= 43.86 &&
        coordinates.longitude >= -79.65 && coordinates.longitude <= -79.12) {
        geocodeCache.set(location, coordinates);
        saveGeocodeCache();
        assignPoliceDivisions();
        populateDivisionFilter();
        applyFilters({ map: false });
        return coordinates;
      }
    }
  } catch {
    return null;
  }

  return null;
}

function markerIcon(selected = false) {
  return L.divIcon({
    className: "dispatch-marker-wrap",
    html: `<span class="dispatch-marker${selected ? " selected" : ""}"></span>`,
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
    const marker = L.marker(coordinates, { icon: markerIcon(false) })
      .bindTooltip(`<strong>${escapeText(call.description)}</strong><br>${escapeText(call.location)}`, { direction: "top" })
      .on("click", () => selectCall(call.id, { pan: false }));
    marker.addTo(dispatchMap);
    mapMarkers.set(call.id, marker);
  });

  els.mapStatus.textContent = locatedCalls.length ? `${locatedCalls.length}/${state.filtered.length} LOCATED` : "LOCATING...";
  els.mapEmpty.hidden = locatedCalls.length > 0;
  if (locatedCalls.length && !focusedCallId) {
    dispatchMap.fitBounds(L.latLngBounds(locatedCalls.map(item => item.coordinates)), { padding: [24, 24], maxZoom: 12 });
  }
}

async function geocodeVisibleCalls(token) {
  const candidates = state.filtered
    .filter(call => !coordinatesForCall(call))
    .slice(0, GEOCODE_LIMIT);

  for (const call of candidates) {
    await geocodeLocation(call.location);
    if (token !== mapRenderToken) return;
    renderMapMarkers();
    await new Promise(resolve => setTimeout(resolve, 1100));
  }

  if (token === mapRenderToken && !mapMarkers.size) {
    els.mapStatus.textContent = "NO MATCHING LOCATIONS";
    els.mapEmpty.querySelector("strong").textContent = "Map locations unavailable";
    els.mapEmpty.querySelector("span").textContent = "The feed locations could not be matched to Toronto coordinates.";
  }
}

function renderMap() {
  initMap();
  if (!dispatchMap) return;

  mapRenderToken += 1;
  focusedCallId = null;
  renderMapMarkers();
  els.mapEmpty.querySelector("strong").textContent = "Locating calls...";
  els.mapEmpty.querySelector("span").textContent = "Street descriptions are being matched to Toronto map locations.";
  geocodeVisibleCalls(mapRenderToken);
}

async function selectCall(callId, { pan = true } = {}) {
  const call = state.filtered.find(item => item.id === callId);
  if (!call) return;

  focusedCallId = callId;

  document.querySelectorAll(".call-row").forEach(row => {
    row.classList.toggle("selected", row.dataset.callId === callId);
  });

  if (!mapMarkers.has(callId) && !coordinatesForCall(call)) {
    await geocodeLocation(call.location);
    renderMapMarkers();
  }

  mapMarkers.forEach((marker, id) => marker.setIcon(markerIcon(id === callId)));
  const marker = mapMarkers.get(callId);
  if (marker) {
    if (pan) {
      dispatchMap.stop();
      dispatchMap.setView(marker.getLatLng(), 17, { animate: false });
    } else {
      dispatchMap.panTo(marker.getLatLng());
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

fetch("./data/police-divisions.geojson")
  .then(response => { if (!response.ok) throw new Error("Police boundaries unavailable"); return response.json(); })
  .then(boundaries => {
    policeBoundaries = boundaries;
    assignPoliceDivisions();
    populateDivisionFilter();
    applyFilters();
  })
  .catch(error => console.warn(error));
refreshLoop();
