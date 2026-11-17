// 统计不入库。开奖数组必须是新的在前，getDraws 已经按这个顺序排好。
// 次数只扫近 N 期；遗漏从下标 0（最新一期）往旧找，找到即停。遗漏 0 表示最新一期命中。
import { compileRule, describeDefinition } from "./rules.js";

export function presentDraw(draw) {
  const digits = draw.digits;
  let min = digits[0];
  let max = digits[0];
  let sum = 0;
  for (const value of digits) {
    sum += value;
    if (value < min) min = value;
    if (value > max) max = value;
  }
  const week = draw.week ? (String(draw.week).startsWith("周") ? String(draw.week) : `周${draw.week}`) : "";
  return {
    issue: draw.issue,
    drawDate: draw.drawDate,
    week,
    digits,
    parity: digits.map((value) => (value % 2 ? "单" : "双")).join(""),
    size: digits.map((value) => (value >= 5 ? "大" : "小")).join(""),
    sum,
    span: max - min,
  };
}

export function summarize(draws, rules, n, lottery) {
  const started = performance.now();
  const windowSize = Math.min(Math.max(n, 0), draws.length);
  const windowDraws = draws.slice(0, windowSize);
  // 卡片底部细条最多 36 格，左旧右新。全窗口都参与次数，细条只是近况预览。
  const stripCount = Math.min(36, windowDraws.length);
  const items = rules.map((rule) => ({
    id: rule.id,
    name: rule.name,
    summary: describeDefinition(rule.definition, lottery),
    definition: rule.definition,
    test: compileRule(rule.definition, lottery),
    hits: 0,
    omission: null,
  }));

  for (const draw of windowDraws) {
    for (const item of items) {
      if (item.test(draw.digits)) item.hits += 1;
    }
  }

  const pending = items.slice();
  for (let index = 0; index < draws.length && pending.length; index += 1) {
    const digits = draws[index].digits;
    for (let cursor = pending.length - 1; cursor >= 0; cursor -= 1) {
      if (pending[cursor].test(digits)) {
        pending[cursor].omission = index;
        pending.splice(cursor, 1);
      }
    }
  }

  const elapsedMs = Math.max(0, Math.round(performance.now() - started));
  return {
    elapsedMs,
    window: windowSize,
    rules: items.map((item) => {
      const strip = [];
      const stripIssues = [];
      for (let index = stripCount - 1; index >= 0; index -= 1) {
        const draw = windowDraws[index];
        strip.push(item.test(draw.digits) ? 1 : 0);
        stripIssues.push(draw.issue);
      }
      return {
        id: item.id,
        name: item.name,
        summary: item.summary,
        definition: item.definition,
        hits: item.hits,
        omission: item.omission,
        ratio: windowSize ? item.hits / windowSize : null,
        strip,
        stripIssues,
      };
    }),
  };
}
