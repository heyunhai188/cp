// 规则判断和中文说明。改口径后先看这里。
import assert from "node:assert/strict";
import test from "node:test";
import { LOTTERIES } from "./lottery.js";
import {
  compileRule,
  describeDefinition,
  isStraight,
  normalizeDefinition,
  prepareRule,
} from "./rules.js";
import { mapDraw } from "./cwl.js";

const lottery = LOTTERIES.fc3d;

function matches(definition, digits) {
  return compileRule(definition, lottery)(digits);
}

test("map official 3d payload", () => {
  const draw = mapDraw({
    code: "2026300",
    date: "2026-11-10(二)",
    week: "二",
    red: "1,9,0",
    sales: "101569790",
  }, 3);
  assert.equal(draw.issue, "2026300");
  assert.equal(draw.drawDate, "2026-11-10");
  assert.deepEqual(draw.digits, [1, 9, 0]);
  assert.equal(mapDraw({ code: "2026001", date: "2026-01-01", red: "190" }, 3).digits.join(""), "190");
  assert.equal(mapDraw({ code: "", date: "2026-01-01", red: "1,2,3" }, 3), null);
});

test("odd even pattern and name", () => {
  const definition = { positions: [{ parity: "odd" }, { parity: "odd" }, { parity: "even" }] };
  assert.equal(describeDefinition(definition, lottery), "百单 · 十单 · 个双");
  assert.equal(matches(definition, [1, 3, 2]), true);
  assert.equal(matches(definition, [1, 3, 3]), false);
  assert.equal(matches({ positions: [{ parity: "even" }, { parity: "even" }, { parity: "even" }] }, [2, 4, 0]), true);
});

test("size prime road and chosen digits", () => {
  assert.equal(matches({ positions: [{ size: "small" }, { size: "big" }, { size: "small" }] }, [1, 9, 0]), true);
  assert.equal(matches({ positions: [{ size: "big" }] }, [4, 1, 1]), false);
  assert.equal(matches({ positions: [{ prime: "prime" }, { prime: "prime" }, { prime: "composite" }] }, [1, 2, 0]), true);
  assert.equal(matches({ positions: [{ prime: "prime" }] }, [4, 1, 1]), false);
  assert.equal(matches({ positions: [{ road: 0 }, { road: 1 }, { road: 2 }] }, [3, 4, 5]), true);
  assert.equal(matches({ positions: [{}, {}, { digits: [0, 2, 8] }] }, [1, 9, 8]), true);
  assert.equal(matches({ positions: [{}, {}, { digits: [0, 2, 8] }] }, [1, 9, 7]), false);
});

test("sum span shape count contains and consecutive", () => {
  assert.equal(matches({ sum: { size: "big" } }, [5, 4, 5]), true);
  assert.equal(matches({ sum: { size: "small" } }, [5, 4, 4]), true);
  assert.equal(matches({ sum: { size: "big" } }, [5, 4, 4]), false);
  assert.equal(matches({ sum: { min: 10, max: 12 }, span: { min: 9, max: 9 } }, [1, 9, 0]), true);
  assert.equal(matches({ shape: "leopard" }, [7, 7, 7]), true);
  assert.equal(matches({ shape: "group3" }, [7, 7, 8]), true);
  assert.equal(matches({ shape: "group3" }, [7, 7, 7]), false);
  assert.equal(matches({ shape: "group6" }, [1, 2, 4]), true);
  assert.equal(isStraight([3, 2, 1]), true);
  assert.equal(isStraight([8, 9, 0]), true);
  assert.equal(isStraight([9, 0, 1]), false);
  assert.equal(isStraight([1, 3, 5]), false);
  assert.equal(matches({ oddCount: 2, bigCount: 1 }, [1, 2, 9]), true);
  assert.equal(matches({ contains: [1, 9], excludes: [8] }, [1, 9, 0]), true);
  assert.equal(matches({ excludes: [1] }, [1, 9, 0]), false);
  assert.equal(matches({ consecutive: true }, [1, 9, 0]), true);
  assert.equal(matches({ consecutive: false }, [1, 3, 5]), true);
  assert.equal(matches({ consecutive: false, shape: "group6" }, [1, 2, 4]), false);
});

test("reject empty rules and swap reversed ranges", () => {
  assert.throws(() => prepareRule({ definition: {} }, lottery), /至少加一个条件/);
  assert.equal(prepareRule({ definition: { shape: "leopard" } }, lottery).name, "豹子");
  assert.deepEqual(normalizeDefinition({ sum: { min: 20, max: 5 }, shape: "nope" }, lottery), {
    sum: { min: 5, max: 20 },
  });
  assert.throws(() => prepareRule({ definition: { sum: { min: 1.5 } } }, lottery), /和值/);
});
