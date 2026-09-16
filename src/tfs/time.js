// TFS publishes wall-clock times in America/Toronto without a UTC offset.
const toronto = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'America/Toronto', year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', second: '2-digit', hourCycle: 'h23'
});

export function parseTfsTimestamp(value) {
    if (value === null || value === undefined || value === '') return null;
    const unix = Number(value);
    if (Number.isFinite(unix) && unix > 0) return new Date(unix * 1000).toISOString();
    const raw = String(value).trim();
    const local = raw.match(/^(\d{4})-(\d{2})-(\d{2})[T ](\d{2}):(\d{2}):(\d{2})$/);
    if (local) {
        const [, y, m, d, h, min, sec] = local;
        const wall = Date.UTC(+y, +m - 1, +d, +h, +min, +sec);
        // Validate against the named zone, including DST transitions. When the
        // fall-back hour repeats, prefer its first occurrence (the feed is ambiguous).
        for (const hours of [4, 5]) {
            const candidate = new Date(wall + hours * 3600000);
            const parts = Object.fromEntries(toronto.formatToParts(candidate).map(p => [p.type, p.value]));
            if (`${parts.year}-${parts.month}-${parts.day}T${parts.hour}:${parts.minute}:${parts.second}` === raw.replace(' ', 'T')) {
                return candidate.toISOString();
            }
        }
        return null;
    }
    if (!/(Z|[+-]\d{2}:?\d{2})$/i.test(raw)) return null;
    const parsed = new Date(raw);
    return Number.isNaN(parsed.getTime()) ? null : parsed.toISOString();
}

export function snapshotIsStale(sourceUpdatedAt, fetchedAt, now = Date.now()) {
    return [sourceUpdatedAt, fetchedAt].some(value => {
        const timestamp = parseTfsTimestamp(value);
        return !timestamp || now - Date.parse(timestamp) > 15 * 60 * 1000;
    });
}

export function isWithinHistoryWindow(timestamp, hours, now = Date.now()) {
    const time = typeof timestamp === 'number' ? timestamp : Date.parse(timestamp);
    return Number.isFinite(time) && time >= now - hours * 3600000 && time <= now;
}

export function nextFeedRefresh(fetchedAt) {
    const time = Date.parse(fetchedAt);
    if (!Number.isFinite(time)) return null;
    const interval = 15 * 60 * 1000;
    return new Date((Math.floor(time / interval) + 1) * interval);
}
