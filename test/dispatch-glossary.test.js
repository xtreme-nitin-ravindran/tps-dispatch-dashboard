import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { DISPATCH_GLOSSARY_FOOTER, glossaryDefinition } from "../src/dispatch-glossary.js";

const [html, app] = await Promise.all([
  readFile(new URL("../index.html", import.meta.url), "utf8"),
  readFile(new URL("../app.js", import.meta.url), "utf8")
]);

test("known terms have a plain-language glossary definition and unknown terms do not", () => {
  assert.equal(glossaryDefinition(" medical "), "A call for medical assistance.");
  assert.match(glossaryDefinition("personal injury collision"), /initially reported to involve an injury/);
  assert.equal(glossaryDefinition("NEW DISPATCH CODE"), "");
  assert.equal(glossaryDefinition("constructor"), "");
});

test("only known terms reveal the glossary affordance and its correct explanation", () => {
  assert.match(html, /class="glossary-trigger"[^>]*hidden/);
  assert.match(app, /const glossaryText = glossaryDefinition\(call\.description\);[\s\S]*?if \(glossaryText\) \{[\s\S]*?trigger\.hidden = false/);
  assert.match(app, /querySelector\("\.glossary-definition"\)\.textContent = glossaryText/);
  assert.match(app, /querySelector\("\.glossary-footer"\)\.textContent = DISPATCH_GLOSSARY_FOOTER/);
  assert.match(DISPATCH_GLOSSARY_FOOTER, /initial call classification and may change/);
});

test("popover uses an accessible button relationship and supports dismissal", () => {
  assert.match(html, /button class="glossary-trigger" type="button" aria-expanded="false"/);
  assert.match(html, /class="glossary-popover" role="tooltip" hidden/);
  assert.match(app, /trigger\.setAttribute\("aria-controls", glossaryId\)/);
  assert.match(app, /trigger\.setAttribute\("aria-expanded", String\(opening\)\)/);
  assert.match(app, /if \(!event\.target\.closest\("\.glossary-popover"\)\) closeGlossaryPopovers\(\)/);
  assert.match(app, /event\.key !== "Escape"[\s\S]*?closeGlossaryPopovers\(\);[\s\S]*?trigger\.focus\(\)/);
});

test("glossary controls do not activate keyboard or pointer card selection", () => {
  assert.match(app, /summary, \.glossary-trigger, \.glossary-popover/);
  assert.match(app, /\.show-map-hint, \.glossary-trigger, \.glossary-popover/);
});
