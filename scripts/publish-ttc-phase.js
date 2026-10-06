// Shared TTC-geometry publication phase for both schedulers.
//
// This is the second of two publication phases. It runs *after* the incident
// phase has already committed `data/current.json`, so a slow or failed TTC stage
// cannot block or roll back the incident publication. It projects the confirmed
// diversion geometry into the data-branch checkout and commits only
// `data/ttc-diversions.json`.
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
import { execFileSync } from 'node:child_process';
import { publicTtcGeometry } from './publish-ttc-geometry.js';
import { readFile, mkdir, writeFile } from 'node:fs/promises';
import { dirname } from 'node:path';

function git(cwd, args) {
  return execFileSync('git', args, { cwd, encoding: 'utf8' }).trim();
}

// Project the confirmed geometry into `repoDir/data/ttc-diversions.json` and
// commit it when it changed. Returns a bounded result.
export async function publishTtcPhase({
  sourcePath = process.env.TTC_DIVERSION_OUTPUT || '.cache/ttc/diversions.json',
  repoDir = process.env.DATA_REPO_DIR || process.cwd(),
  log = entry => console.log(JSON.stringify(entry))
} = {}) {
  const geometry = publicTtcGeometry(JSON.parse(await readFile(sourcePath, 'utf8')));
  const target = resolve(repoDir, 'data/ttc-diversions.json');
  await mkdir(dirname(target), { recursive: true });
  await writeFile(target, `${JSON.stringify(geometry)}\n`);

  git(repoDir, ['add', '--', 'data/ttc-diversions.json']);
  if (!git(repoDir, ['diff', '--cached', '--name-only'])) {
    log({ source: 'ttc-publication', status: 'unchanged' });
    return { committed: false };
  }
  git(repoDir, ['-c', 'user.name=SirenTO updater', '-c', 'user.email=sirento-updater@localhost',
    'commit', '-m', 'chore: refresh public TTC geometry']);
  log({ source: 'ttc-publication', status: 'committed' });
  return { committed: true };
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  const result = await publishTtcPhase();
  console.log(result.committed ? 'TTC geometry committed' : 'No TTC geometry changes to commit');
}
