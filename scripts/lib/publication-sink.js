// Swappable publication sink for the two data-publication phases.
//
// The publication *policy* (when to refresh) lives in `data-publication.js`. This
// module owns the *sink*: where a produced artifact is written and how its change
// is detected. The production sink is Cloudflare R2 (S3-compatible object
// storage); the git `data` branch was retired in Story 55E, so R2 is the only
// publication target.
//
// A sink is a function:
//
//   publish({ key, body }) -> { changed }
//
// `key` is the object path of the artifact (for example `data/current.json`).
// `body` is the exact bytes to publish. `changed` reports whether the sink
// observed a difference from what was already published, so the caller can log
// committed/unchanged without re-deriving it.
//
// Two sinks are provided:
//
//   - `createR2Sink` PUTs the body to a Cloudflare R2 bucket over the S3 API
//     (SigV4, Node built-ins only). It is the production sink. R2 has no object
//     versioning, so it is last-writer-wins per key; the two datasets use
//     different keys and therefore cannot conflict.
//   - `createLocalSink` writes the body into a plain directory with no git. It is
//     deterministic and dependency-free, so tests can assert published bytes
//     without a repository.
//
// The R2 sink publishes directly, so no scheduler push step is needed.

import { createHash, createHmac } from 'node:crypto';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';

// A plain-directory sink with no git. Writes `key` under `dir` and reports
// whether the bytes differ from what was already there. Deterministic and
// dependency-free, so tests can assert published output directly.
export function createLocalSink({ dir = process.cwd() } = {}) {
  return async function publish({ key, body }) {
    const target = resolve(dir, key);
    await mkdir(dirname(target), { recursive: true });
    let previous;
    try { previous = await readFile(target, 'utf8'); } catch { previous = undefined; }
    await writeFile(target, body);
    return { changed: previous !== body };
  };
}

// --- Cloudflare R2 (S3-compatible) sink -------------------------------------

const sha256Hex = value => createHash('sha256').update(value).digest('hex');
const hmac = (key, value) => createHmac('sha256', key).update(value).digest();

// Build the SigV4 `Authorization` header for a single S3 request. `payloadHash`
// is the hex SHA-256 of the request body (or the empty-body hash for GET/HEAD).
// `amzDate` is the ISO basic timestamp (`YYYYMMDDTHHMMSSZ`); `dateStamp` is its
// `YYYYMMDD` prefix. Only the headers S3 requires are signed, which keeps the
// canonical request small and deterministic.
export function signS3Request({
  method, host, path, region = 'auto', service = 's3',
  accessKeyId, secretAccessKey, payloadHash, amzDate, dateStamp, extraHeaders = {}
}) {
  const headers = { host, 'x-amz-content-sha256': payloadHash, 'x-amz-date': amzDate, ...extraHeaders };
  const signedHeaderNames = Object.keys(headers).map(name => name.toLowerCase()).sort();
  const canonicalHeaders = signedHeaderNames.map(name => `${name}:${headers[name]}\n`).join('');
  const signedHeaders = signedHeaderNames.join(';');
  const canonicalRequest = [method, path, '', canonicalHeaders, signedHeaders, payloadHash].join('\n');
  const scope = `${dateStamp}/${region}/${service}/aws4_request`;
  const stringToSign = ['AWS4-HMAC-SHA256', amzDate, scope, sha256Hex(canonicalRequest)].join('\n');
  const signingKey = hmac(hmac(hmac(hmac(`AWS4${secretAccessKey}`, dateStamp), region), service), 'aws4_request');
  const signature = createHmac('sha256', signingKey).update(stringToSign).digest('hex');
  return `AWS4-HMAC-SHA256 Credential=${accessKeyId}/${scope}, SignedHeaders=${signedHeaders}, Signature=${signature}`;
}

// A Cloudflare R2 sink. PUTs `body` to `<endpoint>/<bucket>/<key>` over the S3
// API and reports `changed` by comparing the body against the object already
// stored (a GET; a missing object counts as changed). R2 has no object
// versioning, so this is last-writer-wins per key.
//
// `fetchImpl` is injectable so tests can assert the signed request without a
// network. `now` is injectable so the SigV4 timestamp is deterministic in tests.
export function createR2Sink({
  endpoint,
  bucket,
  accessKeyId,
  secretAccessKey,
  region = 'auto',
  fetchImpl = globalThis.fetch,
  now = () => new Date()
} = {}) {
  if (!endpoint || !bucket || !accessKeyId || !secretAccessKey) {
    throw new Error('R2 sink requires endpoint, bucket, accessKeyId, and secretAccessKey');
  }
  const signedFetch = createR2SignedFetch({ endpoint, bucket, accessKeyId, secretAccessKey, region, fetchImpl, now });

  return async function publish({ key, body }) {
    let previous;
    const head = await signedFetch('GET', key);
    if (head.ok) previous = await head.text();
    else if (head.status !== 404) throw new Error(`R2 read failed: ${head.status}`);
    const put = await signedFetch('PUT', key, body);
    if (!put.ok) throw new Error(`R2 write failed: ${put.status}`);
    return { changed: previous !== body };
  };
}

// Build a SigV4-signed fetch bound to one R2 bucket. Shared by the sink and the
// read helper so signing is defined once. `fetchImpl` and `now` are injectable
// for deterministic tests.
export function createR2SignedFetch({
  endpoint, bucket, accessKeyId, secretAccessKey, region = 'auto',
  fetchImpl = globalThis.fetch, now = () => new Date()
}) {
  const base = endpoint.replace(/\/+$/, '');
  const host = new URL(base).host;
  const objectPath = key => `/${bucket}/${key.replace(/^\/+/, '')}`;
  return async function signedFetch(method, key, body) {
    const payload = body ?? '';
    const payloadHash = sha256Hex(payload);
    const amzDate = now().toISOString().replace(/[:-]|\.\d{3}/g, '');
    const dateStamp = amzDate.slice(0, 8);
    const path = objectPath(key);
    const authorization = signS3Request({
      method, host, path, region, accessKeyId, secretAccessKey, payloadHash, amzDate, dateStamp
    });
    return fetchImpl(`${base}${path}`, {
      method,
      headers: {
        authorization,
        'x-amz-content-sha256': payloadHash,
        'x-amz-date': amzDate,
        ...(body === undefined ? {} : { 'content-type': 'application/json' })
      },
      ...(body === undefined ? {} : { body })
    });
  };
}

// Read one object from R2. Returns the body text, or `undefined` when the object
// does not exist (404). Used by the Concourse incident task to seed the ETL's
// history input from the published snapshot instead of a git checkout.
export async function fetchR2Object({
  endpoint, bucket, accessKeyId, secretAccessKey, region = 'auto',
  key, fetchImpl = globalThis.fetch, now = () => new Date()
}) {
  const signedFetch = createR2SignedFetch({ endpoint, bucket, accessKeyId, secretAccessKey, region, fetchImpl, now });
  const response = await signedFetch('GET', key);
  if (response.status === 404) return undefined;
  if (!response.ok) throw new Error(`R2 read failed: ${response.status}`);
  return response.text();
}

// Select the production sink from the environment. R2 is the only publication
// target since the git `data` branch was retired in Story 55E, so the four R2
// credentials are required; a missing value fails loudly rather than silently
// writing to a branch that no longer exists.
//
// R2 env: R2_ENDPOINT, R2_BUCKET, R2_ACCESS_KEY_ID, R2_SECRET_ACCESS_KEY
// (optional R2_REGION, default `auto`).
export function createSinkFromEnv({ env = process.env } = {}) {
  const { R2_ENDPOINT, R2_BUCKET, R2_ACCESS_KEY_ID, R2_SECRET_ACCESS_KEY } = env;
  if (!R2_ENDPOINT || !R2_BUCKET || !R2_ACCESS_KEY_ID || !R2_SECRET_ACCESS_KEY) {
    throw new Error('R2 publication requires R2_ENDPOINT, R2_BUCKET, R2_ACCESS_KEY_ID, and R2_SECRET_ACCESS_KEY');
  }
  return createR2Sink({
    endpoint: R2_ENDPOINT,
    bucket: R2_BUCKET,
    accessKeyId: R2_ACCESS_KEY_ID,
    secretAccessKey: R2_SECRET_ACCESS_KEY,
    region: env.R2_REGION || 'auto'
  });
}
