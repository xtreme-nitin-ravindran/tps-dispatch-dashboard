// Shared TTC-geometry publication phase for both schedulers.
//
// This is the second of two publication phases. It runs *after* the incident
// phase has already committed `data/current.json`, so a slow or failed TTC stage
// cannot block or roll back the incident publication. It projects the confirmed
// diversion geometry and publishes it as `data/ttc-diversions.json` through the
// shared publication sink.
//
// The sink is Cloudflare R2 (S3-compatible), which publishes directly, so no
// scheduler push step is needed. The git `data` branch was retired in Story 55E.
// The two datasets use different keys, so they cannot conflict. A no-change
// geometry artifact produces no write.
//
// Environment:
//   TTC_DIVERSION_OUTPUT  source diversions artifact (default .cache/ttc/diversions.json)
//   R2_*                  R2 publication credentials (required)

import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { readFile } from 'node:fs/promises';
import { publicTtcGeometry } from './publish-ttc-geometry.js';
import { createSinkFromEnv } from './lib/publication-sink.js';

const TTC_KEY = 'data/ttc-diversions.json';

// Project the confirmed geometry and publish it through the sink. Returns a
// bounded result. The sink is R2; tests inject a deterministic local sink.
export async function publishTtcPhase({
  sourcePath = process.env.TTC_DIVERSION_OUTPUT || '.cache/ttc/diversions.json',
  sink,
  log = entry => console.log(JSON.stringify(entry))
} = {}) {
  const geometry = publicTtcGeometry(JSON.parse(await readFile(sourcePath, 'utf8')));
  const publish = sink || createSinkFromEnv();
  const { changed } = await publish({ key: TTC_KEY, body: `${JSON.stringify(geometry)}\n` });
  log({ source: 'ttc-publication', status: changed ? 'committed' : 'unchanged' });
  return { committed: changed };
}

// True when this module is the process entry point. Exported so the guard is
// directly testable (a spawned CLI's coverage is not merged by the runner).
export function isDirectInvocation({ argv1 = process.argv[1], moduleUrl = import.meta.url } = {}) {
  return Boolean(argv1) && moduleUrl === pathToFileURL(resolve(argv1)).href;
}

// Run the phase as a CLI and print the human-readable verdict. Exported so both
// the committed and no-change messages are directly testable.
export async function runTtcPhaseCli({ publish = publishTtcPhase, log = console.log } = {}) {
  const result = await publish();
  log(result.committed ? 'TTC geometry committed' : 'No TTC geometry changes to commit');
  return result;
}

if (isDirectInvocation()) {
  await runTtcPhaseCli();
}
