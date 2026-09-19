import { execFileSync } from 'node:child_process';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

export function commitTfsSnapshot(cwd = process.cwd()) {
    const git = (...args) => execFileSync('git', args, { cwd, encoding: 'utf8' }).trim();
    // Fail rather than accidentally include changes staged by another task.
    if (git('diff', '--cached', '--name-only')) throw new Error('Index must be clean before snapshot commit');
    git('add', '--', 'data/current.json');
    if (!git('diff', '--cached', '--name-only')) return false;
    git('-c', `user.name=${process.env.GIT_AUTHOR_NAME || 'SirenTO updater'}`,
        '-c', `user.email=${process.env.GIT_AUTHOR_EMAIL || 'sirento-updater@localhost'}`,
        'commit', '-m', 'chore: refresh SirenTO incidents');
    return true;
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
    console.log(commitTfsSnapshot() ? 'Committed SirenTO incident snapshot' : 'Snapshot unchanged; no commit needed');
}
