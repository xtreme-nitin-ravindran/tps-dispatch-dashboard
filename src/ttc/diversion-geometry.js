import { geographicDistance } from './vehicle-geometry.js';

export const coordinate = p => [p.longitude,p.latitude];
const point = p => ({longitude:p[0],latitude:p[1]});
export const distance = (a,b) => geographicDistance(point(a),point(b));
function segmentDistance(p,a,b) {
  const sx=111320*Math.cos(p[1]*Math.PI/180), sy=111320;
  const dx=(b[0]-a[0])*sx,dy=(b[1]-a[1])*sy;
  const t=dx*dx+dy*dy ? Math.max(0,Math.min(1,((p[0]-a[0])*sx*dx+(p[1]-a[1])*sy*dy)/(dx*dx+dy*dy))) : 0;
  return distance(p,[a[0]+t*(b[0]-a[0]),a[1]+t*(b[1]-a[1])]);
}
// Ramer–Douglas–Peucker, endpoints retained; tolerance is a maximum deviation,
// not a point-count target. Never increase tolerance to meet a payload limit.
export function simplifyGeometry(points,tolerance=8) {
  if (!Number.isFinite(tolerance)||tolerance<0||tolerance>20) throw new Error('Invalid simplification tolerance');
  if (points.length<3) return points;
  let max=tolerance,at=-1;
  for (let i=1;i<points.length-1;i++) {
    const d=segmentDistance(points[i],points[0],points.at(-1));
    if (d>max) { max=d; at=i; }
  }
  return at<0 ? [points[0],points.at(-1)] : [...simplifyGeometry(points.slice(0,at+1),tolerance).slice(0,-1),...simplifyGeometry(points.slice(at),tolerance)];
}
// Densification retains every observed vertex and removes dwell duplicates.
// Oversized paths are not compared, rather than coarsened across corners.
function dense(points) {
  const result=[points[0]];
  for (let i=1;i<points.length;i++) {
    const a=points[i-1],b=points[i],d=distance(a,b);
    if (d<1) continue;
    const n=Math.ceil(d/40);
    if (result.length+n>256) return null;
    for (let j=1;j<=n;j++) result.push([a[0]+(b[0]-a[0])*j/n,a[1]+(b[1]-a[1])*j/n]);
  }
  return result;
}
// Discrete Fréchet distance preserves travel order. Incomplete episodes may
// match a prefix, but must reach within 100 m of the other's observed endpoint.
export function corridorDistance(a,b,incompleteA=false,incompleteB=false) {
  let x=dense(a),y=dense(b);
  if (!x||!y) return Infinity;
  if (incompleteB&&!incompleteA) return corridorDistance(b,a,true,false);
  if (incompleteA&&incompleteB && pathLength(x)>pathLength(y)) [x,y]=[y,x];
  let row=new Float64Array(y.length).fill(Infinity);
  for (let i=0;i<x.length;i++) {
    const next=new Float64Array(y.length).fill(Infinity);
    for (let j=0;j<y.length;j++) next[j]=Math.max(distance(x[i],y[j]),i||j?Math.min(row[j],j?next[j-1]:Infinity,j?row[j-1]:Infinity):0);
    row=next;
  }
  return incompleteA ? Math.min(...row.filter((_,j)=>distance(x.at(-1),y[j])<=100)) : row.at(-1);
}
export function pathLength(p) { return p.slice(1).reduce((sum,v,i)=>sum+distance(p[i],v),0); }
export function scheduledSegment(shape,departure,rejoin) {
  if (!rejoin || rejoin.progressMeters<=departure.progressMeters) return null;
  return [departure.point,...shape.slice(departure.segmentIndex+1,rejoin.segmentIndex+1).map(p=>[p[2],p[1]]),rejoin.point];
}
