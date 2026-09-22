// Fixed screen-space cells keep grouping predictable as the map zoom changes.
export function clusterPoints(items, project, cellSize = 64) {
  const cells = new Map();
  for (const item of items) {
    const point = project(item.coordinates);
    const key = `${Math.floor(point.x / cellSize)},${Math.floor(point.y / cellSize)}`;
    if (!cells.has(key)) cells.set(key, []);
    cells.get(key).push(item);
  }
  return [...cells.values()];
}
export function spreadPoint(index, count, center) {
  const angle = index * 2 * Math.PI / count;
  const radius = Math.max(35, count * 7);
  return { x:center.x + Math.cos(angle) * radius, y:center.y + Math.sin(angle) * radius };
}
