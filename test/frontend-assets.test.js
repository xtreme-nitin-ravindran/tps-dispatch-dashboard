import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile, stat } from 'node:fs/promises';

const root = new URL('../', import.meta.url);

test('relocated browser entry resolves every static and deferred local module', async () => {
  const entry = new URL('src/app/app.js', root);
  const source = await readFile(entry, 'utf8');
  const imports = [...source.matchAll(/(?:from\s*|import\s*\()(["'])(\.[^"']+)\1/g)];
  assert.ok(imports.length > 30);
  for (const [, , path] of imports) {
    const module = new URL(path, entry);
    module.search = '';
    assert.ok((await stat(module)).isFile(), `${path} must resolve relative to the relocated entry`);
  }
});

test('local app-shell styles, scripts, and images resolve from root and project URLs', async () => {
  const html = await readFile(new URL('index.html', root), 'utf8');
  const paths = [...html.matchAll(/(?:src|href)="(\.\/[^"?#]+)(?:[?#][^"]*)?"/g)].map(match => match[1]);
  assert.ok(paths.includes('./src/app/app.js'));
  assert.ok(paths.includes('./assets/css/styles.css'));
  assert.ok(paths.includes('./assets/images/curious-cat.jpg'));
  for (const path of paths) {
    assert.ok((await stat(new URL(path, root))).isFile(), `${path} must exist`);
    assert.ok(new URL(path, 'https://example.test/sirento/').pathname.startsWith('/sirento/'));
  }
});
