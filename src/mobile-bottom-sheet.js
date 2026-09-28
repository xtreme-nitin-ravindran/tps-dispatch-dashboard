export const MOBILE_SHEET_STATES = ["collapsed", "half", "expanded"];

export function nextMobileSheetState(current, direction = 1) {
  const index = MOBILE_SHEET_STATES.indexOf(current);
  const safeIndex = index === -1 ? 0 : index;
  return MOBILE_SHEET_STATES[Math.max(0, Math.min(MOBILE_SHEET_STATES.length - 1, safeIndex + direction))];
}

export function mobileSheetStateAfterDrag(current, deltaY, threshold = 40) {
  if (deltaY <= -threshold) return nextMobileSheetState(current, 1);
  if (deltaY >= threshold) return nextMobileSheetState(current, -1);
  return current;
}

export function mobileSheetActionLabel(state) {
  if (state === "collapsed") return "Expand nearby calls sheet to half height";
  if (state === "half") return "Expand nearby calls sheet to full height";
  return "Collapse nearby calls sheet";
}

export function mobileMapSheetOverlap(mapRect, sheetRect, active = true) {
  if (!active || !mapRect || !sheetRect) return 0;
  const overlap = Number(mapRect.bottom) - Number(sheetRect.top);
  return Number.isFinite(overlap) ? Math.max(0, Math.min(Number(mapRect.height) || 0, overlap)) : 0;
}
