import test from 'node:test';
import assert from 'node:assert/strict';
import { createMapPopups } from '../src/map-popups.js';

// [STORY-74] The popup controller closes and drops lingering Leaflet wrappers
// before every open, making the single-bubble contract deterministic across all
// four popup surfaces (roads, TTC, boundaries, incidents).

function fakeMap() {
  const calls = { closePopup: 0, openPopup: [] };
  const map = {
    closePopup() { calls.closePopup++; },
    openPopup(content, anchor, options) { calls.openPopup.push({ content, anchor, options }); }
  };
  return { map, calls };
}

function withDocument(nodes) {
  const original = globalThis.document;
  const removed = [];
  globalThis.document = {
    querySelectorAll() {
      return nodes.map(value => ({ value, remove() { removed.push(value); } }));
    }
  };
  return {
    removed,
    restore() { globalThis.document = original; }
  };
}

test('[STORY-74] closeImmediately closes the map popup and drops every lingering wrapper', () => {
  const stub = withDocument([]);
  const { map, calls } = fakeMap();
  try {
    createMapPopups(map).closeImmediately();
    assert.equal(calls.closePopup, 1);
    assert.deepEqual(stub.removed, []);
  } finally { stub.restore(); }
  const many = withDocument(['a', 'b', 'c']);
  try {
    createMapPopups(map).closeImmediately();
    assert.deepEqual(many.removed, ['a', 'b', 'c']);
  } finally { many.restore(); }
});

test('[STORY-74] closeImmediately tolerates a missing map and a map without closePopup', () => {
  const stub = withDocument(['a']);
  try {
    createMapPopups(null).closeImmediately();
    createMapPopups({}).closeImmediately();
    assert.deepEqual(stub.removed, ['a', 'a']);
  } finally { stub.restore(); }
});

test('[STORY-74] openAt refuses without a map or an anchor and opens with both', () => {
  const stub = withDocument([]);
  const { map, calls } = fakeMap();
  try {
    const popups = createMapPopups(map);
    assert.equal(createMapPopups(null).openAt('content', [43.7, -79.4]), false);
    assert.equal(popups.openAt('content', null), false);
    assert.equal(popups.openAt('detail', [43.7, -79.4]), true);
    assert.equal(popups.openAt('detail', [43.7, -79.4], { minWidth: 280 }), true);
    assert.equal(calls.closePopup, 2);
    assert.equal(calls.openPopup.length, 2);
    assert.deepEqual(calls.openPopup[0], {
      content: 'detail',
      anchor: [43.7, -79.4],
      options: { minWidth: 260, maxWidth: 340, closeOnClick: false }
    });
    assert.deepEqual(calls.openPopup[1], {
      content: 'detail',
      anchor: [43.7, -79.4],
      options: { minWidth: 280, maxWidth: 340, closeOnClick: false }
    });
  } finally { stub.restore(); }
});

test('[STORY-74] openBound refuses a null or unbindable layer and binds with merged options', () => {
  const stub = withDocument([]);
  const { map, calls } = fakeMap();
  try {
    const popups = createMapPopups(map);
    assert.equal(popups.openBound('detail', null), false);
    assert.equal(popups.openBound('detail', {}), false);
    let opened = 0;
    let boundOptions = null;
    const layer = {
      bindPopup(content, options) {
        boundOptions = { content, options };
        return { openPopup() { opened++; } };
      }
    };
    assert.equal(popups.openBound('detail', layer), true);
    assert.equal(calls.closePopup, 1);
    assert.equal(opened, 1);
    assert.deepEqual(boundOptions, { content: 'detail', options: { minWidth: 260, maxWidth: 340, closeOnClick: false } });
  } finally { stub.restore(); }
});


test('[STORY-74] resizing updates only the currently open popup and ignores closed bubbles', () => {
  const handlers = new Map();
  const { map } = fakeMap();
  map.on = (event, callback) => handlers.set(event, callback);
  const stub = withDocument([]);
  try {
    const popups = createMapPopups(map);
    assert.equal(popups.updateOptions({ maxHeight: 180 }), false);
    assert.equal(popups.updateContent('closed detail'), false);
    let updates = 0;
    const popup = { options: { minWidth: 260 }, update() { updates++; }, setContent(content) { this.content = content; } };
    handlers.get('popupopen')({ popup });
    assert.equal(popups.updateOptions({ maxHeight: 180 }), true);
    assert.deepEqual(popup.options, { minWidth: 260, maxHeight: 180 });
    assert.equal(updates, 1);
    assert.equal(popups.updateContent('refreshed detail'), true);
    assert.equal(popup.content, 'refreshed detail');
    handlers.get('popupclose')();
    assert.equal(popups.updateOptions({ maxHeight: 240 }), false);
    handlers.get('popupopen')({ popup });
    popups.closeImmediately();
    assert.equal(popups.updateOptions({ maxHeight: 240 }), false);
    assert.equal(updates, 1);
  } finally { stub.restore(); }
});
