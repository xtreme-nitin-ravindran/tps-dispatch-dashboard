import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const app = await readFile(new URL('../src/app/app.js', import.meta.url), 'utf8');

const R2_HOST = 'data-sirento.nitin.run';
const SNAPSHOT_URL = `https://${R2_HOST}/data/current.json`;
const GEOMETRY_URL = `https://${R2_HOST}/data/ttc-diversions.json`;

function snapshotUrlLiteral() {
  const match = app.match(/snapshotUrl:\s*"([^"]+)"/);
  assert.ok(match, 'CONFIG.snapshotUrl literal not found');
  return match[1];
}

test('CONFIG.snapshotUrl points at the R2-backed public read path', () => {
  assert.equal(snapshotUrlLiteral(), SNAPSHOT_URL);
});

test('snapshotUrl no longer references the retired git data branch', () => {
  assert.doesNotMatch(app, /raw\.githubusercontent\.com/);
  assert.doesNotMatch(app, /\/data\/data\/current\.json/);
});

test('the ttc-diversions.json derivation yields the R2 geometry URL', () => {
  // src/app/app.js derives the geometry URL by replacing the literal "current.json"
  // substring, so the base URL must keep that substring intact.
  const derived = snapshotUrlLiteral().replace('current.json', 'ttc-diversions.json');
  assert.equal(derived, GEOMETRY_URL);
  assert.match(app, /CONFIG\.snapshotUrl\.replace\('current\.json','ttc-diversions\.json'\)/);
});

test('snapshot and geometry fetches keep cache-busting against the new host', () => {
  assert.match(app, /`\?ts=\$\{Date\.now\(\)\}`/);
  assert.match(app, /cache:\s*['"]no-store['"]/);
});
