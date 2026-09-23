import test from 'node:test';
import assert from 'node:assert/strict';
import { inflateRawSync } from 'node:zlib';
import { options, response } from './helpers/live-source.js';

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

