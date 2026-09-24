import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { INCIDENT_BADGE_CONFIG, incidentBadge, incidentBadgeExpiry } from "../src/incident-badge.js";
import { applyIncidentLifecycle, hasMeaningfulIncidentChange } from "../src/incident-lifecycle.js";

const firstSeenAt = "2026-09-24T12:00:00.000Z";
const firstSeen = Date.parse(firstSeenAt);

test("NEW lasts for the configured window and exposes its exact expiry", () => {
  const incident = { firstSeenAt };
  assert.equal(INCIDENT_BADGE_CONFIG.newWindowMs, 300_000);
  assert.equal(incidentBadge(incident, firstSeen), "NEW");
  assert.equal(incidentBadge(incident, firstSeen + 299_999), "NEW");
  assert.equal(incidentBadgeExpiry(incident, firstSeen), firstSeen + 300_000);
  assert.equal(incidentBadge(incident, firstSeen + 300_000), null);
  assert.equal(incidentBadgeExpiry(incident, firstSeen + 300_000), null);
  assert.equal(incidentBadge({ firstSeenAt }, firstSeen - 1), null);
  assert.equal(incidentBadge({ firstSeenAt: "invalid" }, firstSeen), null);
});

test("UPDATED takes precedence and persists after the NEW window", () => {
  const incident = { firstSeenAt, lastMeaningfulUpdateAt: new Date(firstSeen + 1_000) };
  assert.equal(incidentBadge(incident, firstSeen + 2_000), "UPDATED");
  assert.equal(incidentBadgeExpiry(incident, firstSeen + 2_000), null);
  assert.equal(incidentBadge({ lastMeaningfulUpdateAt: firstSeenAt }, firstSeen), "UPDATED");
  assert.equal(incidentBadge({ firstSeenAt, lastMeaningfulUpdateAt: firstSeenAt }, firstSeen), "NEW");
});

test("lifecycle metadata survives refreshes and records only meaningful changes", () => {
  const now = new Date(firstSeenAt);
  const original = applyIncidentLifecycle({ id: "F1", description: "Fire", vehicles: [] }, null, now);
  assert.equal(original.firstSeenAt, firstSeenAt);
  assert.equal(original.lastMeaningfulUpdateAt, undefined);

  const unchanged = applyIncidentLifecycle({ id: "F1", description: "Fire", vehicles: [] }, original, new Date(firstSeen + 60_000));
  assert.equal(unchanged.firstSeenAt, firstSeenAt);
  assert.equal(unchanged.lastMeaningfulUpdateAt, undefined);

  const changed = applyIncidentLifecycle({ id: "F1", description: "Fire", vehicles: [{ type: "Truck" }] }, unchanged, new Date(firstSeen + 120_000));
  assert.equal(changed.lastMeaningfulUpdateAt, "2026-09-24T12:02:00.000Z");
  assert.equal(hasMeaningfulIncidentChange(changed, { ...changed, firstSeenAt: "later" }), false);
  assert.equal(hasMeaningfulIncidentChange(
    { vehicles: [{ type: "Truck", numbers: ["2", "1"] }, { type: "Rescue" }, { numbers: [] }] },
    { vehicles: [{ numbers: [] }, { type: "Rescue", numbers: [] }, { type: "Truck", numbers: ["1", "2"] }] }
  ), false);

  const legacy = applyIncidentLifecycle({ id: "F2", description: "Same" }, { id: "F2", timestamp: "2026-09-24T11:00:00.000Z", description: "Same" }, now);
  assert.equal(legacy.firstSeenAt, "2026-09-24T11:00:00.000Z");
});

test("cards render compact change badges and schedule NEW expiry", async () => {
  const [app, html, css] = await Promise.all([
    readFile(new URL("../app.js", import.meta.url), "utf8"),
    readFile(new URL("../index.html", import.meta.url), "utf8"),
    readFile(new URL("../styles.css", import.meta.url), "utf8")
  ]);
  assert.match(html, /class="incident-change-badge" hidden/);
  assert.match(app, /incidentBadge\(call\)/);
  assert.match(app, /setTimeout\(updateIncidentBadges/);
  assert.match(css, /\.incident-change-badge--updated/);
});
