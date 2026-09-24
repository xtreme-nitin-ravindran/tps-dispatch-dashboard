export function markerAgeTier(timestamp, now = Date.now()) {
  const reportedAt = timestamp instanceof Date ? timestamp.getTime() : new Date(timestamp).getTime();
  if (!Number.isFinite(reportedAt)) return "unknown";

  const ageMinutes = Math.max(0, now - reportedAt) / 60_000;
  if (ageMinutes < 10) return "recent";
  if (ageMinutes < 30) return "current";
  if (ageMinutes < 60) return "aging";
  return "old";
}

export function markerAgeLabel(tier) {
  return ({
    recent: "reported less than 10 minutes ago",
    current: "reported 10 to 30 minutes ago",
    aging: "reported 30 to 60 minutes ago",
    old: "reported at least 60 minutes ago",
    unknown: "report time unavailable"
  })[tier] || "report time unavailable";
}

export function markerGlyph(source, category) {
  if (category === "medical") return "+";
  if (category === "fire") return "F";
  return source === "TPS" ? "P" : "T";
}
