// 用临时库，不碰 data/app.sqlite。覆盖、彩种隔离、预设规则只种一次都在这里。
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";

const dbFile = path.join(os.tmpdir(), `fc3d-${process.pid}-${Date.now()}.sqlite`);
process.env.FC3D_DB = dbFile;

const {
  closeDatabase,
  createRule,
  deleteRule,
  getDraws,
  initDatabase,
  listForecasts,
  listRules,
  queryDraws,
  listUsers,
  saveExpertPick,
  saveForecast,
  setUserRecommend,
  trimOldestDraws,
  retainNewestDraws,
  upsertDraws,
} = await import("./db.js");

test("store draws by lottery and issue, keep extension data, and overwrite", () => {
  initDatabase();
  const first = upsertDraws("fc3d", [
    { issue: "2026001", drawDate: "2026-01-01", digits: [1, 2, 3], week: "四", sales: "1" },
    { issue: "2026002", drawDate: "2026-01-02", digits: [1, 9, 0], week: "五", sales: "2" },
  ]);
  assert.equal(first.inserted, 2);
  assert.equal(getDraws("fc3d")[0].issue, "2026002");
  assert.equal(getDraws("fc3d")[0].week, "五");
  assert.equal(getDraws("fc3d")[0].sales, "2");

  const same = upsertDraws("fc3d", [
    { issue: "2026002", drawDate: "2026-01-02", digits: [1, 9, 0], week: "五", sales: "2" },
  ]);
  assert.deepEqual(same, { inserted: 0, updated: 0 });

  const changed = upsertDraws("fc3d", [
    { issue: "2026002", drawDate: "2026-01-02", digits: [8, 8, 8], week: "五", sales: "9" },
  ]);
  assert.equal(changed.updated, 1);
  assert.deepEqual(getDraws("fc3d")[0].digits, [8, 8, 8]);

  upsertDraws("pl5", [
    { issue: "2026002", drawDate: "2026-01-02", digits: [1, 2, 3, 4, 5], week: "", sales: "" },
  ]);
  assert.equal(getDraws("fc3d").find((draw) => draw.issue === "2026002").digits.join(""), "888");
  assert.deepEqual(getDraws("pl5")[0].digits, [1, 2, 3, 4, 5]);
  assert.equal(listRules("pl5").map((rule) => rule.name).includes("全双"), true);
  assert.equal(listRules("pl5").some((rule) => rule.name === "豹子"), false);
  const found = queryDraws({ number: "12345", lotteryCode: "pl5" });
  assert.equal(found.total, 1);
  assert.equal(found.rows[0].lotteryCode, "pl5");
  assert.equal(queryDraws({ number: "888", lotteryCode: "fc3d" }).total, 1);
});

test("rules can be added and removed without reseeding presets", () => {
  const before = listRules("fc3d").map((rule) => rule.name);
  assert.ok(before.includes("单单双"));
  assert.ok(before.includes("双双双"));
  const created = createRule("fc3d", "百9", { positions: [{ digits: [9] }, {}, {}] });
  assert.equal(listRules("fc3d")[0].id, created.id);
  deleteRule(created.id);
  assert.equal(listRules("fc3d").some((rule) => rule.id === created.id), false);
});

test("trimming removes only the oldest draws of one lottery", () => {
  upsertDraws("fc3d", [
    { issue: "2026001", drawDate: "2026-01-01", digits: [1, 2, 3], week: "四" },
    { issue: "2026002", drawDate: "2026-01-02", digits: [4, 5, 6], week: "五" },
    { issue: "2026003", drawDate: "2026-01-03", digits: [7, 8, 9], week: "六" },
  ]);
  upsertDraws("pl3", [
    { issue: "26001", drawDate: "2026-01-01", digits: [0, 0, 1], week: "四" },
  ]);
  assert.throws(() => trimOldestDraws("fc3d", 3, "删除最旧开奖"), /至少要保留最新 1 期/);
  const trimmed = trimOldestDraws("fc3d", 1, "删除最旧开奖");
  assert.equal(trimmed.removed, 1);
  assert.equal(trimmed.remaining, 2);
  assert.deepEqual(getDraws("fc3d").map((draw) => draw.issue), ["2026003", "2026002"]);
  assert.equal(getDraws("pl3")[0].issue, "26001");
});

test("keeping the newest draws drops the oldest and leaves another lottery alone", () => {
  upsertDraws("fc3d", [
    { issue: "2026004", drawDate: "2026-01-04", digits: [1, 1, 1], week: "日" },
  ]);
  const kept = retainNewestDraws("fc3d", 2);
  assert.equal(kept.removed, 1);
  assert.equal(kept.remaining, 2);
  assert.deepEqual(getDraws("fc3d").map((draw) => draw.issue), ["2026004", "2026003"]);
  assert.equal(getDraws("pl3")[0].issue, "26001");
  assert.equal(retainNewestDraws("fc3d", 2).removed, 0);
});

test("expert permission defaults off and a pick can be replaced for the same issue", () => {
  const admin = listUsers()[0];
  assert.equal(admin.canRecommend, false);
  const enabled = setUserRecommend(admin.id, true);
  assert.equal(enabled.canRecommend, true);
  const saved = saveExpertPick({
    userId: admin.id,
    lotteryCode: "fc3d",
    basedIssue: "2026003",
    pick: { directs: [[1, 2, 3]], compound: null },
  });
  assert.deepEqual(saved.directs, [[1, 2, 3]]);
  assert.equal(saveExpertPick({ userId: admin.id, lotteryCode: "fc3d", basedIssue: "2026003", pick: null }), null);
});

test("a forecast is kept once per issue unless explicitly replaced", () => {
  const first = saveForecast({
    lotteryCode: "fc3d",
    basedIssue: "2026002",
    n: 30,
    k: 5,
    payload: { jointDirects: [{ name: "综合1", digits: [1, 2, 3] }], positionStats: [{ name: "百位" }] },
  });
  assert.equal(first.inserted, true);
  assert.equal(first.row.payload.positionStats, undefined);
  const again = saveForecast({
    lotteryCode: "fc3d",
    basedIssue: "2026002",
    n: 100,
    k: 2,
    payload: { jointDirects: [{ name: "综合1", digits: [9, 9, 9] }] },
  });
  assert.equal(again.inserted, false);
  assert.equal(again.row.n, 30);
  assert.deepEqual(again.row.payload.jointDirects[0].digits, [1, 2, 3]);
  const replaced = saveForecast({
    lotteryCode: "fc3d",
    basedIssue: "2026002",
    n: 100,
    k: 2,
    payload: { jointDirects: [{ name: "综合1", digits: [9, 9, 9] }] },
    replace: true,
  });
  assert.equal(replaced.replaced, true);
  assert.deepEqual(listForecasts("fc3d")[0].payload.jointDirects[0].digits, [9, 9, 9]);
});

test.after(() => {
  closeDatabase();
  for (const suffix of ["", "-wal", "-shm"]) fs.rmSync(dbFile + suffix, { force: true });
});
