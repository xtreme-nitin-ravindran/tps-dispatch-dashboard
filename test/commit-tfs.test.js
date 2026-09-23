import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { execFileSync } from 'node:child_process';
import { commitTfsSnapshot } from '../scripts/commit-tfs.js';

test('commits only snapshot changes, skips unchanged data, rejects staged unrelated files', async t => {
    const cwd = await mkdtemp(join(tmpdir(), 'tfs-git-'));
    t.after(() => rm(cwd, { recursive: true, force: true }));
    const git = (...args) => execFileSync('git', args, { cwd, encoding: 'utf8' }).trim();
    git('init', '-q');
    await mkdir(join(cwd, 'data'));
    await writeFile(join(cwd, 'data/current.json'), '{}');
    assert.equal(commitTfsSnapshot(cwd), true);
    assert.equal(commitTfsSnapshot(cwd), false);
    await writeFile(join(cwd, 'unrelated.txt'), 'do not commit');
    await writeFile(join(cwd, 'data/current.json'), '{"retentionHours":168}');
    assert.equal(commitTfsSnapshot(cwd), true);
    assert.equal(git('diff-tree', '--no-commit-id', '--name-only', '-r', 'HEAD'), 'data/current.json');
    assert.equal(git('log', '-1', '--format=%s'), 'chore: refresh SirenTO incidents');
    git('add', 'unrelated.txt');
    assert.throws(() => commitTfsSnapshot(cwd), /Index must be clean/);
});

test('snapshot commit CLI reports changed and unchanged snapshots', async t => {
    const cwd = await mkdtemp(join(tmpdir(), 'tfs-git-cli-'));
    t.after(() => rm(cwd, { recursive: true, force: true }));
    execFileSync('git', ['init', '-q'], { cwd });
    await mkdir(join(cwd, 'data'));
    await writeFile(join(cwd, 'data/current.json'), '{}');
    const script = join(process.cwd(), 'scripts/commit-tfs.js');
    assert.match(execFileSync(process.execPath, [script], { cwd, encoding:'utf8' }), /Committed/);
    assert.match(execFileSync(process.execPath, [script], { cwd, encoding:'utf8' }), /unchanged/);
});
