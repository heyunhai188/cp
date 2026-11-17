// 向前回测。预测某一期时，只用比它更早的开奖，算完再和这一期的真实号码比。
// 理论次数 = 每一期覆盖的注数 / 全部号码个数，再把各期加起来。它是「同样注数随便买」的期望中奖次数。
// 这里比较的是过去，不提高下一期的中奖概率。

import { clampPickCount, predict } from "./predict.js";

const METHODS = [
  {
    id: "joint-direct",
    name: "综合直选",
    grade(result, digits) {
      return directGrade(result.joint?.directs, digits);
    },
  },
  {
    id: "joint-compound",
    name: "综合复式",
    grade(result, digits) {
      return compoundGrade(result.joint?.compound, digits);
    },
  },
  {
    id: "hot-direct",
    name: "冷热直选",
    grade(result, digits) {
      return directGrade(result.directs, digits);
    },
  },
  {
    id: "hot-compound",
    name: "热号复式",
    grade(result, digits) {
      return compoundGrade(result.hotCompound, digits);
    },
  },
  {
    id: "cold-compound",
    name: "冷号复式",
    grade(result, digits) {
      return compoundGrade(result.coldCompound, digits);
    },
  },
];

export const BACKTEST_METHODS = METHODS.map(({ id, name }) => ({ id, name }));

// 每注 2 元。倍数同时放大投入和 1 倍中奖金额。盈亏 = 收回 − 投入，正数是赚。
export function profitLoss({ trials, hits, betsPerDraw, prize, multiple }) {
  const stakePerDraw = betsPerDraw * 2 * multiple;
  const prizePerHit = prize * multiple;
  const spent = stakePerDraw * trials;
  const returned = prizePerHit * hits;
  return { stakePerDraw, prizePerHit, spent, returned, net: returned - spent };
}

function sameDigits(left, right) {
  return left.length === right.length && left.every((digit, index) => digit === right[index]);
}

function directGrade(list, digits) {
  const tickets = list || [];
  return {
    hit: tickets.some((item) => sameDigits(item.digits, digits)),
    bets: tickets.length,
  };
}

function compoundGrade(group, digits) {
  const positions = group?.positions || [];
  const hit = positions.length === digits.length && positions.every((position, index) => position.digits.includes(digits[index]));
  return { hit, bets: group?.bets || 0 };
}

function emptyMethod(method) {
  return {
    id: method.id,
    name: method.name,
    hits: 0,
    expected: 0,
    meanBets: 0,
    longest: { length: 0, start: -1, end: -1, fromIssue: "", toIssue: "", fromDate: "", toDate: "" },
    mask: "",
  };
}

// draws 必须是新的在前。最前面的 n 期只作依据，不放进命中统计。
export function backtestLottery(draws, lottery, n, k) {
  const windowSize = Math.min(5000, Math.max(0, Math.floor(Number(n)) || 0));
  const pick = clampPickCount(k, lottery);
  const space = 10 ** lottery.digits;
  const report = {
    lottery: { code: lottery.code, name: lottery.name, digits: lottery.digits },
    n: windowSize,
    k: pick,
    drawCount: draws.length,
    trials: 0,
    points: [],
    methods: METHODS.map(emptyMethod),
  };
  if (!windowSize || draws.length <= windowSize) return report;

  const tallies = METHODS.map(() => ({
    hits: 0,
    expected: 0,
    miss: 0,
    missStart: 0,
    from: null,
    longest: emptyMethod(METHODS[0]).longest,
    mask: [],
  }));

  for (let index = draws.length - windowSize - 1; index >= 0; index -= 1) {
    const target = draws[index];
    const result = predict(draws.slice(index + 1), lottery, windowSize, pick);
    const pointIndex = report.points.length;
    report.points.push({
      issue: target.issue || "",
      date: target.drawDate || "",
      number: target.digits.join(""),
    });
    METHODS.forEach((method, methodIndex) => {
      const grade = method.grade(result, target.digits);
      const tally = tallies[methodIndex];
      const hit = Boolean(grade.hit);
      tally.expected += (grade.bets || 0) / space;
      tally.mask.push(hit ? "1" : "0");
      if (hit) {
        tally.hits += 1;
        tally.miss = 0;
        tally.from = null;
        return;
      }
      if (tally.miss === 0) {
        tally.missStart = pointIndex;
        tally.from = target;
      }
      tally.miss += 1;
      if (tally.miss >= tally.longest.length) {
        tally.longest = {
          length: tally.miss,
          start: tally.missStart,
          end: pointIndex,
          fromIssue: tally.from?.issue || "",
          toIssue: target.issue || "",
          fromDate: tally.from?.drawDate || "",
          toDate: target.drawDate || "",
        };
      }
    });
  }

  report.trials = report.points.length;
  report.methods = METHODS.map((method, index) => {
    const tally = tallies[index];
    return {
      id: method.id,
      name: method.name,
      hits: tally.hits,
      expected: tally.expected,
      meanBets: report.trials ? (tally.expected * space) / report.trials : 0,
      longest: tally.longest,
      mask: tally.mask.join(""),
    };
  });
  return report;
}
