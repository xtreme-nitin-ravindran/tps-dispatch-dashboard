// Own one pane/group and stable line pairs. No pan/zoom listeners or map rebuilds.
export function createTtcLayer(map, leaflet, onSelect) {
  const pane = map.getPane('ttcDisruptionPane') || map.createPane('ttcDisruptionPane');
  pane.style.zIndex = '440'; // Below roads (450), emergency markers/clusters, and location.
  const group = leaflet.layerGroup().addTo(map), entries = new Map();
  let selected = null, visible = true;
  function style(entry) {
    entry.line.setStyle({weight:entry.item.id === selected ? 7 : 4,opacity:entry.item.id === selected ? 1 : .85});
  }
  return {
    update(items) {
      const next = new Set();
      for (const item of items) for (const part of [...item.scheduled,...item.diversions]) {
        const id = JSON.stringify([item.id,part.kind,part.id]); next.add(id);
        let entry = entries.get(id);
        const key = JSON.stringify(part.geometry);
        if (!entry) {
          const points = part.geometry.map(([lng,lat]) => [lat,lng]);
          const options = {pane:'ttcDisruptionPane',smoothFactor:1};
          const line = leaflet.polyline(points,{...options,interactive:false,className:`ttc-line ttc-line--${part.kind}`,dashArray:part.kind === 'scheduled' ? '8 7' : undefined}).addTo(group);
          const hit = leaflet.polyline(points,{...options,weight:24,opacity:0,className:'ttc-hit'}).addTo(group);
          entry = {item,part,line,hit,key};
          hit.on('click',() => onSelect(entry.item,entry.hit));
          entries.set(id,entry);
        } else if (entry.key !== key) {
          const points = part.geometry.map(([lng,lat]) => [lat,lng]);
          entry.line.setLatLngs(points); entry.hit.setLatLngs(points); entry.key = key;
        }
        entry.item = item; entry.part = part; style(entry);
      }
      for (const [id,entry] of entries) if (!next.has(id)) {
        group.removeLayer(entry.line); group.removeLayer(entry.hit); entry.hit.off(); entries.delete(id);
      }
      if (!items.some(i => i.id === selected)) selected = null;
    },
    select(id) { selected = id; for (const entry of entries.values()) style(entry); },
    reveal(id,options={}) {
      const points = [...entries.values()].filter(e => e.item.id === id).flatMap(e => e.part.geometry.map(([lng,lat]) => [lat,lng]));
      if (points.length) map.fitBounds(points,{padding:[40,40],maxZoom:15,animate:false,...options});
    },
    visibility(show) { visible = show; pane.style.display=show ? '' : 'none'; },
    diagnostics() { return {parts:entries.size,layers:entries.size*2,selected,visible}; },
    destroy() { for (const e of entries.values()) e.hit.off(); group.clearLayers(); group.remove(); entries.clear(); }
  };
}
