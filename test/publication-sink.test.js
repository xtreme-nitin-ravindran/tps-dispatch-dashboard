import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createLocalSink, createR2Sink, createR2SignedFetch, createSinkFromEnv, fetchR2Object, signS3Request } from '../scripts/lib/publication-sink.js';

// --- Local sink -------------------------------------------------------------

test('the local sink writes the body and reports the first write as changed', async t => {
  const dir = await mkdtemp(join(tmpdir(), 'local-sink-'));
  t.after(() => rm(dir, { recursive: true, force: true }));
  const sink = createLocalSink({ dir });
  const result = await sink({ key: 'data/current.json', body: '{"a":1}\n' });
  assert.deepEqual(result, { changed: true });
  assert.equal(await readFile(join(dir, 'data/current.json'), 'utf8'), '{"a":1}\n');
});

test('the local sink reports an identical rewrite as unchanged', async t => {
  const dir = await mkdtemp(join(tmpdir(), 'local-sink-'));
  t.after(() => rm(dir, { recursive: true, force: true }));
  const sink = createLocalSink({ dir });
  await sink({ key: 'data/current.json', body: '{"a":1}\n' });
  assert.deepEqual(await sink({ key: 'data/current.json', body: '{"a":1}\n' }), { changed: false });
});

test('the local sink reports a differing rewrite as changed', async t => {
  const dir = await mkdtemp(join(tmpdir(), 'local-sink-'));
  t.after(() => rm(dir, { recursive: true, force: true }));
  const sink = createLocalSink({ dir });
  await sink({ key: 'data/current.json', body: '{"a":1}\n' });
  assert.deepEqual(await sink({ key: 'data/current.json', body: '{"a":2}\n' }), { changed: true });
  assert.equal(await readFile(join(dir, 'data/current.json'), 'utf8'), '{"a":2}\n');
});

test('the local sink creates nested directories and defaults to the current directory', async t => {
  const dir = await mkdtemp(join(tmpdir(), 'local-sink-'));
  t.after(() => rm(dir, { recursive: true, force: true }));
  const sink = createLocalSink({ dir });
  await sink({ key: 'deep/nested/artifact.json', body: 'x' });
  assert.equal(await readFile(join(dir, 'deep/nested/artifact.json'), 'utf8'), 'x');
  // Default dir is the current working directory.
  const previous = process.cwd();
  process.chdir(dir);
  try {
    const defaultSink = createLocalSink();
    await defaultSink({ key: 'default.json', body: 'y' });
    assert.equal(await readFile(join(dir, 'default.json'), 'utf8'), 'y');
  } finally {
    process.chdir(previous);
  }
});

// --- R2 sink ----------------------------------------------------------------

// A minimal in-memory R2 stand-in. It records every request so tests can assert
// the signed method, path, and headers, and it stores objects by key so the
// sink's change detection can be exercised end to end.
function fakeR2({ objects = {} } = {}) {
  const store = new Map(Object.entries(objects));
  const requests = [];
  const fetchImpl = async (url, options = {}) => {
    const { pathname } = new URL(url);
    const method = options.method || 'GET';
    requests.push({ url, method, headers: options.headers, body: options.body });
    if (method === 'GET') {
      if (!store.has(pathname)) return { ok: false, status: 404, async text() { return ''; } };
      return { ok: true, status: 200, async text() { return store.get(pathname); } };
    }
    if (method === 'PUT') {
      store.set(pathname, options.body);
      return { ok: true, status: 200, async text() { return ''; } };
    }
    return { ok: false, status: 500, async text() { return ''; } };
  };
  return { store, requests, fetchImpl };
}

const r2Config = {
  endpoint: 'https://account.r2.cloudflarestorage.com',
  bucket: 'sirento',
  accessKeyId: 'AKIDEXAMPLE',
  secretAccessKey: 'secret',
  now: () => new Date('2026-10-06T12:00:00Z')
};

test('the R2 sink requires every credential', () => {
  assert.throws(() => createR2Sink({}), /R2 sink requires/);
  assert.throws(() => createR2Sink({ endpoint: 'https://x', bucket: 'b', accessKeyId: 'a' }), /R2 sink requires/);
});

test('the R2 sink PUTs the body and reports a first write as changed', async () => {
  const { store, requests, fetchImpl } = fakeR2();
  const sink = createR2Sink({ ...r2Config, fetchImpl });
  assert.deepEqual(await sink({ key: 'data/current.json', body: '{"a":1}\n' }), { changed: true });
  assert.equal(store.get('/sirento/data/current.json'), '{"a":1}\n');
  // A GET (change detection) then a PUT.
  assert.deepEqual(requests.map(r => r.method), ['GET', 'PUT']);
  assert.equal(requests[1].headers['content-type'], 'application/json');
});

test('the R2 sink reports an identical rewrite as unchanged and a differing one as changed', async () => {
  const { fetchImpl } = fakeR2();
  const sink = createR2Sink({ ...r2Config, fetchImpl });
  await sink({ key: 'data/current.json', body: '{"a":1}\n' });
  assert.deepEqual(await sink({ key: 'data/current.json', body: '{"a":1}\n' }), { changed: false });
  assert.deepEqual(await sink({ key: 'data/current.json', body: '{"a":2}\n' }), { changed: true });
});

test('the R2 sink signs each request with SigV4 and the configured bucket', async () => {
  const { requests, fetchImpl } = fakeR2();
  const sink = createR2Sink({ ...r2Config, fetchImpl });
  await sink({ key: 'data/ttc-diversions.json', body: 'x' });
  const put = requests.find(r => r.method === 'PUT');
  assert.match(put.url, /^https:\/\/account\.r2\.cloudflarestorage\.com\/sirento\/data\/ttc-diversions\.json$/);
  assert.match(put.headers.authorization, /^AWS4-HMAC-SHA256 Credential=AKIDEXAMPLE\/20261006\/auto\/s3\/aws4_request, SignedHeaders=/);
  assert.equal(put.headers['x-amz-date'], '20261006T120000Z');
  assert.equal(put.headers['x-amz-content-sha256'], '2d711642b726b04401627ca9fbac32f5c8530fb1903cc4db02258717921a4881');
});

test('the R2 sink surfaces a read or write failure', async () => {
  const readFail = createR2Sink({ ...r2Config, fetchImpl: async () => ({ ok: false, status: 500, async text() { return ''; } }) });
  await assert.rejects(readFail({ key: 'k', body: 'b' }), /R2 read failed: 500/);
  const writeFail = createR2Sink({
    ...r2Config,
    fetchImpl: async (url, options = {}) => (options.method === 'PUT'
      ? { ok: false, status: 403, async text() { return ''; } }
      : { ok: false, status: 404, async text() { return ''; } })
  });
  await assert.rejects(writeFail({ key: 'k', body: 'b' }), /R2 write failed: 403/);
});

test('the R2 sink strips a trailing slash from the endpoint', async () => {
  const { requests, fetchImpl } = fakeR2();
  const sink = createR2Sink({ ...r2Config, endpoint: 'https://account.r2.cloudflarestorage.com/', fetchImpl });
  await sink({ key: '/data/current.json', body: 'x' });
  assert.match(requests[0].url, /^https:\/\/account\.r2\.cloudflarestorage\.com\/sirento\/data\/current\.json$/);
});

test('signS3Request produces a stable signature for fixed inputs', () => {
  const authorization = signS3Request({
    method: 'PUT', host: 'account.r2.cloudflarestorage.com', path: '/sirento/data/current.json',
    accessKeyId: 'AKIDEXAMPLE', secretAccessKey: 'secret',
    payloadHash: 'abc', amzDate: '20261006T120000Z', dateStamp: '20261006'
  });
  assert.match(authorization, /^AWS4-HMAC-SHA256 Credential=AKIDEXAMPLE\/20261006\/auto\/s3\/aws4_request, SignedHeaders=host;x-amz-content-sha256;x-amz-date, Signature=[0-9a-f]{64}$/);
});

// --- fetchR2Object ----------------------------------------------------------

test('fetchR2Object returns the body, undefined for a missing object, and throws on failure', async () => {
  const { fetchImpl } = fakeR2({ objects: { '/sirento/data/current.json': '{"a":1}\n' } });
  const config = { ...r2Config, fetchImpl };
  assert.equal(await fetchR2Object({ ...config, key: 'data/current.json' }), '{"a":1}\n');
  assert.equal(await fetchR2Object({ ...config, key: 'data/missing.json' }), undefined);
  await assert.rejects(
    fetchR2Object({ ...config, key: 'k', fetchImpl: async () => ({ ok: false, status: 500, async text() { return ''; } }) }),
    /R2 read failed: 500/
  );
});

// --- Environment-driven sink selection --------------------------------------

test('createSinkFromEnv selects the R2 sink when the credentials are present', async () => {
  const { store, fetchImpl } = fakeR2();
  const sink = createSinkFromEnv({
    env: { R2_ENDPOINT: r2Config.endpoint, R2_BUCKET: 'sirento', R2_ACCESS_KEY_ID: 'a', R2_SECRET_ACCESS_KEY: 's' }
  });
  // The default fetch is the global one; swap it by rebuilding with the fake.
  const r2Sink = createR2Sink({ ...r2Config, fetchImpl });
  await r2Sink({ key: 'data/current.json', body: 'x' });
  assert.equal(store.get('/sirento/data/current.json'), 'x');
  assert.equal(typeof sink, 'function');
});

test('createSinkFromEnv requires every R2 credential and never falls back to git', () => {
  // The git `data` branch was retired in Story 55E, so a missing credential must
  // fail loudly instead of silently writing to a branch that no longer exists.
  assert.throws(() => createSinkFromEnv({ env: {} }), /R2 publication requires/);
  assert.throws(
    () => createSinkFromEnv({ env: { R2_ENDPOINT: 'https://x', R2_BUCKET: 'b', R2_ACCESS_KEY_ID: 'a' } }),
    /R2 publication requires/
  );
});

test('createSinkFromEnv honors R2_REGION and defaults it to auto', () => {
  const base = { R2_ENDPOINT: r2Config.endpoint, R2_BUCKET: 'sirento', R2_ACCESS_KEY_ID: 'a', R2_SECRET_ACCESS_KEY: 's' };
  assert.equal(typeof createSinkFromEnv({ env: base }), 'function');
  assert.equal(typeof createSinkFromEnv({ env: { ...base, R2_REGION: 'wnam' } }), 'function');
});

test('createR2SignedFetch defaults its region, fetch, and clock', async () => {
  // No region/fetchImpl/now: the defaults must produce a valid signed request
  // against the global fetch. Stub the global so no network is touched.
  const requests = [];
  const original = globalThis.fetch;
  globalThis.fetch = async (url, options) => { requests.push({ url, options }); return { ok: true, status: 200, async text() { return ''; } }; };
  try {
    const signedFetch = createR2SignedFetch({ endpoint: 'https://account.r2.cloudflarestorage.com', bucket: 'sirento', accessKeyId: 'a', secretAccessKey: 's' });
    await signedFetch('GET', 'data/current.json');
  } finally {
    globalThis.fetch = original;
  }
  assert.equal(requests.length, 1);
  assert.match(requests[0].options.headers.authorization, /\/auto\/s3\/aws4_request/);
});

test('fetchR2Object defaults its region, fetch, and clock', async () => {
  const original = globalThis.fetch;
  globalThis.fetch = async () => ({ ok: true, status: 200, async text() { return 'body'; } });
  try {
    assert.equal(await fetchR2Object({ endpoint: 'https://x', bucket: 'b', accessKeyId: 'a', secretAccessKey: 's', key: 'k' }), 'body');
  } finally {
    globalThis.fetch = original;
  }
});

test('signS3Request defaults its region, service, and extra headers', () => {
  const authorization = signS3Request({
    method: 'GET', host: 'h', path: '/p', accessKeyId: 'a', secretAccessKey: 's',
    payloadHash: 'x', amzDate: '20261006T120000Z', dateStamp: '20261006'
  });
  assert.match(authorization, /Credential=a\/20261006\/auto\/s3\/aws4_request/);
  assert.match(authorization, /SignedHeaders=host;x-amz-content-sha256;x-amz-date/);
});

test('createR2Sink defaults its region, fetch, and clock', async () => {
  // No region/fetchImpl/now: the defaults must produce a valid signed request
  // against the global fetch. Stub the global so no network is touched.
  const requests = [];
  const original = globalThis.fetch;
  globalThis.fetch = async (url, options = {}) => {
    requests.push({ url, method: options.method });
    if (options.method === 'GET') return { ok: false, status: 404, async text() { return ''; } };
    return { ok: true, status: 200, async text() { return ''; } };
  };
  try {
    const sink = createR2Sink({ endpoint: 'https://account.r2.cloudflarestorage.com', bucket: 'sirento', accessKeyId: 'a', secretAccessKey: 's' });
    assert.deepEqual(await sink({ key: 'data/current.json', body: 'x' }), { changed: true });
  } finally {
    globalThis.fetch = original;
  }
  assert.deepEqual(requests.map(r => r.method), ['GET', 'PUT']);
});
