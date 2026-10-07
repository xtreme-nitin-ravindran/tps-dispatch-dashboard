// Swappable publication sink for the two data-publication phases.
//
// The publication *policy* (when to refresh) lives in `data-publication.js`. This
// module owns the *sink*: where a produced artifact is written and how its change
// is detected. Today the only production sink is the git `data` branch, but the
// interface is deliberately narrow so a future object-storage sink (Cloudflare
// R2) can replace it without touching the phase logic.
//
// A sink is a function:
//
//   publish({ key, body }) -> { changed }
//
// `key` is the repository-relative path of the artifact (for example
// `data/current.json`). `body` is the exact bytes to publish. `changed` reports
// whether the sink observed a difference from what was already published, so the
// caller can log committed/unchanged without re-deriving it.
//
// Two sinks are provided:
//
//   - `createGitSink` writes the body into a data-branch checkout and commits
//     only that key. This preserves the exact behavior of the previous inline
//     git logic (stage one path, commit only when it changed, require a clean
//     index). It is the production sink.
//   - `createLocalSink` writes the body into a plain directory with no git. It is
//     deterministic and dependency-free, so tests can assert published bytes
//     without a repository.
//
// Neither sink pushes. The push is owned by the scheduler (Concourse `put` with
// `rebase: true`; GitHub Actions `git pull --rebase && git push`).

import { execFileSync } from 'node:child_process';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';

// A git-backed sink that writes `key` into `repoDir` and commits only that path.
//
// `message` is the commit subject. `author`/`email` default to the shared updater
// identity used by the previous inline logic. The sink refuses to commit when the
// index already has staged changes, so it can never accidentally include another
// task's work.
export function createGitSink({
  repoDir = process.cwd(),
  message,
  author = process.env.GIT_AUTHOR_NAME || 'SirenTO updater',
  email = process.env.GIT_AUTHOR_EMAIL || 'sirento-updater@localhost'
} = {}) {
  const git = (...args) => execFileSync('git', args, { cwd: repoDir, encoding: 'utf8' }).trim();
  return async function publish({ key, body }) {
    const target = resolve(repoDir, key);
    await mkdir(dirname(target), { recursive: true });
    await writeFile(target, body);
    // Fail rather than accidentally include changes staged by another task.
    if (git('diff', '--cached', '--name-only')) throw new Error('Index must be clean before snapshot commit');
    git('add', '--', key);
    if (!git('diff', '--cached', '--name-only')) return { changed: false };
    git('-c', `user.name=${author}`, '-c', `user.email=${email}`, 'commit', '-m', message);
    return { changed: true };
  };
}

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
