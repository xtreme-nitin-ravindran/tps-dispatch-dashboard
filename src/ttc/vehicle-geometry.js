// Same local equirectangular metric as Story 30C; longitude scaled at latitude.
// Precompute segments once per static shape, not once per vehicle or route.
export function compileShape(shape) {
  if (!shape || shape.length < 2) return null;
  const latitude = shape.reduce((n,p)=>n+p[1],0)/shape.length;
  const sx = 111320 * Math.cos(latitude*Math.PI/180), sy = 111320;
  const origin = shape[0];
  let length = 0;
  const segments = shape.slice(1).map((b,i)=>{
    const a = shape[i], x = (a[2]-origin[2])*sx, y = (a[1]-origin[1])*sy;
    const dx = (b[2]-a[2])*sx, dy = (b[1]-a[1])*sy, size = Math.hypot(dx,dy);
    const s = {x,y,dx,dy,size,offset:length,index:i,minX:Math.min(x,x+dx),maxX:Math.max(x,x+dx),minY:Math.min(y,y+dy),maxY:Math.max(y,y+dy)};
    length += size; return s;
  });
  return length ? {sx,sy,origin,segments,length} : null;
}
export function projectVehicle(o, geometry) {
  if (!geometry) return null;
  const {sx,sy,origin,segments,length} = geometry;
  const x = (o.longitude-origin[2])*sx, y = (o.latitude-origin[1])*sy;
  let best = Infinity, chosen, ambiguous = false;
  for (const s of segments) {
    // Bounding-box lower bound skips distant segments, preserving a global minimum.
    if (Math.hypot(Math.max(s.minX-x,0,x-s.maxX),Math.max(s.minY-y,0,y-s.maxY))>best+5) continue;
    const t = s.size ? Math.max(0,Math.min(1,((x-s.x)*s.dx+(y-s.y)*s.dy)/(s.size*s.size))) : 0;
    const distance = Math.hypot(s.x+t*s.dx-x,s.y+t*s.dy-y), progress = s.offset+t*s.size;
    if (chosen && Math.abs(distance-best)<=5 && Math.abs(progress-chosen.progressMeters)>50) ambiguous = true;
    if (distance < best) {
      if (distance < best-5) ambiguous = false;
      best = distance;
      chosen = {distanceFromShapeMeters:distance,segmentIndex:s.index,segmentFraction:t,progressMeters:progress,projectedPoint:[origin[2]+(s.x+t*s.dx)/sx,origin[1]+(s.y+t*s.dy)/sy]};
    }
  }
  return {...chosen,projectionAmbiguous:ambiguous,endpointDistanceMeters:Math.min(Math.hypot(x,y),Math.hypot(x-(segments.at(-1).x+segments.at(-1).dx),y-(segments.at(-1).y+segments.at(-1).dy))),shapeLengthMeters:length};
}
export const geographicDistance = (a,b) => Math.hypot((a.latitude-b.latitude)*111320,(a.longitude-b.longitude)*111320*Math.cos((a.latitude+b.latitude)*Math.PI/360));
