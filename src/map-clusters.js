export const MAX_EXPANDED_CLUSTER_SIZE = 12;

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
  const radius = Math.min(96, Math.max(35, count * 7));
  return { x:center.x + Math.cos(angle) * radius, y:center.y + Math.sin(angle) * radius };
}

export function canExpandCluster(group, maximum = MAX_EXPANDED_CLUSTER_SIZE) {
  return Array.isArray(group) && group.length > 1 && group.length <= maximum;
}
export function focusGroup(items, id, project) {
  return clusterPoints(items, project).find(group => group.some(item => item.call.id === id)) || [];
}
