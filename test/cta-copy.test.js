import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { nearbyCtaCopy } from '../src/cta-copy.js';

const [html, app] = await Promise.all([
  readFile(new URL('../index.html', import.meta.url), 'utf8'),
  readFile(new URL('../app.js', import.meta.url), 'utf8')
]);

test('nearby entry points use clear, accessible action labels', () => {
  assert.match(html, new RegExp(`<button id="nearMe" type="button">${nearbyCtaCopy.primary.replace('?', '\\?')}<\\/button>`));
  assert.match(html, new RegExp(`<button id="hearSirens" type="button" aria-label="Find nearby calls that may explain sirens">${nearbyCtaCopy.sirens.replace('?', '\\?')}<\\/button>`));
  assert.doesNotMatch(html, /<button id="nearMe"[^>]*aria-label=/);
});

test('nearby CTA wording remains consistent through location states', () => {
  assert.match(app, /nearButton\.textContent = nearbyCtaCopy\.loading/);
  assert.match(app, /nearButton\.textContent = nearbyCtaCopy\.refresh/);
  assert.match(app, /nearButton\.textContent = state\.nearby \? nearbyCtaCopy\.refresh : nearbyCtaCopy\.primary/);
  assert.match(app, /hearSirensButton\.addEventListener\('click'/);
});

test('replaced generic and implementation-oriented labels are absent', () => {
  const renderedCopy = `${html}\n${app}`;
  assert.doesNotMatch(renderedCopy, /Update nearby calls|Load incidents|Query calls/i);
});
