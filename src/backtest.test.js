// 向前回测只用目标期之前的开奖。命中、理论次数和最长未中都在这里对。
import assert from "node:assert/strict";
import test from "node:test";
import { backtestLottery, profitLoss } from "./backtest.js";
import { LOTTERIES } from "./lottery.js";

function draw(issue, digits) {
  return { issue, drawDate: `2026-01-${issue.padStart(2, "0")}`, digits };
}

test("a walk-forward trial does not see the draw it is scoring", () => {
  const report = backtestLottery([
    draw("2", [7, 7, 7]),
    draw("1", [1, 2, 3]),
  ], LOTTERIES.fc3d, 1, 1);
  const direct = report.methods.find((item) => item.id === "joint-direct");
  assert.equal(report.trials, 1);
  assert.equal(report.points[0].issue, "2");
  assert.equal(report.points[0].number, "777");
  assert.equal(direct.hits, 0);
  assert.equal(direct.mask, "0");
  assert.equal(direct.longest.length, 1);
  assert.equal(direct.longest.fromIssue, "2");
  assert.equal(direct.longest.toIssue, "2");
});

test("repeated tickets count as hits and a break resets the miss streak", () => {
  const report = backtestLottery([
    draw("4", [1, 2, 3]),
    draw("3", [1, 2, 3]),
    draw("2", [1, 2, 3]),
    draw("1", [9, 9, 9]),
  ], LOTTERIES.fc3d, 1, 1);
  const compound = report.methods.find((item) => item.id === "joint-compound");
  assert.deepEqual(report.points.map((item) => item.issue), ["2", "3", "4"]);
  assert.equal(compound.mask, "011");
  assert.equal(compound.hits, 2);
  assert.equal(compound.meanBets, 1);
  assert.ok(Math.abs(compound.expected - 0.003) < 1e-12);
  assert.equal(compound.longest.length, 1);
  assert.equal(compound.longest.fromIssue, "2");
});

test("an unbroken run of misses keeps the whole span", () => {
  const report = backtestLottery([
    draw("5", [1, 2, 3]),
    draw("4", [9, 9, 9]),
    draw("3", [1, 2, 3]),
    draw("2", [9, 9, 9]),
    draw("1", [1, 2, 3]),
  ], LOTTERIES.fc3d, 1, 1);
  const direct = report.methods.find((item) => item.id === "joint-direct");
  assert.equal(direct.hits, 0);
  assert.equal(direct.mask, "0000");
  assert.equal(direct.longest.length, 4);
  assert.equal(direct.longest.fromIssue, "2");
  assert.equal(direct.longest.toIssue, "5");
  assert.equal(direct.longest.start, 0);
  assert.equal(direct.longest.end, 3);
  assert.ok(Math.abs(direct.expected - 0.032) < 1e-12);
});

test("stake is bets times 2 yuan times the multiple, and the prize scales the same way", () => {
  const result = profitLoss({ trials: 100, hits: 20, betsPerDraw: 125, prize: 1960, multiple: 2 });
  assert.equal(result.stakePerDraw, 500);
  assert.equal(result.prizePerHit, 3920);
  assert.equal(result.spent, 50000);
  assert.equal(result.returned, 78400);
  assert.equal(result.net, 28400);
});

test("fewer draws than the window produces an empty report", () => {
  const report = backtestLottery([
    draw("1", [1, 2, 3]),
  ], LOTTERIES.fc3d, 10, 5);
  assert.equal(report.trials, 0);
  assert.equal(report.k, 5);
  assert.equal(report.methods.length, 5);
  assert.equal(report.methods.every((item) => item.hits === 0 && item.longest.length === 0), true);
});
