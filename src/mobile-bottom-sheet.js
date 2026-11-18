export function nextMobileSheetState(current) {
  return current === "open" ? "collapsed" : "open";
}

export function mobileSheetActionLabel(state) {
  return state === "open" ? "Close nearby calls sheet" : "Open nearby calls sheet";
}

export function mobileMapSheetOverlap(mapRect, sheetRect, active = true) {
  if (!active || !mapRect || !sheetRect) return 0;
  const overlap = Number(mapRect.bottom) - Number(sheetRect.top);
  return Number.isFinite(overlap) ? Math.max(0, Math.min(Number(mapRect.height) || 0, overlap)) : 0;
}
