// Own one pane/group and stable line pairs. No pan/zoom listeners or map rebuilds.
// Story 74: each line part also carries spaced clickable sign markers mirroring
// the road-closure symbols, so a TTC selection can anchor a map bubble.
import { closureSymbolPositions } from '../disruptions/ui.js';
export function createTtcLayer(map, leaflet, onSelect) {
  const pane = map.getPane('ttcDisruptionPane') || map.createPane('ttcDisruptionPane');
  pane.style.zIndex = '440'; // Below roads (450), emergency markers/clusters, and location.
  const group = leaflet.layerGroup().addTo(map), entries = new Map();
  let selected = null, visible = true;
  function style(entry) {
    entry.line.setStyle({weight:entry.item.id === selected ? 7 : 4,opacity:entry.item.id === selected ? 1 : .85});
  }
  const signIcon = () => leaflet.divIcon({className:'ttc-line-sign',html:'<span aria-hidden="true">\u{1F6A7}</span>',iconSize:[20,20],iconAnchor:[10,10]});
  const signPositions = part => closureSymbolPositions(part.geometry.map(([lng,lat]) => [lat,lng]), map);
  const nearestSign = (entry, latlng) => {
    if (!latlng) return null;
    let nearest = null, best = Infinity;
    for (const sign of entry.signs) {
      const d = (latlng.lat - sign.position[0]) ** 2 + (latlng.lng - sign.position[1]) ** 2;
      if (d < best) { best = d; nearest = sign; }
    }
    return nearest;
  };
  const createSigns = entry => {
    entry.signs = [];
    for (const position of signPositions(entry.part)) {
      const marker = leaflet.marker(position, {pane:'ttcDisruptionPane',icon:signIcon(),keyboard:true,title:`TTC disruption: ${entry.item.routes.map(r => r.label).join(' · ')}`}).addTo(group);
      const sign = { position, marker };
      marker.on('click', () => onSelect(entry.item, marker));
      entry.signs.push(sign);
    }
  };
  const removeSigns = entry => { for (const sign of entry.signs) group.removeLayer(sign.marker); entry.signs = []; };
  return {
    update(items) {
      const next = new Set();
      for (const item of items) for (const part of [...item.scheduled,...item.diversions,...(item.affected || [])]) {
        const id = JSON.stringify([item.id,part.kind,part.id]); next.add(id);
        let entry = entries.get(id);
        const key = JSON.stringify(part.geometry);
        if (!entry) {
          const points = part.geometry.map(([lng,lat]) => [lat,lng]);
          const options = {pane:'ttcDisruptionPane',smoothFactor:1};
          const line = leaflet.polyline(points,{...options,interactive:false,className:`ttc-line ttc-line--${part.kind}`,dashArray:(part.kind === 'scheduled' || part.kind === 'affected') ? '8 7' : undefined}).addTo(group);
          const hit = leaflet.polyline(points,{...options,weight:24,opacity:0,className:'ttc-hit'}).addTo(group);
          entry = {item,part,line,hit,key,signs:[]};
          hit.on('click',event => onSelect(entry.item, nearestSign(entry,event?.latlng)?.marker || entry.hit));
          createSigns(entry);
          entries.set(id,entry);
        } else if (entry.key !== key) {
          const points = part.geometry.map(([lng,lat]) => [lat,lng]);
          entry.line.setLatLngs(points); entry.hit.setLatLngs(points); entry.key = key;
          removeSigns(entry); createSigns(entry);
        }
        entry.item = item; entry.part = part; style(entry);
      }
      for (const [id,entry] of entries) if (!next.has(id)) {
        group.removeLayer(entry.line); group.removeLayer(entry.hit); entry.hit.off(); removeSigns(entry); entries.delete(id);
      }
      if (!items.some(i => i.id === selected)) selected = null;
    },
    select(id) { selected = id; for (const entry of entries.values()) style(entry); },
    reveal(id,options={}) {
      const points = [...entries.values()].filter(e => e.item.id === id).flatMap(e => e.part.geometry.map(([lng,lat]) => [lat,lng]));
      if (points.length) map.fitBounds(points,{padding:[40,40],maxZoom:15,animate:false,...options});
    },
    visibility(show) { visible = show; pane.style.display=show ? '' : 'none'; },
    diagnostics() { return {parts:entries.size,layers:entries.size*2,markers:[...entries.values()].reduce((total,entry)=>total+entry.signs.length,0),selected,visible}; },
    destroy() { for (const e of entries.values()) { e.hit.off(); for (const sign of e.signs) sign.marker.off(); } group.clearLayers(); group.remove(); entries.clear(); }
  };
}
