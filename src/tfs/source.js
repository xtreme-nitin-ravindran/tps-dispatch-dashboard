import { parseTfsTimestamp } from "./time.js";

export const TFS_LIVE_XML_URL = "https://www.toronto.ca/data/fire/livecad.xml";

export async function fetchTfsSource({ fetchImpl = fetch, signal } = {}) {
    const response = await fetchImpl(TFS_LIVE_XML_URL, { signal });
    if (!response.ok) {
        throw new Error(`TFS source returned HTTP ${response.status}`);
    }

    return parseTfsXml(await response.text());
}

// Fixed reason keys for per-event rejection; never derived from upstream text.
export const TFS_REJECTION_REASONS = Object.freeze(["missing_id", "invalid_timestamp"]);
export function parseTfsXml(xml) {
    const root = matchTag(xml, "tfs_active_incidents");
    const updatedAt = text(matchTag(root, "update_from_db_time"));
    const rejected = Object.fromEntries(TFS_REJECTION_REASONS.map(reason => [reason, 0]));
    const incidents = [];
    for (const match of root.matchAll(/<event>([\s\S]*?)<\/event>/gi)) {
        const event = parseEvent(match[1]);
        // A malformed event is skipped with a bounded reason so valid siblings are
        // never discarded. An id or timestamp is never synthesized from other fields.
        if (!event.event_id) { rejected.missing_id++; continue; }
        if (!parseTfsTimestamp(event.time)) { rejected.invalid_timestamp++; continue; }
        incidents.push(event);
    }
    const rejectedCount = TFS_REJECTION_REASONS.reduce((total, reason) => total + rejected[reason], 0);
    return { updatedAt, incidents, rejected: rejectedCount, rejectedReasons: rejected };
}

function parseEvent(xml) {
    const event = {
        event_id: text(matchTag(xml, "event_num")),
        time: text(matchTag(xml, "dispatch_time")),
        description: text(matchTag(xml, "event_type")),
        location: [text(matchTag(xml, "prime_street")), text(matchTag(xml, "cross_streets"))]
            .filter(Boolean)
            .join(" / "),
        beat: text(matchTag(xml, "beat")),
        alarm_level: text(matchTag(xml, "alarm_lev")),
        units: text(matchTag(xml, "units_disp")),
        event_type: "fire",
        cad: 1
    };

    return event;
}

function matchTag(xml, tag) {
    return xml.match(new RegExp(`<${tag}>([\\s\\S]*?)</${tag}>`, "i"))?.[1] || "";
}

function text(value) {
    return decodeXml(value).replace(/\s+/g, " ").trim();
}

function decodeXml(value) {
    return value
        .replace(/&#x([0-9a-f]+);/gi, (_, code) => String.fromCodePoint(parseInt(code, 16)))
        .replace(/&#(\d+);/g, (_, code) => String.fromCodePoint(Number(code)))
        .replace(/&amp;/g, "&")
        .replace(/&lt;/g, "<")
        .replace(/&gt;/g, ">")
        .replace(/&quot;/g, '"')
        .replace(/&apos;/g, "'");
}
