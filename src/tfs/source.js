export const TFS_LIVE_XML_URL = "https://www.toronto.ca/data/fire/livecad.xml";

export async function fetchTfsSource({ fetchImpl = fetch, signal } = {}) {
    const response = await fetchImpl(TFS_LIVE_XML_URL, { signal });
    if (!response.ok) {
        throw new Error(`TFS source returned HTTP ${response.status}`);
    }

    return parseTfsXml(await response.text());
}

export function parseTfsXml(xml) {
    const root = matchTag(xml, "tfs_active_incidents");
    const updatedAt = text(matchTag(root, "update_from_db_time"));
    const incidents = [...root.matchAll(/<event>([\s\S]*?)<\/event>/gi)]
        .map(match => parseEvent(match[1]))
        .filter(event => event.event_id);

    return { updatedAt, incidents };
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
