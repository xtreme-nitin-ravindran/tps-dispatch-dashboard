// Shared TTC-geometry publication phase for both schedulers.
//
// This is the second of two publication phases. It runs *after* the incident
// phase has already committed `data/current.json`, so a slow or failed TTC stage
// cannot block or roll back the incident publication. It projects the confirmed
// diversion geometry and publishes it as `data/ttc-diversions.json` through the
// shared publication sink.
//
// The push itself is owned by the scheduler, not this script:
//   - Concourse publishes with the git resource's `put` (`rebase: true`).
//   - GitHub Actions runs `git pull --rebase && git push` in the workflow.
// Both writers commit only their own file, so a rebase onto the other writer's
// tip cannot conflict. This script therefore never pushes. A no-change geometry
// artifact produces no commit.
//
// Environment:
//   TTC_DIVERSION_OUTPUT  source diversions artifact (default .cache/ttc/diversions.json)
//   DATA_REPO_DIR         data-branch checkout (default current directory)

import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { readFile } from 'node:fs/promises';
import { publicTtcGeometry } from './publish-ttc-geometry.js';
import { createGitSink } from './lib/publication-sink.js';

const TTC_KEY = 'data/ttc-diversions.json';
const TTC_MESSAGE = 'chore: refresh public TTC geometry';

// Project the confirmed geometry and publish it through the sink. Returns a
// bounded result. The sink defaults to the git data-branch sink; tests inject a
// deterministic local sink.
export async function publishTtcPhase({
  sourcePath = process.env.TTC_DIVERSION_OUTPUT || '.cache/ttc/diversions.json',
  repoDir = process.env.DATA_REPO_DIR || process.cwd(),
  sink = createGitSink({ repoDir, message: TTC_MESSAGE }),
  log = entry => console.log(JSON.stringify(entry))
} = {}) {
  const geometry = publicTtcGeometry(JSON.parse(await readFile(sourcePath, 'utf8')));
  const { changed } = await sink({ key: TTC_KEY, body: `${JSON.stringify(geometry)}\n` });
  log({ source: 'ttc-publication', status: changed ? 'committed' : 'unchanged' });
  return { committed: changed };
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  const result = await publishTtcPhase();
  console.log(result.committed ? 'TTC geometry committed' : 'No TTC geometry changes to commit');
}
