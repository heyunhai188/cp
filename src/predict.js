// 预测不写数据库。开奖彼此独立，这里的排序不能提高中奖概率。
// 综合：把 000…到 999… 每一注都打分，分高的更像近期开奖的整体。
// 近 N 期里越新的开奖权重越大，大约每 20 期减半。否则新开奖只占百分之一，排序几乎不动。
// 分数 = 每位加权次数 + 和值 + 跨度 + 单双形态。平滑强度跟「每期一样重」时相同，没出现过的号不会被直接淘汰。
// 直选从高分里挑，后一注至少改两位，避免八组号码挤在一起。复式用这些高分号码里的数字，每位不超过 K 个。
// 冷热对照仍保留：热号看窗口次数，冷号看全部历史的遗漏。冷热不加权。

const NEVER = Number.POSITIVE_INFINITY;
const JOINT_COUNT = 8;
// 和值、跨度、单双是整注特征，权重低于「每一位自己的次数」，只用来把不像近期形态的号往后排。
const SUM_WEIGHT = 0.6;
const SPAN_WEIGHT = 0.4;
const PARITY_WEIGHT = 0.5;
// 第 0 期（最新）权重是 1，第 20 期约 0.5，第 40 期约 0.25。
const RECENCY_HALF_LIFE = 20;

export function defaultPickCount(lottery) {
  return 4;
}

export function clampPickCount(value, lottery) {
  if (value === undefined || value === null || value === "") return defaultPickCount(lottery);
  const number = Number(value);
  if (!Number.isInteger(number)) return defaultPickCount(lottery);
  return Math.min(5, Math.max(1, number));
}

function omissionAt(draws, position, digit) {
  const index = draws.findIndex((draw) => draw.digits[position] === digit);
  return index === -1 ? null : index;
}

function byHot(left, right) {
  if (right.count !== left.count) return right.count - left.count;
  const leftGap = left.omission ?? NEVER;
  const rightGap = right.omission ?? NEVER;
  if (leftGap !== rightGap) return leftGap - rightGap;
  return left.digit - right.digit;
}

function byCold(left, right) {
  const leftGap = left.omission ?? NEVER;
  const rightGap = right.omission ?? NEVER;
  if (leftGap !== rightGap) return rightGap - leftGap;
  if (left.count !== right.count) return left.count - right.count;
  return left.digit - right.digit;
}

function digitsFromIndex(index, width) {
  const digits = Array(width);
  for (let place = width - 1; place >= 0; place -= 1) {
    digits[place] = index % 10;
    index = Math.floor(index / 10);
  }
  return digits;
}

function differentPlaces(left, right) {
  let count = 0;
  for (let index = 0; index < left.length; index += 1) {
    if (left[index] !== right[index]) count += 1;
  }
  return count;
}

// 给每一个可能的号码打分。三位是 1000 注，排列五是 10 万注，都在本机一次算完。
function jointForecast(windowDraws, lottery, pick) {
  if (!windowDraws.length) return null;
  const width = lottery.digits;
  const total = 10 ** width;
  const sumLimit = lottery.sumMax + 1;
  const parityLimit = 2 ** width;
  const samples = windowDraws.length;
  const weights = windowDraws.map((_, age) => 0.5 ** (age / RECENCY_HALF_LIFE));
  const totalWeight = weights.reduce((sum, weight) => sum + weight, 0);
  // 先验按「每期一样重、每位先记 1 次」的比例来，只是单位换成权重。
  const prior = totalWeight / samples;
  const positionCounts = Array.from({ length: width }, () => Array(10).fill(prior));
  const sumCounts = Array(sumLimit).fill(prior);
  const spanCounts = Array(10).fill(prior);
  const parityCounts = Array(parityLimit).fill(prior);
  const seen = new Set();

  windowDraws.forEach((draw, age) => {
    seen.add(draw.digits.join(","));
    const weight = weights[age];
    let sum = 0;
    let min = 9;
    let max = 0;
    let parity = 0;
    for (let place = 0; place < width; place += 1) {
      const digit = draw.digits[place];
      positionCounts[place][digit] += weight;
      sum += digit;
      if (digit < min) min = digit;
      if (digit > max) max = digit;
      if (digit % 2) parity |= 1 << place;
    }
    sumCounts[sum] += weight;
    spanCounts[max - min] += weight;
    parityCounts[parity] += weight;
  });

  const positionLog = positionCounts.map((counts) => counts.map((count) => Math.log(count / (totalWeight + prior * 10))));
  const sumLog = sumCounts.map((count) => Math.log(count / (totalWeight + prior * sumLimit)));
  const spanLog = spanCounts.map((count) => Math.log(count / (totalWeight + prior * 10)));
  const parityLog = parityCounts.map((count) => Math.log(count / (totalWeight + prior * parityLimit)));
  const scores = new Float64Array(total);

  for (let index = 0; index < total; index += 1) {
    let rest = index;
    let score = 0;
    let sum = 0;
    let min = 9;
    let max = 0;
    let parity = 0;
    for (let place = width - 1; place >= 0; place -= 1) {
      const digit = rest % 10;
      rest = Math.floor(rest / 10);
      score += positionLog[place][digit];
      sum += digit;
      if (digit < min) min = digit;
      if (digit > max) max = digit;
      if (digit % 2) parity |= 1 << place;
    }
    scores[index] = score + SUM_WEIGHT * sumLog[sum] + SPAN_WEIGHT * spanLog[max - min] + PARITY_WEIGHT * parityLog[parity];
  }

  const order = Array.from({ length: total }, (_, index) => index);
  order.sort((left, right) => scores[right] - scores[left] || left - right);

  const chosen = [];
  for (const gap of [2, 1]) {
    for (const index of order) {
      if (chosen.length >= JOINT_COUNT) break;
      const digits = digitsFromIndex(index, width);
      if (chosen.some((item) => differentPlaces(item.digits, digits) < gap)) continue;
      chosen.push({ index, digits });
    }
    if (chosen.length >= JOINT_COUNT) break;
  }

  const bags = Array.from({ length: width }, () => []);
  for (const index of order) {
    const digits = digitsFromIndex(index, width);
    for (let place = 0; place < width; place += 1) {
      if (bags[place].length >= pick || bags[place].includes(digits[place])) continue;
      bags[place].push(digits[place]);
    }
    if (bags.every((bag) => bag.length >= pick)) break;
  }

  return {
    directs: chosen.map((item, index) => {
      const digits = item.digits;
      let sum = 0;
      let min = 9;
      let max = 0;
      let parity = "";
      for (const digit of digits) {
        sum += digit;
        if (digit < min) min = digit;
        if (digit > max) max = digit;
        parity += digit % 2 ? "单" : "双";
      }
      return {
        name: `综合${index + 1}`,
        digits,
        sum,
        span: max - min,
        parity,
        seen: seen.has(digits.join(",")),
      };
    }),
    compound: {
      positions: lottery.positions.map((name, index) => ({
        name,
        short: lottery.short[index],
        digits: bags[index].slice().sort((left, right) => left - right),
      })),
      bets: bags.reduce((totalBets, bag) => totalBets * bag.length, 1),
    },
  };
}

function remember(list, seen, name, digits) {
  const key = digits.join(",");
  if (seen.has(key)) return;
  seen.add(key);
  list.push({ name, digits: digits.slice() });
}

export function archivePayload(result) {
  const ticket = (item) => ({ name: item.name, digits: item.digits });
  const compound = (group) => (group ? {
    positions: group.positions.map((position) => ({ name: position.name, digits: position.digits })),
    bets: group.bets,
  } : null);
  return {
    jointDirects: (result.joint?.directs || []).map(ticket),
    jointCompound: compound(result.joint?.compound),
    hotDirects: (result.directs || []).map(ticket),
    hotCompound: compound(result.hotCompound),
    coldCompound: compound(result.coldCompound),
  };
}

export function predict(draws, lottery, n, k) {
  const pick = clampPickCount(k, lottery);
  const windowSize = Math.min(Math.max(Number(n) || 0, 0), draws.length);
  const windowDraws = draws.slice(0, windowSize);
  const positions = lottery.positions.map((name, position) => {
    const digits = [];
    for (let digit = 0; digit <= 9; digit += 1) {
      let count = 0;
      for (const draw of windowDraws) {
        if (draw.digits[position] === digit) count += 1;
      }
      digits.push({
        digit,
        count,
        omission: draws.length ? omissionAt(draws, position, digit) : null,
      });
    }
    const hot = digits.slice().sort(byHot);
    const cold = digits.slice().sort(byCold);
    hot.forEach((item, index) => {
      item.hotRank = index + 1;
    });
    cold.forEach((item, index) => {
      item.coldRank = index + 1;
    });
    return {
      name,
      short: lottery.short[position],
      digits: digits.slice().sort((left, right) => left.digit - right.digit),
      hot: hot.map((item) => item.digit),
      cold: cold.map((item) => item.digit),
    };
  });

  const take = (key) => positions.map((position) => ({
    name: position.name,
    short: position.short,
    digits: position[key].slice(0, pick),
  }));
  const betsOf = (groups) => groups.reduce((total, group) => total * group.digits.length, 1);
  const hotGroups = take("hot");
  const coldGroups = take("cold");
  const directs = [];
  if (windowSize > 0) {
    const seen = new Set();
    const at = (key, rank) => positions.map((position) => position[key][rank]);
    remember(directs, seen, "热号", at("hot", 0));
    if (pick > 1) remember(directs, seen, "次热", at("hot", 1));
    remember(directs, seen, "冷号", at("cold", 0));
    if (pick > 1) remember(directs, seen, "次冷", at("cold", 1));
    if (pick > 1) {
      positions.forEach((position, index) => {
        const digits = at("hot", 0);
        digits[index] = position.hot[1];
        remember(directs, seen, `${position.name}次热`, digits);
      });
    }
  }

  return {
    n: windowSize,
    window: windowSize,
    k: pick,
    positions: positions.map(({ name, short, digits }) => ({ name, short, digits })),
    hotCompound: windowSize ? { positions: hotGroups, bets: betsOf(hotGroups) } : null,
    coldCompound: windowSize ? { positions: coldGroups, bets: betsOf(coldGroups) } : null,
    directs,
    joint: jointForecast(windowDraws, lottery, pick),
  };
}
