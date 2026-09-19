"""Build compact open-data indexes from downloaded Toronto Centreline and GeoNames CA.zip."""
import json, sys, zipfile, re
from pathlib import Path
streets, nodes = {}, {}
for feature in json.load(open(sys.argv[1]))['features']:
    p, g = feature['properties'], feature['geometry']
    lines = g['coordinates'] if g['type'] == 'MultiLineString' else [g['coordinates']]
    if not lines or not lines[0]: continue
    name = p.get('LINEAR_NAME_FULL')
    if not name: continue
    for node, point in [(p.get('FROM_INTERSECTION_ID'), lines[0][0]), (p.get('TO_INTERSECTION_ID'), lines[-1][-1])]:
        if not node: continue
        node = str(node)
        nodes[node] = [round(point[1],7), round(point[0],7)]
        streets.setdefault(name, set()).add(node)
postal = {}
with zipfile.ZipFile(sys.argv[2]) as z:
    for line in z.read('CA.txt').decode().splitlines():
        f = line.split('\t')
        if re.fullmatch(r'M[1-9][A-Z]',f[1]):
            label = re.sub(r'^Toronto\s*\((.*)\)$',r'\1',f[2])
            postal[f[1]] = {'name':label, 'coordinates':[float(f[9]),float(f[10])]}
out = Path('data/geography')
out.mkdir(exist_ok=True)
(out/'toronto-locations.json').write_text(json.dumps({'streets':{k:sorted(v) for k,v in streets.items()},'nodes':nodes,'postal':postal},separators=(',',':'))+'\n')
