import test from "node:test";
import assert from "node:assert/strict";
import { historyWindowLabel } from "../src/history-window.js";

test("history window label names the special multi-day windows", () => {
  assert.equal(historyWindowLabel(168), "Last 7 days");
  assert.equal(historyWindowLabel(72), "Last 3 days");
});

test("history window label falls back to an hour count", () => {
  assert.equal(historyWindowLabel(1), "Last 1h");
  assert.equal(historyWindowLabel(6), "Last 6h");
  assert.equal(historyWindowLabel(24), "Last 24h");
});
