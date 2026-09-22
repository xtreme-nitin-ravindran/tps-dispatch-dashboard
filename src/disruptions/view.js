import { distanceKm } from '../nearby.js';
export function currentDisruptions(feed, kind, now = Date.now()) {
  const fetched = Date.parse(feed?.fetchedAt);
  if (!Number.isFinite(fetched) || now - fetched > 3600000 || fetched > now + 300000) return [];
  return (feed.items || []).filter(item => kind === 'roads'
    ? !item.expired && (item.start == null || item.start <= now) && (item.end == null || item.end > now) && item.impact.toLowerCase() !== 'none'
    : !item.periods.length || item.periods.some(p => (p.start == null || p.start <= now) && (p.end == null || p.end > now)));
}
// Distance to the nearest point on the published road segment (local equirectangular projection).
export function roadDistance(item, origin) {
  if (!origin) return Infinity;
  let distance = distanceKm(origin, item.coordinates);
  const line = item.line || [];
  const project = p => [(p[1]-origin[1])*111.195*Math.cos(origin[0]*Math.PI/180),(p[0]-origin[0])*111.195];
  for (let i=1;i<line.length;i++) {
    const a=project(line[i-1]), b=project(line[i]);
    const dx=b[0]-a[0],dy=b[1]-a[1],den=dx*dx+dy*dy;
    const t=den ? Math.max(0,Math.min(1,-(a[0]*dx+a[1]*dy)/den)) : 0;
    distance=Math.min(distance,Math.hypot(a[0]+t*dx,a[1]+t*dy));
  }
  return distance;
}
