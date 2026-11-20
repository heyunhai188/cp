import assert from "node:assert/strict";
import test from "node:test";
import { expertBoard, expertHit, normalizeExpertPick } from "./expert.js";
import { LOTTERIES } from "./lottery.js";

const lottery = LOTTERIES.fc3d;

test("an expert pick hits when either the direct or the compound matches", () => {
  const pick = {
    directs: [[1, 2, 3]],
    compound: { positions: [{ digits: [4] }, { digits: [5] }, { digits: [6] }] },
  };
  assert.equal(expertHit(pick, [1, 2, 3]).hit, true);
  assert.equal(expertHit(pick, [4, 5, 6]).directHit, false);
  assert.equal(expertHit(pick, [4, 5, 6]).hit, true);
  assert.equal(expertHit(pick, [7, 7, 7]).hit, false);
});

test("normalize keeps at most eight unique directs and requires a complete compound", () => {
  const saved = normalizeExpertPick({
    directs: [[1, 2, 3], [1, 2, 3], [4, 5, 6]],
    compound: [[1, 2], [3], [4, 5]],
  }, lottery);
  assert.deepEqual(saved.directs, [[1, 2, 3], [4, 5, 6]]);
  assert.equal(saved.compound.bets, 4);
  assert.equal(normalizeExpertPick({ clear: true }, lottery), null);
  assert.throws(() => normalizeExpertPick({ compound: [[1], [], [2]] }, lottery), /至少选一个号/);
});

test("current recommendations sort by the selected window and skipped issues stay out", () => {
  const draws = [
    { issue: "4", drawDate: "2026-01-04", digits: [9, 9, 9] },
    { issue: "3", drawDate: "2026-01-03", digits: [1, 2, 3] },
    { issue: "2", drawDate: "2026-01-02", digits: [4, 5, 6] },
    { issue: "1", drawDate: "2026-01-01", digits: [7, 8, 9] },
  ];
  const rows = [
    { userId: 1, username: "甲", basedIssue: "1", directs: [[7, 8, 9]], compound: null },
    { userId: 1, username: "甲", basedIssue: "2", directs: [[0, 0, 0]], compound: null },
    { userId: 1, username: "甲", basedIssue: "4", directs: [[1, 1, 1]], compound: null },
    { userId: 2, username: "乙", basedIssue: "3", directs: [[9, 9, 9]], compound: null },
    { userId: 2, username: "乙", basedIssue: "4", directs: [[2, 2, 2]], compound: null },
  ];
  const board = expertBoard(draws, rows, 1);
  assert.deepEqual(board.current.map((item) => item.username), ["乙", "甲"]);
  assert.equal(board.current[0].rate.hits, 1);
  assert.equal(board.current[0].rate.graded, 1);
  assert.equal(board.current[1].rate.hits, 0);
  assert.deepEqual(board.history.map((item) => item.resultIssue), ["4", "3"]);
});
