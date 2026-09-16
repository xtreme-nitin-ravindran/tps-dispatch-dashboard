import { parseTfsTimestamp } from "./time.js";

const UNIT_TYPES = [
    ["Fire Invest.", "Fire Investigator"],
    ["Fire Investigator", "Fire Investigator"],
    ["Air Light", "Air/Light Unit"],
    ["Highrise", "High-Rise Unit"],
    ["Pumper", "Fire Truck"],
    ["Aerial", "Aerial Truck"],
    ["Rescue", "Rescue Truck"],
    ["Ladder", "Ladder Truck"],
    ["Tower", "Tower Truck"],
    ["Hazmat", "Hazmat Unit"],
    ["Cmd. unit", "Command Unit"],
    ["Command", "Command Unit"]
];

const UNIT_CODES = {
    A: "Aerial Truck",
    HZ: "Hazmat Unit",
    HR: "High-Rise Unit",
    L: "Ladder Truck",
    LA: "Ladder Truck",
    MP: "Mini Pumper",
    P: "Fire Truck",
    R: "Rescue Truck",
    S: "Squad Unit",
    T: "Tower Truck"
};

export function normalizeTfsIncident(row) {
    if (!row || typeof row !== "object") {
        throw new TypeError("TFS incident must be an object");
    }

    const timestamp = parseTfsTimestamp(row.time_unix ?? row.time ?? row.timestamp);
    return {
        id: String(row.event_id || "").trim(),
        source: "TFS",
        eventType: "fire",
        description: String(row.description || "Fire incident").trim(),
        location: String(row.location || "Location not published").trim(),
        division: String(row.beat || row.division || "Unknown").trim(),
        timestamp,
        alarmLevel: numberOrNull(row.alarm_level),
        isOngoing: typeof row.isOngoing === "boolean" ? row.isOngoing : Number(row.cad) === 1,
        vehicles: parseDispatchedUnits(row.units)
    };
}

export function parseDispatchedUnits(units) {
    if (!units) return [];

    const grouped = new Map();
    let currentType = "Other Unit";
    for (const rawUnit of String(units).split(",")) {
        const unit = rawUnit.trim();
        if (!unit) continue;

        const match = UNIT_TYPES.find(([sourceType]) =>
            new RegExp(`^${escapeRegExp(sourceType)}\\s*[- ]?\\s*(.*)$`, "i").test(unit)
        );
        const compact = unit.replace(/[\s.-]+/g, "");

        if (match) {
            const value = unit.match(new RegExp(`^${escapeRegExp(match[0])}\\s*[- ]?\\s*(.*)$`, "i"))?.[1];
            currentType = match[1];
            add(grouped, currentType, value);
        } else {
            const codeMatch = unit.match(/^(CMD|[A-Z]{1,2})(\d+)$/i);
            const code = codeMatch?.[1]?.toUpperCase();
            if (code === "CMD" || code === "C") {
                currentType = "Command Unit";
                add(grouped, currentType, codeMatch[2]);
            } else if (code && UNIT_CODES[code]) {
                currentType = UNIT_CODES[code];
                add(grouped, currentType, codeMatch[2]);
            } else if (/^\d+$/.test(unit) && currentType !== "Other Unit") {
                add(grouped, currentType, unit);
            } else if (/^REHAB\d*$/i.test(compact)) {
                currentType = "Rehab Unit";
                add(grouped, currentType, compact.slice(5) || "unit");
            } else {
                currentType = "Other Unit";
                add(grouped, currentType, unit);
            }
            continue;
        }
    }

    return [...grouped.entries()].map(([type, numbers]) => ({ type, numbers }));
}

function add(grouped, type, value) {
    if (!value) return;
    if (!grouped.has(type)) grouped.set(type, []);
    grouped.get(type).push(value.trim());
}

function numberOrNull(value) {
    const number = Number(value);
    return Number.isFinite(number) ? number : null;
}

function escapeRegExp(value) {
    return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
