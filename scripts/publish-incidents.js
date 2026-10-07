// Shared incident-publication phase for both schedulers.
//
// This is the first of two publication phases. It runs the incident ETL (when
// the shared freshness policy says the snapshot needs it) and publishes
// `data/current.json` through the shared publication sink — all *before* the
// bounded TTC vehicle observation and geometry projection run. A slow or failed
// TTC stage therefore cannot block or roll back the incident publication.
//
// The sink decides where the artifact lands. The production sink is Cloudflare
// R2 (S3-compatible), which publishes directly, so no scheduler push step is
// needed. The git sink remains available for the transition and local runs; when
// it is used the push is owned by the scheduler (Concourse `put` with
// `rebase: true`; GitHub Actions `git pull --rebase && git push`). Either way the
// two datasets use different keys/files, so they cannot conflict.
//
// GitHub Actions and Concourse both invoke this script, so the freshness/skip
// policy, per-feed failure/retention, history input, timestamp meaning,
// deterministic output, and commit/no-change behavior are identical. Only the
// updater identity and platform credentials differ.
//
// Environment:
//   TFS_UPDATED_BY   updater identity: "github-actions" or "concourse"
//   TFS_PREVIOUS     optional explicit history input (Concourse)
//   TFS_OUTPUT       output path (default data/current.json)
//   TFS_XML          optional XML fixture input
//   DATA_REPO_DIR    data-branch checkout (default current directory)
//
// Exit status is 0 when the snapshot is committed or already fresh, and nonzero
// only when the incident phase itself fails. A TTC failure never reaches here.

import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { runTfsEtl } from './tfs-etl.js';
import { needsUpdate } from './lib/data-publication.js';
import { createSinkFromEnv } from './lib/publication-sink.js';
import { fetchTpsSource } from '../src/tps/source.js';
import { updateDisruptions } from '../src/disruptions/source.js';
import { updateTtcBackend } from '../src/ttc/backend.js';

const INCIDENT_KEY = 'data/current.json';
const INCIDENT_MESSAGE = 'chore: refresh SirenTO incidents';

// Run the incident phase. Returns a bounded, deterministic result describing
// what happened so callers and tests can assert on it without parsing logs.
//
// `outputPath` is where the ETL writes the snapshot. `repoDir` is the data-branch
// checkout where the commit happens; it defaults to the current directory, but
// GitHub Actions keeps the data checkout in a subdirectory while the ETL writes
// to the workspace root, so the two are separate.
export async function publishIncidents({
  outputPath = process.env.TFS_OUTPUT || 'data/current.json',
  previousPath = process.env.TFS_PREVIOUS || undefined,
  xmlPath = process.env.TFS_XML || undefined,
  updatedBy = process.env.TFS_UPDATED_BY || 'manual',
  now = new Date(),
  repoDir = process.env.DATA_REPO_DIR || process.cwd(),
  etl = runTfsEtl,
  sink = createSinkFromEnv({ message: INCIDENT_MESSAGE, repoDir }),
  log = entry => console.log(JSON.stringify(entry))
} = {}) {
  let snapshot;
  try { snapshot = JSON.parse(await readFile(outputPath, 'utf8')); }
  catch (error) { if (error.code !== 'ENOENT') throw error; }

  if (!needsUpdate(snapshot, now)) {
    log({ source: 'incident-publication', status: 'fresh', updatedBy });
    return { updated: false, committed: false };
  }

  await etl({
    outputPath, previousPath, xmlPath, now, updatedBy,
    fetchPolice: fetchTpsSource, fetchTravel: updateDisruptions, fetchTtc: updateTtcBackend
  });
  const body = await readFile(outputPath, 'utf8');
  const { changed } = await sink({ key: INCIDENT_KEY, body });
  log({ source: 'incident-publication', status: changed ? 'committed' : 'unchanged', updatedBy });
  return { updated: true, committed: changed };
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  const result = await publishIncidents();
  console.log(result.updated
    ? 'Incident snapshot updated'
    : 'Snapshot and incident feeds are fresh; skipped');
}
