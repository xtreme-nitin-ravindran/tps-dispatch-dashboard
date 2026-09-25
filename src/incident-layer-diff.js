export function reconcileIncidentLayers(current, desiredKeys) {
  const desired = new Set(desiredKeys);
  return {
    remove: [...current.keys()].filter(key => !desired.has(key)),
    add: desiredKeys.filter(key => !current.has(key)),
    keep: desiredKeys.filter(key => current.has(key))
  };
}

export function incidentGroupKey(group, expanded = false, version = "") {
  const ids = group.map(item => item.call.id).sort().join("|");
  return `${expanded ? "expanded" : group.length === 1 ? "marker" : "cluster"}:${ids}:${version}`;
}
