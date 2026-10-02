export function historyWindowLabel(hours) {
  if (hours === 168) return "Last 7 days";
  if (hours === 72) return "Last 3 days";
  return `Last ${hours}h`;
}
