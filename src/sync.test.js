// 翻页策略：首次只取最新若干期，增量同步在重叠处停下，补历史不把已有期再算成新增。
import assert from "node:assert/strict";
import test from "node:test";
import { officialDrawIsToday, planSync, syncMessage } from "./sync.js";

function pagesOf(total, pageSize) {
  const issues = Array.from({ length: total }, (_, index) => ({ issue: String(total - index) }));
  return async (page) => {
    const start = (page - 1) * pageSize;
    return { total, result: issues.slice(start, start + pageSize) };
  };
}

test("first sync keeps the newest limit", async () => {
  const planned = await planSync({
    mode: "auto",
    known: new Set(),
    limit: 3,
    pageSize: 2,
    fetchPage: pagesOf(6, 2),
  });
  assert.deepEqual(planned.rows.map((row) => row.issue), ["6", "5", "4"]);
});

test("incremental sync stops when the page overlaps stored issues", async () => {
  let calls = 0;
  const fetchPage = async (page) => {
    calls += 1;
    return pagesOf(6, 2)(page);
  };
  const planned = await planSync({
    mode: "auto",
    known: new Set(["5", "4", "3", "2", "1"]),
    limit: 500,
    pageSize: 2,
    fetchPage,
  });
  assert.equal(calls, 1);
  assert.deepEqual(planned.rows.map((row) => row.issue), ["6", "5"]);
});

test("backfill reads the older gap without treating a full archive as new", async () => {
  const known = new Set(["6", "5"]);
  const planned = await planSync({
    mode: "backfill",
    known,
    limit: 2,
    pageSize: 2,
    fetchPage: pagesOf(6, 2),
  });
  assert.deepEqual(planned.rows.map((row) => row.issue), ["4", "3"]);

  const done = await planSync({
    mode: "backfill",
    known: new Set(["6", "5", "4", "3", "2", "1"]),
    limit: 2,
    pageSize: 2,
    fetchPage: pagesOf(6, 2),
  });
  assert.equal(done.complete, true);
  assert.deepEqual(done.rows, []);
  assert.equal(syncMessage("backfill", { inserted: 0, updated: 0 }, done), "官网已公布的期数都在本地了。");
  assert.equal(syncMessage("auto", { inserted: 12, updated: 0 }, { complete: false }), "新增 12 期。");
  assert.equal(syncMessage("backfill", { inserted: 500, updated: 1 }, { complete: false }), "新增 500 期，更正 1 期。");
});

test("nightly sync stays open until the official latest draw is today", () => {
  assert.equal(officialDrawIsToday("2026-11-15", "2026-11-16"), false);
  assert.equal(officialDrawIsToday("", "2026-11-16"), false);
  assert.equal(officialDrawIsToday("2026-11-16", "2026-11-16"), true);
});
