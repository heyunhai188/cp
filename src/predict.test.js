// 热号看窗口次数，冷号看全部历史的遗漏。直选去重，每位取号不超过 5。
import assert from "node:assert/strict";
import test from "node:test";
import { LOTTERIES } from "./lottery.js";
import { clampPickCount, predict } from "./predict.js";

const draws = [
  { digits: [1, 2, 3] },
  { digits: [1, 2, 9] },
  { digits: [4, 2, 3] },
  { digits: [7, 8, 8] },
];

test("hot and cold ranks use the window for counts and the full history for omission", () => {
  const result = predict(draws, LOTTERIES.fc3d, 3, 2);
  assert.equal(result.window, 3);
  assert.equal(result.k, 2);
  const hundreds = result.positions[0].digits;
  assert.equal(hundreds.find((item) => item.digit === 1).count, 2);
  assert.equal(hundreds.find((item) => item.digit === 1).omission, 0);
  assert.equal(hundreds.find((item) => item.digit === 7).count, 0);
  assert.equal(hundreds.find((item) => item.digit === 7).omission, 3);
  assert.equal(hundreds.find((item) => item.digit === 0).omission, null);
  assert.deepEqual(result.hotCompound.positions.map((item) => item.digits), [[1, 4], [2, 8], [3, 9]]);
  assert.equal(result.hotCompound.bets, 8);
  assert.deepEqual(result.coldCompound.positions[0].digits, [0, 2]);
  assert.deepEqual(result.directs.map((item) => item.digits.join("")), [
    "123",
    "489",
    "000",
    "211",
    "423",
    "183",
    "129",
  ]);
});

test("duplicate direct numbers are kept once and pick count stays within 1 to 5", () => {
  const result = predict([{ digits: [0, 0, 0] }], LOTTERIES.fc3d, 100, 9);
  assert.equal(result.k, 5);
  assert.deepEqual(result.directs.map((item) => `${item.name}:${item.digits.join("")}`), [
    "热号:000",
    "次热:111",
    "次冷:222",
    "百位次热:100",
    "十位次热:010",
    "个位次热:001",
  ]);
  assert.equal(result.hotCompound.positions.every((item) => item.digits.length === 5), true);
  assert.equal(clampPickCount(undefined, LOTTERIES.pl5), 3);
  assert.equal(clampPickCount(null, LOTTERIES.fc3d), 5);
  assert.equal(predict([], LOTTERIES.pl5, 30, 3).directs.length, 0);
  assert.equal(predict([], LOTTERIES.pl5, 30, 3).hotCompound, null);
  assert.equal(predict([], LOTTERIES.pl5, 30, 3).joint, null);
});

test("joint score prefers a whole ticket that matches recent sum, span and parity", () => {
  const result = predict([{ digits: [1, 2, 3] }], LOTTERIES.fc3d, 10, 2);
  const tickets = result.joint.directs;
  assert.deepEqual(tickets[0].digits, [1, 2, 3]);
  assert.equal(tickets[0].seen, true);
  assert.equal(tickets[0].sum, 6);
  assert.equal(tickets[0].parity, "单双单");
  assert.equal(tickets.length, 8);
  for (let left = 0; left < tickets.length; left += 1) {
    for (let right = left + 1; right < tickets.length; right += 1) {
      const gap = tickets[left].digits.filter((digit, index) => digit !== tickets[right].digits[index]).length;
      assert.ok(gap >= 2);
    }
  }
  assert.ok(result.joint.compound.positions[0].digits.includes(1));
  assert.ok(result.joint.compound.positions.every((item) => item.digits.length <= 2));
  assert.notEqual(predict(draws, LOTTERIES.fc3d, 3, 2).joint.directs[0].digits.join(""), "000");
});

test("newer draws outweigh the same count of older draws", () => {
  const recent = Array.from({ length: 12 }, () => ({ digits: [7, 8, 9] }));
  const older = Array.from({ length: 12 }, () => ({ digits: [1, 2, 3] }));
  const result = predict([...recent, ...older], LOTTERIES.fc3d, 24, 1);
  assert.deepEqual(result.joint.directs[0].digits, [7, 8, 9]);
  assert.deepEqual(result.joint.compound.positions.map((item) => item.digits), [[7], [8], [9]]);
});

test("排列五综合预测仍是五位，每位不超过设定个数", () => {
  const result = predict([
    { digits: [3, 9, 8, 7, 0] },
    { digits: [1, 7, 0, 2, 9] },
  ], LOTTERIES.pl5, 2, 3);
  assert.equal(result.joint.directs[0].digits.length, 5);
  assert.equal(result.joint.compound.positions.length, 5);
  assert.ok(result.joint.compound.positions.every((item) => item.digits.length <= 3));
  assert.equal(result.joint.compound.bets, result.joint.compound.positions.reduce((total, item) => total * item.digits.length, 1));
});
