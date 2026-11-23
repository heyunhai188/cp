import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";

const dbFile = path.join(os.tmpdir(), `fc3d-archive-${process.pid}-${Date.now()}.sqlite`);
process.env.FC3D_DB = dbFile;

const { missingForecastWindows } = await import("./forecastArchive.js");
const { closeDatabase, getForecast, initDatabase, upsertDraws } = await import("./db.js");
const { ensureAdvanceForecasts } = await import("./forecastArchive.js");

test("a later draw is not visible when backfilling an earlier issue", () => {
  const draws = [
    { issue: "3", digits: [1, 1, 1] },
    { issue: "2", digits: [2, 2, 2] },
    { issue: "1", digits: [3, 3, 3] },
  ];
  const windows = missingForecastWindows(draws, ["3"]);
  assert.deepEqual(windows.map((item) => item.issue), ["2", "1"]);
  assert.deepEqual(windows[0].draws.map((item) => item.issue), ["2", "1"]);
});

test("missing recent issues are saved once and an existing archive stays", () => {
  initDatabase();
  upsertDraws("pl3", [
    { issue: "26309", drawDate: "2026-11-19", digits: [1, 2, 3], week: "周四" },
    { issue: "26310", drawDate: "2026-11-20", digits: [4, 5, 6], week: "周五" },
    { issue: "26311", drawDate: "2026-11-21", digits: [7, 8, 9], week: "周六" },
  ]);
  const first = ensureAdvanceForecasts("pl3", { lookback: 15, n: 100 });
  assert.deepEqual(first, ["26311", "26310", "26309"]);
  const kept = getForecast("pl3", "26311");
  const second = ensureAdvanceForecasts("pl3", { lookback: 15, n: 100 });
  assert.deepEqual(second, []);
  assert.equal(getForecast("pl3", "26311").createdAt, kept.createdAt);
  assert.equal(getForecast("pl3", "26310").basedIssue, "26310");
});

test.after(() => {
  closeDatabase();
  fs.rmSync(dbFile, { force: true });
});
