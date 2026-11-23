import assert from "node:assert/strict";
import test from "node:test";
import { checkedForecasts, forecastMatched, gradeForecast, markLatestForecast, reviewForecasts } from "./forecastCheck.js";

const payload = {
  jointDirects: [{ name: "综合1", digits: [1, 2, 3] }, { name: "综合2", digits: [9, 8, 2] }],
  jointCompound: { positions: [{ digits: [1, 9] }, { digits: [2, 8] }, { digits: [3, 2] }] },
  hotDirects: [{ name: "热号", digits: [9, 8, 2] }],
  hotCompound: { positions: [{ digits: [9] }, { digits: [8] }, { digits: [2] }] },
  coldCompound: { positions: [{ digits: [0] }, { digits: [0] }, { digits: [0] }] },
};

test("grade an exact direct hit and a compound that covers every position", () => {
  const exact = gradeForecast(payload, [1, 2, 3]);
  assert.deepEqual(exact.jointDirects, ["综合1"]);
  assert.equal(exact.jointCompound, true);
  assert.deepEqual(exact.hotDirects, []);
  assert.equal(exact.hotCompound, false);

  const hot = gradeForecast(payload, [9, 8, 2]);
  assert.deepEqual(hot.jointDirects, ["综合2"]);
  assert.deepEqual(hot.hotDirects, ["热号"]);
  assert.equal(hot.hotCompound, true);
  assert.equal(hot.coldCompound, false);
});

test("any direct or compound hit counts, and a saved forecast with none is a miss", () => {
  assert.equal(forecastMatched(gradeForecast(payload, [1, 2, 3])), true);
  assert.equal(forecastMatched(gradeForecast(payload, [9, 8, 2])), true);
  assert.equal(forecastMatched(gradeForecast(payload, [4, 4, 4])), false);
});

test("the homepage mark only grades the newest draw against the previous issue's archive", () => {
  const draws = [
    { issue: "2026002", drawDate: "2026-01-02", digits: [4, 4, 4] },
    { issue: "2026001", drawDate: "2026-01-01", digits: [1, 2, 3] },
  ];
  assert.equal(markLatestForecast(draws, { basedIssue: "2026001", payload }), "miss");
  assert.equal(markLatestForecast(draws, { basedIssue: "2026002", payload }), null);
  assert.equal(markLatestForecast(draws, null), null);
  const hitDraws = [
    { issue: "2026002", drawDate: "2026-01-02", digits: [9, 8, 2] },
    { issue: "2026001", drawDate: "2026-01-01", digits: [1, 2, 3] },
  ];
  assert.equal(markLatestForecast(hitDraws, { basedIssue: "2026001", payload }), "hit");
});

test("the draw newer than the saved issue is the one that gets checked", () => {
  const draws = [
    { issue: "2026002", drawDate: "2026-01-02", digits: [9, 8, 2] },
    { issue: "2026001", drawDate: "2026-01-01", digits: [1, 2, 3] },
  ];
  const [checked, waiting] = reviewForecasts(draws, [
    { basedIssue: "2026001", payload },
    { basedIssue: "2026002", payload },
  ]);
  assert.equal(checked.status, "drawn");
  assert.equal(checked.resultIssue, "2026002");
  assert.deepEqual(checked.grade.hotDirects, ["热号"]);
  assert.equal(waiting.status, "pending");
});

test("the check list follows draw date from newest to oldest", () => {
  const draws = [
    { issue: "2026004", drawDate: "2026-01-04", digits: [1, 2, 3] },
    { issue: "2026003", drawDate: "2026-01-03", digits: [1, 2, 3] },
    { issue: "2026002", drawDate: "2026-01-02", digits: [9, 8, 2] },
    { issue: "2026001", drawDate: "2026-01-01", digits: [1, 2, 3] },
  ];
  const rows = [
    { basedIssue: "2026001", payload },
    { basedIssue: "2026003", payload },
    { basedIssue: "2026002", payload },
  ];
  const checked = checkedForecasts(draws, rows, 2);
  assert.deepEqual(checked.map((item) => item.resultDate), ["2026-01-04", "2026-01-03"]);
});
