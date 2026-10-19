// TTC GTFS-RT vehicle-capture test — R2 readback helpers.
//
// The e2e harness (scripts/e2e.sh) needs to assert that the deployed
// collector/processor actually wrote durable evidence to R2, that the ownership
// lease exists, and that the public geometry artifact is present. Rather than
// re-implementing SigV4 signing in bash, this module composes the already-covered
// R2 client factories (`createR2CaptureSink` / `createR2SignedFetch` /
// `fetchR2Object` from scripts/lib/publication-sink.js and src/ttc/capture-store.js)
// into a small CLI the harness calls.
//
// This module is a thin composition over production-tested modules. It is a
// host-level test helper (never run inside the Docker test image) and contains no
// new signing, parsing, or policy logic, so it is intentionally not part of the
// unit coverage gate.

import { createR2CaptureSink } from '../../src/ttc/capture-store.js';
import { fetchR2Object } from './publication-sink.js';

// Read the required R2 values from the environment, failing loudly when any of
// the four required values is missing (mirrors createSinkFromEnv /
// createCaptureSinkFromEnv).
function r2ConfigFromEnv(env = process.env) {
  const { R2_ENDPOINT, R2_BUCKET, R2_ACCESS_KEY_ID, R2_SECRET_ACCESS_KEY } = env;
  if (!R2_ENDPOINT || !R2_BUCKET || !R2_ACCESS_KEY_ID || !R2_SECRET_ACCESS_KEY) {
    throw new Error('e2e-r2 requires R2_ENDPOINT, R2_BUCKET, R2_ACCESS_KEY_ID, and R2_SECRET_ACCESS_KEY');
  }
  return {
    endpoint: R2_ENDPOINT, bucket: R2_BUCKET,
    accessKeyId: R2_ACCESS_KEY_ID, secretAccessKey: R2_SECRET_ACCESS_KEY,
    region: env.R2_REGION || 'auto'
  };
}

// Empty the bucket: enumerate every object key (blank prefix lists the whole
// bucket), then delete each. The fixed scratch bucket holds only e2e objects,
// so a whole-bucket empty is the "no pollution" guarantee the harness needs
// before a run; it uses the object-level R2 creds, not the Cloudflare admin API.
async function emptyBucket(cfg) {
  const sink = createR2CaptureSink(cfg);
  const keys = await sink.list('');
  for (const key of keys) {
    await sink.delete(key);
  }
  return keys.length;
}

// Print a machine-readable JSON report of the R2 state the harness asserts on:
//   - the ownership lease (raw body or null when absent),
//   - the committed capture keys under the private capture prefix,
//   - the public geometry artifact presence.
// Keys are printed in sorted order for deterministic output.
async function readReport(cfg, env) {
  const ownershipKey = env.E2E_OWNERSHIP_KEY || 'ttc-ownership/collector.json';
  const capturePrefix = env.E2E_CAPTURE_PREFIX || 'ttc-captures/';
  const publicKey = env.E2E_PUBLIC_KEY || 'data/ttc-diversions.json';

  const sink = createR2CaptureSink(cfg);

  const [lease, captureKeys, publicArtifact] = await Promise.all([
    sink.get(ownershipKey).catch(() => null),
    sink.list(capturePrefix).catch(() => null),
    fetchR2Object({ ...cfg, key: publicKey }).catch(() => null)
  ]);

  process.stdout.write(JSON.stringify({
    ownershipKey,
    lease: lease ?? null,
    capturePrefix,
    captureKeys: captureKeys ? captureKeys.sort() : null,
    publicKey,
    publicArtifactPresent: publicArtifact !== undefined && publicArtifact !== null
  }));
}

async function main() {
  const cfg = r2ConfigFromEnv(process.env);
  if (process.argv.includes('--empty')) {
    const deleted = await emptyBucket(cfg);
    process.stdout.write(JSON.stringify({ deleted }));
    return;
  }
  await readReport(cfg, process.env);
}

main().catch((error) => {
  process.stderr.write(JSON.stringify({ error: error.message }));
  process.exitCode = 1;
});
