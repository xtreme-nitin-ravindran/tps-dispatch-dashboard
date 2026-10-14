import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { escapeHtml } from "../src/html-escape.js";

const app = await readFile(new URL("../src/app/app.js", import.meta.url), "utf8");

test("[STORY-72] escapeHtml escapes every HTML meta-character", () => {
  assert.equal(escapeHtml("<script>alert('x')</script>"),
    "&lt;script&gt;alert(&#39;x&#39;)&lt;/script&gt;");
  assert.equal(escapeHtml('a & b "c" <d>'), "a &amp; b &quot;c&quot; &lt;d&gt;");
});

test("[STORY-72] escapeHtml escapes the ampersand first so entities are not double-escaped", () => {
  // "&lt;" must become "&amp;lt;", not "&lt;" (which would re-decode to "<").
  assert.equal(escapeHtml("&lt;"), "&amp;lt;");
  assert.equal(escapeHtml("&amp;"), "&amp;amp;");
});

test("[STORY-72] escapeHtml normalizes nullish and non-string input to an empty string", () => {
  assert.equal(escapeHtml(null), "");
  assert.equal(escapeHtml(undefined), "");
  assert.equal(escapeHtml(0), "0");
  assert.equal(escapeHtml(false), "false");
});

test("[STORY-72] dynamic innerHTML sinks escape their interpolated values", () => {
  // The division filter, the load-error message, and the unit list all interpolate
  // untrusted values into innerHTML and must use escapeHtml, never escapeText.
  assert.match(app, /divisions\.map\(d => `<option value="\$\{encodeURIComponent\(d\)\}">\$\{escapeHtml\(d\)\}<\/option>`\)/);
  assert.match(app, /<p>\$\{escapeHtml\(error\.message\)\}<\/p>/);
  assert.match(app, /`<div><strong>\$\{escapeHtml\(group\.type\)\}:<\/strong> \$\{escapeHtml\(group\.values\)\}<\/div>`/);
  assert.doesNotMatch(app, /innerHTML[\s\S]{0,200}escapeText\(/);
});
