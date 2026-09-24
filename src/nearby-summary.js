const CATEGORY_ORDER = ["Fire", "Medical", "Police", "Other"];

function summaryCategory(call) {
  if (call.source === "TPS") return "Police";
  if (call.eventCategory === "fire") return "Fire";
  if (call.eventCategory === "medical") return "Medical";
  return "Other";
}

function compactAge(timestamp, now) {
  const elapsedMinutes = Math.floor(Math.max(0, now - new Date(timestamp).getTime()) / 60_000);
  if (elapsedMinutes < 1) return "just now";
  if (elapsedMinutes < 60) return `${elapsedMinutes} min ago`;
  const hours = Math.floor(elapsedMinutes / 60);
  if (hours < 24) return `${hours} hr ago`;
  const days = Math.floor(hours / 24);
  return `${days} day${days === 1 ? "" : "s"} ago`;
}

export function nearbySummary(calls, radiusKm, now = Date.now()) {
  const noun = calls.length === 1 ? "call" : "calls";
  const opening = `${calls.length} recent ${noun} within ${radiusKm} km`;
  if (!calls.length) return `${opening}.`;

  const counts = new Map();
  for (const call of calls) {
    const category = summaryCategory(call);
    counts.set(category, (counts.get(category) || 0) + 1);
  }
  const breakdown = CATEGORY_ORDER
    .filter(category => counts.has(category))
    .map(category => `${counts.get(category)} ${category}`)
    .join(" · ");
  const newest = Math.max(...calls.map(call => new Date(call.timestamp).getTime()));
  return `${opening} · ${breakdown} · Latest ${compactAge(newest, now)}.`;
}
