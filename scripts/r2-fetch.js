// Download one object from Cloudflare R2 to a local path.
//
// The Concourse incident task uses this to seed the ETL's history input
// (`TFS_PREVIOUS`) from the published snapshot, replacing the previous git
// checkout of the `data` branch. A missing object is not an error: the task
// treats an absent history file as "no previous snapshot" and the ETL starts
// fresh, exactly as it did when the git checkout was empty.
//
// Environment:
//   R2_ENDPOINT, R2_BUCKET, R2_ACCESS_KEY_ID, R2_SECRET_ACCESS_KEY
//   (optional R2_REGION, default `auto`)
//
// Usage: node scripts/r2-fetch.js <key> <output-path>

import { mkdir, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { fetchR2Object } from './lib/publication-sink.js';

export async function fetchR2ToFile({
  key,
  outputPath,
  env = process.env,
  fetchObject = fetchR2Object,
  log = entry => console.log(JSON.stringify(entry))
} = {}) {
  const body = await fetchObject({
    endpoint: env.R2_ENDPOINT,
    bucket: env.R2_BUCKET,
    accessKeyId: env.R2_ACCESS_KEY_ID,
    secretAccessKey: env.R2_SECRET_ACCESS_KEY,
    region: env.R2_REGION || 'auto',
    key
  });
  if (body === undefined) {
    log({ source: 'r2-fetch', key, status: 'missing' });
    return { found: false, message: `No object at ${key}` };
  }
  const target = resolve(outputPath);
  await mkdir(dirname(target), { recursive: true });
  await writeFile(target, body);
  log({ source: 'r2-fetch', key, status: 'fetched' });
  return { found: true, message: `Fetched ${key}` };
}

// Run the CLI for the given argv. Exported so the argument handling and output
// are covered in-process; the subprocess coverage of a spawned CLI is not
// captured by the test runner.
export async function runCli({
  argv = process.argv,
  fetch = fetchR2ToFile,
  out = line => console.log(line),
  err = line => console.error(line),
  exit = code => process.exit(code)
} = {}) {
  const [, , key, outputPath] = argv;
  if (!key || !outputPath) {
    err('usage: node scripts/r2-fetch.js <key> <output-path>');
    return exit(2);
  }
  const result = await fetch({ key, outputPath });
  out(result.message);
  return result;
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  await runCli();
}
