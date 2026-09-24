import { relativeUpdateAge } from './source-status.js?v=source-states-1';

export function refreshFreshnessLabel(lastSuccessfulAt, now = Date.now()) {
  return lastSuccessfulAt === null ? '' : `Updated ${relativeUpdateAge(lastSuccessfulAt, now)}`;
}

export function createRefreshFreshnessTracker({ onChange, now = Date.now, schedule = setInterval, cancel = clearInterval }) {
  let lastSuccessfulAt = null;

  function render() {
    onChange(refreshFreshnessLabel(lastSuccessfulAt, now()));
  }

  const timer = schedule(render, 1000);
  return {
    complete(successful) {
      if (successful) lastSuccessfulAt = now();
      render();
    },
    get lastSuccessfulAt() {
      return lastSuccessfulAt;
    },
    destroy() {
      cancel(timer);
    }
  };
}
