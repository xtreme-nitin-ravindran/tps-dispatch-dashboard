export function offlineStatus({ online, hasPreviouslyLoadedData, lastSuccessfulUpdate }) {
  if (online) return { hidden: true, text: '' };

  let text = "You’re offline. Live incident data is unavailable.";
  if (hasPreviouslyLoadedData) {
    text += ' Previously loaded incident data remains visible and may be stale.';
  }
  if (lastSuccessfulUpdate) {
    text += ` Last successful update: ${lastSuccessfulUpdate}.`;
  }
  return { hidden: false, text };
}
