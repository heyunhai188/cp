import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { advanceIssue, countBets, directHit, normalizeSelection, upcomingWindow } from "./play.js";

const dbFile = path.join(os.tmpdir(), `fc3d-play-${process.pid}-${Date.now()}.sqlite`);
process.env.FC3D_DB = dbFile;

  const {
  cancelPlayOrder,
  closeDatabase,
  createPlayOrders,
  createRole,
  createUser,
  deleteSelfPlayData,
  dismissPlayOrder,
  drawSelfPlay,
  initDatabase,
  listPlayOrders,
  listUsers,
  querySelfDraws,
  setPlayBalance,
  setUserPlayPrizes,
  upsertDraws,
} = await import("./db.js");

test("a direct compound hits only when every position is covered", () => {
  const selection = normalizeSelection([[6, 9], [6], [3]], 3);
  assert.equal(countBets(selection), 2);
  assert.equal(directHit(selection, [6, 6, 3]), true);
  assert.equal(directHit(selection, [1, 6, 3]), false);
  assert.throws(() => normalizeSelection([[], [1], [2]], 3), /每位至少选择 1 个号码/);
});

test("the next issue stops at the configured time and rolls the year", () => {
  const latest = { issue: "26302", drawDate: "2026-11-12" };
  const before = upcomingWindow(latest, "21:00", new Date(2026, 10, 13, 14, 36));
  assert.equal(before.issue, "26303");
  assert.equal(before.label, "11-13（周五）");
  assert.equal(before.time, "21:00");
  const closed = upcomingWindow(latest, "21:00", new Date(2026, 10, 13, 21, 0, 0));
  assert.equal(closed.issue, "26304");
  assert.equal(closed.date, "2026-11-14");
  assert.equal(advanceIssue("26365", new Date(2026, 11, 31), new Date(2027, 0, 1)), "27001");
  assert.equal(advanceIssue("2026365", new Date(2026, 11, 31), new Date(2027, 0, 1)), "2027001");
});

test("an order stays pending until its target draw exists, then pays the stake back as a prize", () => {
  initDatabase();
  upsertDraws("pl3", [{ issue: "26302", drawDate: "2026-11-12", digits: [9, 8, 2], week: "周四" }]);
  const admin = listUsers()[0];
  setPlayBalance(admin.id, 5000);
  const placed = createPlayOrders({
    userId: admin.id,
    lotteryCode: "pl3",
    multiple: 2,
    lines: [[[6], [6], [3]], [[1], [1], [1]]],
    now: new Date(2026, 10, 13, 14, 0),
  });
  assert.equal(placed.balance, 4992);
  assert.equal(placed.orders[0].status, "pending");
  assert.equal(placed.orders[0].stake, 4);
  assert.equal(placed.orders[0].targetIssue, "26303");
  assert.equal(placed.orders[0].cancellable, true);
  upsertDraws("pl3", [{ issue: "26303", drawDate: "2026-11-13", digits: [6, 6, 3], week: "周五" }]);
  const orders = listPlayOrders(admin, new Date(2026, 10, 13, 21, 30)).orders;
  const hit = orders.find((order) => order.id === placed.orders[0].id);
  const miss = orders.find((order) => order.id === placed.orders[1].id);
  assert.equal(hit.status, "hit");
  assert.equal(hit.resultIssue, "26303");
  assert.equal(hit.prize, 2080);
  assert.equal(hit.cancellable, false);
  assert.equal(miss.status, "miss");
  assert.equal(miss.prize, 0);
  assert.equal(listPlayOrders(admin).balance, 4992 + 2080);
});

test("a user-specific prize is what gets paid, and clearing it returns to the default", () => {
  initDatabase();
  upsertDraws("fc3d", [{ issue: "2026401", drawDate: "2026-02-01", digits: [1, 2, 3], week: "日" }]);
  const admin = listUsers()[0];
  setPlayBalance(admin.id, 100);
  const saved = setUserPlayPrizes([admin.id, admin.id], { fc3d: 1960, pl3: 2000 });
  assert.equal(saved[0].prizes.fc3d, 1960);
  assert.equal(saved[0].prizes.pl3, 2000);
  assert.equal(saved[0].prizes.pl5, 100000);
  const placed = createPlayOrders({
    userId: admin.id,
    lotteryCode: "fc3d",
    multiple: 2,
    selection: [[1], [2], [3]],
    now: new Date(2026, 1, 2, 12, 0),
  });
  upsertDraws("fc3d", [{ issue: "2026402", drawDate: "2026-02-02", digits: [1, 2, 3], week: "一" }]);
  const order = listPlayOrders(admin, new Date(2026, 1, 2, 22, 0)).orders.find((item) => item.id === placed.orders[0].id);
  assert.equal(order.status, "hit");
  assert.equal(order.prize, 3920);
  assert.equal(listPlayOrders(admin).balance, 100 - 4 + 3920);
  const reset = setUserPlayPrizes([admin.id], {}, true);
  assert.equal(reset[0].prizes.fc3d, 1040);
  assert.equal(reset[0].prizes.pl3, 1040);
});

test("bets after the deadline wait for the following issue and can only be cancelled before it", () => {
  initDatabase();
  upsertDraws("fc3d", [{ issue: "2026302", drawDate: "2026-11-12", digits: [1, 2, 3], week: "周四" }]);
  const admin = listUsers()[0];
  setPlayBalance(admin.id, 10);
  assert.throws(() => createPlayOrders({
    userId: admin.id,
    lotteryCode: "fc3d",
    multiple: 6,
    selection: [[1], [2], [3]],
    now: new Date(2026, 10, 13, 15, 0),
  }), /试玩余额不足/);
  setPlayBalance(admin.id, 20);
  const placed = createPlayOrders({
    userId: admin.id,
    lotteryCode: "fc3d",
    selection: [[1], [2], [3]],
    now: new Date(2026, 10, 13, 22, 0),
  });
  assert.equal(placed.orders[0].targetIssue, "2026304");
  assert.equal(placed.orders[0].ahead, 2);
  assert.equal(placed.balance, 18);
  const early = cancelPlayOrder({ id: placed.orders[0].id, account: admin, now: new Date(2026, 10, 14, 20, 0) });
  assert.equal(early.order.status, "cancelled");
  assert.equal(early.balance, 20);
  const again = createPlayOrders({
    userId: admin.id,
    lotteryCode: "fc3d",
    selection: [[1], [2], [3]],
    now: new Date(2026, 10, 13, 15, 0),
  });
  assert.equal(again.orders[0].targetIssue, "2026303");
  assert.equal(again.orders[0].ahead, 1);
  assert.throws(() => cancelPlayOrder({
    id: again.orders[0].id,
    account: admin,
    now: new Date(2026, 10, 13, 21, 0),
  }), /已过截止时间，不能撤销/);
  upsertDraws("fc3d", [{ issue: "2026303", drawDate: "2026-11-13", digits: [9, 9, 9], week: "周五" }]);
  const settled = listPlayOrders(admin, new Date(2026, 10, 13, 22, 0)).orders.find((order) => order.id === again.orders[0].id);
  assert.equal(settled.status, "miss");
  const skipped = listPlayOrders(admin).orders.find((order) => order.id === placed.orders[0].id);
  assert.equal(skipped.status, "cancelled");
  dismissPlayOrder({ id: skipped.id, account: admin });
  assert.equal(listPlayOrders(admin).orders.some((order) => order.id === skipped.id), false);
});

test("the next stored draw settles the bet even when its issue is not the estimated one", () => {
  initDatabase();
  upsertDraws("pl5", [{ issue: "26302", drawDate: "2026-11-12", digits: [1, 2, 3, 4, 5], week: "周四" }]);
  const admin = listUsers()[0];
  setPlayBalance(admin.id, 100);
  const placed = createPlayOrders({
    userId: admin.id,
    lotteryCode: "pl5",
    selection: [[9], [8], [2], [9], [2]],
    now: new Date(2026, 10, 13, 14, 0),
  });
  assert.equal(placed.orders[0].ahead, 1);
  assert.equal(placed.orders[0].targetIssue, "26303");
  upsertDraws("pl5", [{ issue: "26399", drawDate: "2026-11-13", digits: [9, 8, 2, 9, 2], week: "周五" }]);
  const order = listPlayOrders(admin).orders.find((item) => item.id === placed.orders[0].id);
  assert.equal(order.status, "hit");
  assert.equal(order.resultIssue, "26399");
  assert.equal(order.prize, 100000);
  const summary = listPlayOrders(admin).summary;
  assert.ok(summary.today.prize >= 100000);
});

test("self3d settles one private draw and a delete refunds only pending stakes", () => {
  initDatabase();
  const admin = listUsers()[0];
  setPlayBalance(admin.id, 100);
  const role = createRole("管理员", true);
  const other = createUser({ username: "selfb", password: "secret1", roleId: role.id });
  setPlayBalance(other.id, 100);
  const placed = createPlayOrders({
    userId: admin.id,
    lotteryCode: "self3d",
    lines: [[[1], [2], [3]], [[9], [9], [9]]],
  });
  assert.equal(placed.orders[0].targetIssue, "1");
  assert.equal(placed.orders[0].cancellable, true);
  assert.equal(placed.balance, 96);
  const cancelled = cancelPlayOrder({ id: placed.orders[1].id, account: admin });
  assert.equal(cancelled.balance, 98);
  assert.throws(() => drawSelfPlay({ userId: other.id }), /还没有未开奖的注/);
  const drawn = drawSelfPlay({ userId: admin.id, digits: [1, 2, 3] });
  assert.deepEqual(drawn.draw.digits, [1, 2, 3]);
  assert.equal(drawn.orders.find((order) => order.id === placed.orders[0].id).status, "hit");
  assert.equal(drawn.orders.find((order) => order.id === placed.orders[0].id).prize, 1040);
  assert.equal(drawn.balance, 1138);
  createPlayOrders({ userId: admin.id, lotteryCode: "self3d", selection: [[0], [0], [0]] });
  const second = drawSelfPlay({ userId: admin.id, digits: [9, 8, 7] });
  assert.equal(second.draw.issue, "2");
  assert.equal(second.orders[0].status, "miss");
  createPlayOrders({ userId: other.id, lotteryCode: "self3d", selection: [[4], [4], [4]] });
  assert.equal(drawSelfPlay({ userId: other.id, digits: [4, 4, 4] }).draw.issue, "1");
  assert.deepEqual(querySelfDraws({ userId: admin.id }).rows.map((row) => row.issue), ["2", "1"]);
  const pending = createPlayOrders({ userId: admin.id, lotteryCode: "self3d", selection: [[7], [7], [7]] });
  const before = pending.balance;
  const cleared = deleteSelfPlayData([admin.id]);
  assert.equal(cleared.refunded, 2);
  assert.equal(querySelfDraws({ userId: admin.id }).total, 0);
  assert.equal(querySelfDraws({ userId: other.id }).total, 1);
  const after = listPlayOrders({ id: admin.id, canManage: true });
  assert.equal(after.orders.some((order) => order.userId === admin.id && order.lotteryCode === "self3d"), false);
  assert.equal(after.orders.some((order) => order.userId === other.id && order.lotteryCode === "self3d"), true);
  assert.equal(after.balance, before + 2);
});

test.after(() => {
  closeDatabase();
  fs.rmSync(dbFile, { force: true });
});
