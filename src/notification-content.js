const SOURCE_NAMES = Object.freeze({
  TFS: 'Toronto Fire Services',
  TPS: 'Toronto Police Service'
});

function clean(value) {
  return String(value ?? '').replace(/\s+/g, ' ').trim();
}

function distanceText(value) {
  return Number.isFinite(value) && value >= 0 ? `${value.toFixed(1)} km away` : '';
}

export function formatNotificationContent(candidate) {
  const updated = String(candidate?.notificationKind || '').startsWith('updated:');
  const incident = candidate?.incident || {};
  const source = SOURCE_NAMES[incident.source] || '';
  const fallback = source ? `${source} incident` : 'Incident';
  const description = clean(incident.description) || fallback;
  const suffix = [distanceText(incident.distanceKm), source].filter(Boolean);
  const suffixText = suffix.length ? ` · ${suffix.join(' · ')}` : '';
  const available = Math.max(1, 180 - suffixText.length);
  const shortened = description.length <= available
    ? description
    : `${description.slice(0, Math.max(1, available - 1)).trimEnd()}…`;
  return {
    title: updated ? 'SirenTO — Incident update nearby' : 'SirenTO — New incident nearby',
    body: `${shortened}${suffixText}`
  };
}
