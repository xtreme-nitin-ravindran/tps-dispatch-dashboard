import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

// [STORY-74] The Story 74 cascade-override trap (a later equal-specificity
// `.disruption-item` padding rule silently overrode `.closure-detail` inside
// Leaflet popups) is guarded structurally here: the popup overrides live in one
// marked block, unqualified shared-class padding rules must precede it, and the
// shared chrome rules stay colocated.

const css = readFileSync(new URL('../assets/css/styles.css', import.meta.url), 'utf8');

function rulePosition(selectorBody, cssText = css) {
  const index = cssText.indexOf(selectorBody);
  return index === -1 ? null : index;
}

test('[STORY-74] popup overrides live in one marked block with scoped parity rules', () => {
  const marker = '/* Leaflet popup overrides — the single home for bubble styles (Story 74).';
  const popupBlock = rulePosition(marker);
  assert.ok(popupBlock !== null, 'popup override block is missing its single-home marker');
  const scopedPadding = rulePosition('.leaflet-popup-content .closure-detail { width: 100%; padding: 16px; }');
  const scopedBorder = rulePosition('.leaflet-popup-content .disruption-item { border-bottom: 0; }');
  assert.ok(scopedPadding !== null && scopedPadding > popupBlock, 'scoped closure-detail parity rule must follow the block marker');
  assert.ok(scopedBorder !== null && scopedBorder > popupBlock, 'scoped disruption-item border reset must follow the block marker');
});

test('[STORY-74] unqualified shared-class padding rules cannot win over the popup overrides', () => {
  const popupBlock = rulePosition('/* Leaflet popup overrides — the single home for bubble styles (Story 74).');
  // The trap rule: a single-class `.disruption-item` block that sets padding.
  const matches = [...css.matchAll(/\.disruption-item\s*\{[^}]*padding[^}]*\}/g)].map(match => match.index);
  assert.ok(matches.length >= 1, 'expected at least one .disruption-item padding rule');
  assert.ok(Math.max(...matches) < popupBlock, 'a .disruption-item padding rule appears after the popup overrides and can win the cascade');
});

test('[STORY-74] shared detail chrome stays colocated and the TTC variant mirrors the road chrome', () => {
  const roadTitle = rulePosition('.closure-detail h3 { margin: 7px 0 12px; font-size: 18px; }');
  const ttcTitle = rulePosition('.ttc-detail.closure-detail > h4 { margin: 7px 0 12px; font-size: 18px; }');
  assert.ok(roadTitle !== null && ttcTitle !== null, 'road and TTC title chrome rules must both exist');
  assert.ok(ttcTitle > roadTitle, 'the TTC title chrome must sit with the road chrome');
  assert.ok(css.slice(roadTitle, ttcTitle).length < 200, 'the TTC title chrome drifted away from the road chrome');
});
