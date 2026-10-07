import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { execFile, execFileSync } from 'node:child_process';
import { promisify } from 'node:util';
import { fetchR2ToFile, runCli } from '../scripts/r2-fetch.js';

// The Concourse incident task seeds the ETL history input from the published R2
// snapshot instead of a git checkout. A missing object must be tolerated so the
// ETL can start fresh, exactly as it did when the git checkout was empty.

const env = { R2_ENDPOINT: 'https://x', R2_BUCKET: 'b', R2_ACCESS_KEY_ID: 'a', R2_SECRET_ACCESS_KEY: 's' };

test('fetchR2ToFile writes the object body to the output path', async t => {
  const dir = await mkdtemp(join(tmpdir(), 'r2-fetch-'));
  t.after(() => rm(dir, { recursive: true, force: true }));
  const outputPath = join(dir, 'history/current.json');
  const result = await fetchR2ToFile({
    key: 'data/current.json', outputPath, env,
    fetchObject: async () => '{"a":1}\n',
    log: () => {}
  });
  assert.deepEqual(result, { found: true, message: 'Fetched data/current.json' });
  assert.equal(await readFile(outputPath, 'utf8'), '{"a":1}\n');
});

test('fetchR2ToFile reports a missing object without writing a file', async t => {
  const dir = await mkdtemp(join(tmpdir(), 'r2-fetch-'));
  t.after(() => rm(dir, { recursive: true, force: true }));
  const outputPath = join(dir, 'history/current.json');
  const result = await fetchR2ToFile({
    key: 'data/current.json', outputPath, env,
    fetchObject: async () => undefined,
    log: () => {}
  });
  assert.deepEqual(result, { found: false, message: 'No object at data/current.json' });
  await assert.rejects(readFile(outputPath, 'utf8'), /ENOENT/);
});

test('fetchR2ToFile passes the configured region and credentials to the fetcher', async t => {
  const dir = await mkdtemp(join(tmpdir(), 'r2-fetch-'));
  t.after(() => rm(dir, { recursive: true, force: true }));
  let seen;
  await fetchR2ToFile({
    key: 'data/current.json', outputPath: join(dir, 'out.json'),
    env: { ...env, R2_REGION: 'weur' },
    fetchObject: async options => { seen = options; return 'x'; },
    log: () => {}
  });
  assert.deepEqual(seen, { endpoint: 'https://x', bucket: 'b', accessKeyId: 'a', secretAccessKey: 's', region: 'weur', key: 'data/current.json' });
});

test('fetchR2ToFile uses the default logger when none is injected', async t => {
  const dir = await mkdtemp(join(tmpdir(), 'r2-fetch-'));
  t.after(() => rm(dir, { recursive: true, force: true }));
  const logs = [];
  const original = console.log;
  console.log = entry => logs.push(entry);
  try {
    await fetchR2ToFile({
      key: 'data/current.json', outputPath: join(dir, 'out.json'), env,
      fetchObject: async () => 'x'
    });
  } finally {
    console.log = original;
  }
  assert.deepEqual(logs, ['{"source":"r2-fetch","key":"data/current.json","status":"fetched"}']);
});

test('the r2-fetch CLI requires a key and output path', () => {
  const script = new URL('../scripts/r2-fetch.js', import.meta.url).pathname;
  assert.throws(() => execFileSync(process.execPath, [script], { encoding: 'utf8', stdio: 'pipe' }), /usage/);
  // A key without an output path is also a usage error.
  assert.throws(() => execFileSync(process.execPath, [script, 'data/current.json'], { encoding: 'utf8', stdio: 'pipe' }), /usage/);
});

test('the r2-fetch CLI reports a missing object', async t => {
  const dir = await mkdtemp(join(tmpdir(), 'r2-fetch-cli-'));
  t.after(() => rm(dir, { recursive: true, force: true }));
  const script = new URL('../scripts/r2-fetch.js', import.meta.url).pathname;
  // Point at an unreachable endpoint so the fetch fails; the CLI must surface it.
  const cliEnv = { ...process.env, R2_ENDPOINT: 'http://127.0.0.1:1', R2_BUCKET: 'b', R2_ACCESS_KEY_ID: 'a', R2_SECRET_ACCESS_KEY: 's' };
  assert.throws(() => execFileSync(process.execPath, [script, 'data/current.json', join(dir, 'out.json')], { encoding: 'utf8', env: cliEnv, stdio: 'pipe' }));
});

test('runCli prints the usage error and exits 2 when arguments are missing', async () => {
  const errors = [];
  const exits = [];
  const result = await runCli({
    argv: ['node', 'r2-fetch.js'],
    err: line => errors.push(line),
    exit: code => { exits.push(code); return code; }
  });
  assert.equal(result, 2);
  assert.deepEqual(errors, ['usage: node scripts/r2-fetch.js <key> <output-path>']);
  assert.deepEqual(exits, [2]);
});

test('runCli fetches and prints the result message', async () => {
  const lines = [];
  const result = await runCli({
    argv: ['node', 'r2-fetch.js', 'data/current.json', '/tmp/out.json'],
    fetch: async ({ key, outputPath }) => ({ found: true, message: `Fetched ${key} to ${outputPath}` }),
    out: line => lines.push(line)
  });
  assert.deepEqual(result, { found: true, message: 'Fetched data/current.json to /tmp/out.json' });
  assert.deepEqual(lines, ['Fetched data/current.json to /tmp/out.json']);
});

test('the r2-fetch CLI fetches an object from a reachable endpoint', async t => {
  // A successful CLI run reaches the guard body and exits normally, so the
  // entry-point path is covered and its coverage is flushed. The server runs in
  // this process, so the CLI is spawned asynchronously to keep the event loop
  // free to serve the request.
  const dir = await mkdtemp(join(tmpdir(), 'r2-fetch-cli-'));
  t.after(() => rm(dir, { recursive: true, force: true }));
  const { createServer } = await import('node:http');
  const server = createServer((req, res) => {
    res.writeHead(200, { 'content-type': 'application/json' });
    res.end('{"a":1}\n');
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  t.after(() => server.close());
  const { port } = server.address();
  const script = new URL('../scripts/r2-fetch.js', import.meta.url).pathname;
  const outputPath = join(dir, 'out.json');
  const cliEnv = { ...process.env, R2_ENDPOINT: `http://127.0.0.1:${port}`, R2_BUCKET: 'b', R2_ACCESS_KEY_ID: 'a', R2_SECRET_ACCESS_KEY: 's' };
  const { stdout } = await promisify(execFile)(process.execPath, [script, 'data/current.json', outputPath], { encoding: 'utf8', env: cliEnv });
  assert.match(stdout, /Fetched data\/current\.json/);
  assert.equal(await readFile(outputPath, 'utf8'), '{"a":1}\n');
});
