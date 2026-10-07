import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { execFileSync } from 'node:child_process';
import { createGitSink, createLocalSink } from '../scripts/lib/publication-sink.js';

// --- Local sink -------------------------------------------------------------

test('the local sink writes the body and reports the first write as changed', async t => {
  const dir = await mkdtemp(join(tmpdir(), 'local-sink-'));
  t.after(() => rm(dir, { recursive: true, force: true }));
  const sink = createLocalSink({ dir });
  const result = await sink({ key: 'data/current.json', body: '{"a":1}\n' });
  assert.deepEqual(result, { changed: true });
  assert.equal(await readFile(join(dir, 'data/current.json'), 'utf8'), '{"a":1}\n');
});

test('the local sink reports an identical rewrite as unchanged', async t => {
  const dir = await mkdtemp(join(tmpdir(), 'local-sink-'));
  t.after(() => rm(dir, { recursive: true, force: true }));
  const sink = createLocalSink({ dir });
  await sink({ key: 'data/current.json', body: '{"a":1}\n' });
  assert.deepEqual(await sink({ key: 'data/current.json', body: '{"a":1}\n' }), { changed: false });
});

test('the local sink reports a differing rewrite as changed', async t => {
  const dir = await mkdtemp(join(tmpdir(), 'local-sink-'));
  t.after(() => rm(dir, { recursive: true, force: true }));
  const sink = createLocalSink({ dir });
  await sink({ key: 'data/current.json', body: '{"a":1}\n' });
  assert.deepEqual(await sink({ key: 'data/current.json', body: '{"a":2}\n' }), { changed: true });
  assert.equal(await readFile(join(dir, 'data/current.json'), 'utf8'), '{"a":2}\n');
});

test('the local sink creates nested directories and defaults to the current directory', async t => {
  const dir = await mkdtemp(join(tmpdir(), 'local-sink-'));
  t.after(() => rm(dir, { recursive: true, force: true }));
  const sink = createLocalSink({ dir });
  await sink({ key: 'deep/nested/artifact.json', body: 'x' });
  assert.equal(await readFile(join(dir, 'deep/nested/artifact.json'), 'utf8'), 'x');
  // Default dir is the current working directory.
  const previous = process.cwd();
  process.chdir(dir);
  try {
    const defaultSink = createLocalSink();
    await defaultSink({ key: 'default.json', body: 'y' });
    assert.equal(await readFile(join(dir, 'default.json'), 'utf8'), 'y');
  } finally {
    process.chdir(previous);
  }
});

// --- Git sink ---------------------------------------------------------------

async function seededRepo(t) {
  const dir = await mkdtemp(join(tmpdir(), 'git-sink-'));
  t.after(() => rm(dir, { recursive: true, force: true }));
  const git = (...args) => execFileSync('git', args, { cwd: dir, encoding: 'utf8' }).trim();
  execFileSync('git', ['init', '-q', dir]);
  git('config', 'user.name', 'test');
  git('config', 'user.email', 'test@example.com');
  await mkdir(join(dir, 'data'), { recursive: true });
  await writeFile(join(dir, 'data/current.json'), '{}\n');
  git('add', '-A');
  git('commit', '-q', '-m', 'seed');
  return { dir, git };
}

test('the git sink writes, stages, and commits only the given key', async t => {
  const { dir, git } = await seededRepo(t);
  const sink = createGitSink({ repoDir: dir, message: 'chore: refresh SirenTO incidents' });
  const result = await sink({ key: 'data/current.json', body: '{"retentionHours":168}\n' });
  assert.deepEqual(result, { changed: true });
  assert.equal(await readFile(join(dir, 'data/current.json'), 'utf8'), '{"retentionHours":168}\n');
  assert.equal(git('diff-tree', '--no-commit-id', '--name-only', '-r', 'HEAD'), 'data/current.json');
  assert.equal(git('log', '-1', '--format=%s'), 'chore: refresh SirenTO incidents');
});

test('the git sink makes no commit when the body is unchanged', async t => {
  const { dir, git } = await seededRepo(t);
  const sink = createGitSink({ repoDir: dir, message: 'chore: refresh SirenTO incidents' });
  const before = git('rev-parse', 'HEAD');
  assert.deepEqual(await sink({ key: 'data/current.json', body: '{}\n' }), { changed: false });
  assert.equal(git('rev-parse', 'HEAD'), before);
});

test('the git sink refuses to commit when the index already has staged changes', async t => {
  const { dir, git } = await seededRepo(t);
  await writeFile(join(dir, 'unrelated.txt'), 'do not commit');
  git('add', 'unrelated.txt');
  const sink = createGitSink({ repoDir: dir, message: 'chore: refresh SirenTO incidents' });
  await assert.rejects(sink({ key: 'data/current.json', body: '{"a":1}\n' }), /Index must be clean/);
});

test('the git sink honors a custom author and email', async t => {
  const { dir, git } = await seededRepo(t);
  const sink = createGitSink({
    repoDir: dir, message: 'chore: refresh public TTC geometry',
    author: 'github-actions[bot]', email: '41898282+github-actions[bot]@users.noreply.github.com'
  });
  await sink({ key: 'data/current.json', body: '{"a":1}\n' });
  assert.equal(git('log', '-1', '--format=%an <%ae>'), 'github-actions[bot] <41898282+github-actions[bot]@users.noreply.github.com>');
});

test('the git sink defaults its repo dir, author, and email', async t => {
  const { dir, git } = await seededRepo(t);
  const previous = process.cwd();
  process.chdir(dir);
  try {
    const sink = createGitSink({ message: 'chore: refresh SirenTO incidents' });
    await sink({ key: 'data/current.json', body: '{"a":1}\n' });
    assert.equal(git('log', '-1', '--format=%an <%ae>'), 'SirenTO updater <sirento-updater@localhost>');
  } finally {
    process.chdir(previous);
  }
});
