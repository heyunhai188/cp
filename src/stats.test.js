// 次数只看窗口，遗漏从最新一期往前数。细条从左到右是由旧到新。
import assert from "node:assert/strict";
import test from "node:test";
import { LOTTERIES } from "./lottery.js";
import { summarize } from "./stats.js";

test("count the recent window and omission from the newest draw", () => {
  const draws = [
    { issue: "3", drawDate: "2026-01-03", digits: [2, 2, 2], week: "六" },
    { issue: "2", drawDate: "2026-01-02", digits: [1, 1, 2], week: "五" },
    { issue: "1", drawDate: "2026-01-01", digits: [1, 1, 1], week: "四" },
  ];
  const rules = [{
    id: 1,
    name: "单单双",
    definition: { positions: [{ parity: "odd" }, { parity: "odd" }, { parity: "even" }] },
  }];
  const result = summarize(draws, rules, 3, LOTTERIES.fc3d);
  assert.equal(result.window, 3);
  assert.equal(result.rules[0].hits, 1);
  assert.equal(result.rules[0].omission, 1);
  assert.deepEqual(result.rules[0].strip, [0, 1, 0]);
  assert.deepEqual(result.rules[0].stripIssues, ["1", "2", "3"]);

  draws[0] = { issue: "3", drawDate: "2026-01-03", digits: [1, 1, 2], week: "" };
  const fresh = summarize(draws, rules, 2, LOTTERIES.fc3d);
  assert.equal(fresh.rules[0].omission, 0);
  assert.equal(fresh.window, 2);

  const never = summarize([
    { issue: "1", drawDate: "2026-01-01", digits: [2, 2, 2], week: "" },
  ], rules, 1, LOTTERIES.fc3d);
  assert.equal(never.rules[0].omission, null);
  assert.equal(never.rules[0].hits, 0);
});
