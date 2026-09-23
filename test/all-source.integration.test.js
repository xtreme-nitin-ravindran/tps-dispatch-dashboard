import test from 'node:test';
import assert from 'node:assert/strict';
import { inflateRawSync } from 'node:zlib';
import { TPS_ENDPOINT, normalizeTps } from '../src/tps/source.js';
import { fetchDisruptionSource } from '../src/disruptions/source.js';

const options = { timeout: 45000 };
async function response(url) {
  const result = await fetch(url, { signal: AbortSignal.timeout(30000), headers: {
    'User-Agent': 'SirenTO-source-check/1.0 (+https://github.com/xtreme-nitin-ravindran/tps-dispatch-dashboard)'
  }});
  assert.ok(result.ok, `${url}: HTTP ${result.status}`);
  return result;
}
async function json(url) {
  const data = await (await response(url)).json();
  assert.ok(!data.error, `${url}: ${JSON.stringify(data.error)}`);
  return data;
}

test('live TPS sample normalizes into police calls', options, async () => {
  const data = await json(`${TPS_ENDPOINT}/query?where=1%3D1&outFields=*&returnGeometry=false&resultRecordCount=3&f=json`);
  assert.ok(Array.isArray(data.features));
  for (const feature of data.features) {
    const call = normalizeTps(feature.attributes);
    assert.equal(call.source, 'TPS');
    assert.ok(Number.isFinite(Date.parse(call.timestamp)));
    assert.ok(call.description);
  }
});
for (const kind of ['roads', 'transit']) {
  test(`live ${kind} feed satisfies production parser`, options, async () => {
    const data = await fetchDisruptionSource(kind);
    assert.ok(Array.isArray(data.items));
    for (const item of data.items) {
      assert.ok(item.id);
      assert.ok(item.title);
    }
    if (kind === 'transit') assert.ok(Number.isFinite(Date.parse(data.sourceUpdatedAt)));
  });
}

test('live TPS boundaries contain polygon geometry', options, async () => {
  const item = await json('https://www.arcgis.com/sharing/rest/content/items/fdd36b8dd9544c97b926958f3eb8cb98?f=json');
  assert.match(item.url, /^https:\/\/services\.arcgis\.com\//);
  const data = await json(`${item.url}/0/query?where=1%3D1&outFields=*&returnGeometry=true&outSR=4326&resultRecordCount=1&f=json`);
  assert.equal(data.features?.length, 1);
  const rings = data.features[0].geometry?.rings;
  assert.ok(rings?.length && rings[0].length >= 4);
  assert.ok(rings.flat().every(p => Number.isFinite(p[0]) && Number.isFinite(p[1])));
});

test('live Centreline sample exposes street and intersection fields', options, async () => {
  const base = 'https://ckan0.cf.opendata.inter.prod-toronto.ca/api/3/action/';
  const catalogue = await json(`${base}package_show?id=toronto-centreline-tcl`);
  assert.equal(catalogue.success, true);
  const resource = catalogue.result.resources.find(r => r.datastore_active && r.name === 'Centreline - Version 2');
  assert.ok(resource, 'Centreline datastore must be available');
  const data = await json(`${base}datastore_search?resource_id=${resource.id}&limit=1`);
  assert.equal(data.success, true);
  assert.equal(data.result.records.length, 1);
  const record = data.result.records[0];
  for (const field of ['LINEAR_NAME_FULL', 'FROM_INTERSECTION_ID', 'TO_INTERSECTION_ID']) assert.ok(field in record, `Missing ${field}`);
});

test('live GeoNames Canada archive contains Toronto postal coordinates', options, async () => {
  const zip = Buffer.from(await (await response('https://download.geonames.org/export/zip/CA.zip')).arrayBuffer());
  // Use the central directory sizes, since local headers can use data descriptors.
  let text;
  for (let i = 0; i + 46 <= zip.length; i++) {
    if (zip.readUInt32LE(i) !== 0x02014b50) continue;
    const length = zip.readUInt16LE(i + 28);
    if (zip.toString('utf8', i + 46, i + 46 + length) !== 'CA.txt') continue;
    const size = zip.readUInt32LE(i + 20), offset = zip.readUInt32LE(i + 42);
    const start = offset + 30 + zip.readUInt16LE(offset + 26) + zip.readUInt16LE(offset + 28);
    const payload = zip.subarray(start, start + size);
    const method = zip.readUInt16LE(i + 10);
    assert.ok(method === 0 || method === 8);
    text = (method === 8 ? inflateRawSync(payload, {maxOutputLength: 10000000}) : payload).toString('utf8');
    break;
  }
  assert.ok(text, 'CA.txt missing from postal archive');
  const rows = text.split('\n').map(line => line.split('\t')).filter(row => /^M[1-9][A-Z]$/.test(row[1]));
  assert.ok(rows.length > 0);
  assert.ok(rows.every(r => r[0] === 'CA' && r[2] && Number.isFinite(Number(r[9])) && Number.isFinite(Number(r[10]))));
});

test('live OpenStreetMap sample tile is a PNG', options, async () => {
  const result = await response('https://tile.openstreetmap.org/0/0/0.png');
  assert.match(result.headers.get('content-type') || '', /image\/png/);
  const bytes = Buffer.from(await result.arrayBuffer());
  assert.deepEqual([...bytes.subarray(0, 8)], [137,80,78,71,13,10,26,10]);
});
