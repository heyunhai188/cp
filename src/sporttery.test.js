import assert from "node:assert/strict";
import test from "node:test";
import { mapSportteryDraw, weekdayFromDate } from "./sporttery.js";

test("排列三只用开奖结果的三位，不把排列五后两位算进去", () => {
  const draw = mapSportteryDraw({
    lotteryDrawNum: "26300",
    lotteryDrawTime: "2026-11-10 21:25:00",
    lotteryDrawResult: "3 9 8",
    lotteryUnsortDrawresult: "3 9 8 7 0",
    totalSaleAmount: "12,345,678",
  }, 3);
  assert.equal(draw.issue, "26300");
  assert.equal(draw.drawDate, "2026-11-10");
  assert.equal(weekdayFromDate("2026-11-10"), "二");
  assert.deepEqual(draw.digits, [3, 9, 8]);
  assert.equal(draw.sales, "12345678");
  assert.equal(draw.source, "sporttery");
});

test("排列五保存五位号码", () => {
  const draw = mapSportteryDraw({
    lotteryDrawNum: "26300",
    lotteryDrawTime: "2026-11-10",
    lotteryDrawResult: "3 9 8 7 0",
  }, 5);
  assert.deepEqual(draw.digits, [3, 9, 8, 7, 0]);
});

test("位数对不上就跳过", () => {
  assert.equal(mapSportteryDraw({
    lotteryDrawNum: "26300",
    lotteryDrawTime: "2026-11-10",
    lotteryDrawResult: "3 9 8 7 0",
  }, 3), null);
});
