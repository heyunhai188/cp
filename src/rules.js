// 规则条件的收纳、命中判断和中文说明。页面只负责收集选项，真正的口径以这里为准。
//
// definition 例子（没填的项不要放进来）：
// {
//   positions: [ { parity:"odd", size:"big", prime:"prime", road:1, digits:[1,3] }, {}, { parity:"even" } ],
//   sum: { min:10, max:18, parity:"odd", size:"big" },
//   span: { min:2, max:7, parity:"even" },
//   shape: "group6",          // leopard 豹子 | group3 组三 | group6 组六 | straight 顺子
//   oddCount: 2,
//   bigCount: 1,
//   contains: [1, 9],
//   excludes: [0],
//   consecutive: true         // true 必须有连号，false 必须没有
// }
// positions 下标跟 lottery.positions 一致。同一位置、同一条规则里的条件是「同时满足」。
// 质数固定为 1、2、3、5、7。位置大小以 5 为界，和值大小看 lottery.sumBigMin。
const SHAPES = new Set(["leopard", "group3", "group6", "straight"]);
const PRIMES = new Set([1, 2, 3, 5, 7]);
const SHAPE_LABEL = {
  leopard: "豹子",
  group3: "组三",
  group6: "组六",
  straight: "顺子",
};

export function uniqueDigits(value) {
  if (!Array.isArray(value)) return [];
  const seen = new Set();
  for (const item of value) {
    const number = Number(item);
    if (Number.isInteger(number) && number >= 0 && number <= 9) seen.add(number);
  }
  return [...seen].sort((left, right) => left - right);
}

function clampInt(value, min, max) {
  if (typeof value === "string" && value.trim() === "") return null;
  const number = Number(value);
  if (!Number.isInteger(number) || number < min || number > max) return null;
  return number;
}

function hasOwn(object, key) {
  return Object.prototype.hasOwnProperty.call(object, key);
}

// 丢掉页面上没选的项，并把写反的区间（最小大于最大）对调。无法识别的值直接忽略。
export function normalizeDefinition(input, lottery) {
  const source = input && typeof input === "object" ? input : {};
  const output = {};
  const digitCount = lottery.digits;

  if (Array.isArray(source.positions)) {
    const positions = [];
    let used = false;
    for (let index = 0; index < digitCount; index += 1) {
      const raw = source.positions[index] && typeof source.positions[index] === "object"
        ? source.positions[index]
        : {};
      const clean = {};
      if (raw.parity === "odd" || raw.parity === "even") clean.parity = raw.parity;
      if (raw.size === "big" || raw.size === "small") clean.size = raw.size;
      if (raw.prime === "prime" || raw.prime === "composite") clean.prime = raw.prime;
      if (hasOwn(raw, "road") && raw.road !== null && raw.road !== "") {
        const road = clampInt(raw.road, 0, 2);
        if (road !== null) clean.road = road;
      }
      const digits = uniqueDigits(raw.digits);
      if (digits.length) clean.digits = digits;
      if (Object.keys(clean).length) used = true;
      positions.push(clean);
    }
    if (used) output.positions = positions;
  }

  if (source.sum && typeof source.sum === "object") {
    const sum = {};
    const min = hasOwn(source.sum, "min") && source.sum.min !== "" && source.sum.min !== null
      ? clampInt(source.sum.min, 0, lottery.sumMax)
      : null;
    const max = hasOwn(source.sum, "max") && source.sum.max !== "" && source.sum.max !== null
      ? clampInt(source.sum.max, 0, lottery.sumMax)
      : null;
    if (min !== null || max !== null) {
      const low = min ?? 0;
      const high = max ?? lottery.sumMax;
      sum.min = Math.min(low, high);
      sum.max = Math.max(low, high);
    }
    if (source.sum.parity === "odd" || source.sum.parity === "even") sum.parity = source.sum.parity;
    if (source.sum.size === "big" || source.sum.size === "small") sum.size = source.sum.size;
    if (Object.keys(sum).length) output.sum = sum;
  }

  if (source.span && typeof source.span === "object") {
    const span = {};
    const min = hasOwn(source.span, "min") && source.span.min !== "" && source.span.min !== null
      ? clampInt(source.span.min, 0, 9)
      : null;
    const max = hasOwn(source.span, "max") && source.span.max !== "" && source.span.max !== null
      ? clampInt(source.span.max, 0, 9)
      : null;
    if (min !== null || max !== null) {
      const low = min ?? 0;
      const high = max ?? 9;
      span.min = Math.min(low, high);
      span.max = Math.max(low, high);
    }
    if (source.span.parity === "odd" || source.span.parity === "even") span.parity = source.span.parity;
    if (Object.keys(span).length) output.span = span;
  }

  if (SHAPES.has(source.shape)) output.shape = source.shape;

  if (hasOwn(source, "oddCount") && source.oddCount !== "" && source.oddCount !== null) {
    const oddCount = clampInt(source.oddCount, 0, digitCount);
    if (oddCount !== null) output.oddCount = oddCount;
  }
  if (hasOwn(source, "bigCount") && source.bigCount !== "" && source.bigCount !== null) {
    const bigCount = clampInt(source.bigCount, 0, digitCount);
    if (bigCount !== null) output.bigCount = bigCount;
  }

  const contains = uniqueDigits(source.contains);
  if (contains.length) output.contains = contains;
  const excludes = uniqueDigits(source.excludes);
  if (excludes.length) output.excludes = excludes;
  if (source.consecutive === true || source.consecutive === false) output.consecutive = source.consecutive;

  return output;
}

// 顺子只用于三位。排序后公差为 1 算顺子（含 123、321、012）。
// 890 额外算顺子；901（排序后是 0,1,9）不算，避免把绕回的号码都算进去。
export function isStraight(digits) {
  if (digits.length !== 3) return false;
  const sorted = [...digits].sort((left, right) => left - right);
  const consecutive = sorted[1] === sorted[0] + 1 && sorted[2] === sorted[1] + 1;
  const eightNinety = sorted[0] === 0 && sorted[1] === 8 && sorted[2] === 9;
  return consecutive || eightNinety;
}

// 两位数字相差 1 即算有连号，不要求位置相邻。0 和 9 相差 9，不算。
export function hasConsecutive(digits) {
  for (let left = 0; left < digits.length; left += 1) {
    for (let right = left + 1; right < digits.length; right += 1) {
      if (Math.abs(digits[left] - digits[right]) === 1) return true;
    }
  }
  return false;
}

// 形态目前只认三位。排列五即使选了豹子也不会命中，避免把五位号码误判成 3D 形态。
function shapeMatches(shape, digits) {
  if (digits.length !== 3) return false;
  const unique = new Set(digits).size;
  if (shape === "leopard") return unique === 1;
  if (shape === "group3") return unique === 2;
  if (shape === "group6") return unique === 3;
  if (shape === "straight") return isStraight(digits);
  return false;
}

// 编成一个函数：传入号码数组，全部检查通过才返回 true。新增条件时在这里加一项 checks.push。
export function compileRule(definition, lottery) {
  const normalized = normalizeDefinition(definition, lottery);
  const checks = [];

  if (normalized.positions) {
    normalized.positions.forEach((position, index) => {
      if (!Object.keys(position).length) return;
      checks.push((digits) => {
        const value = digits[index];
        if (position.parity === "odd" && value % 2 === 0) return false;
        if (position.parity === "even" && value % 2 !== 0) return false;
        if (position.size === "big" && value < 5) return false;
        if (position.size === "small" && value >= 5) return false;
        if (position.prime === "prime" && !PRIMES.has(value)) return false;
        if (position.prime === "composite" && PRIMES.has(value)) return false;
        if (position.road !== undefined && value % 3 !== position.road) return false;
        if (position.digits && !position.digits.includes(value)) return false;
        return true;
      });
    });
  }

  if (normalized.sum) {
    checks.push((digits) => {
      let sum = 0;
      for (const value of digits) sum += value;
      if (normalized.sum.min !== undefined && sum < normalized.sum.min) return false;
      if (normalized.sum.max !== undefined && sum > normalized.sum.max) return false;
      if (normalized.sum.parity === "odd" && sum % 2 === 0) return false;
      if (normalized.sum.parity === "even" && sum % 2 !== 0) return false;
      if (normalized.sum.size === "big" && sum < lottery.sumBigMin) return false;
      if (normalized.sum.size === "small" && sum >= lottery.sumBigMin) return false;
      return true;
    });
  }

  if (normalized.span) {
    checks.push((digits) => {
      let min = digits[0];
      let max = digits[0];
      for (const value of digits) {
        if (value < min) min = value;
        if (value > max) max = value;
      }
      const span = max - min;
      if (normalized.span.min !== undefined && span < normalized.span.min) return false;
      if (normalized.span.max !== undefined && span > normalized.span.max) return false;
      if (normalized.span.parity === "odd" && span % 2 === 0) return false;
      if (normalized.span.parity === "even" && span % 2 !== 0) return false;
      return true;
    });
  }

  if (normalized.shape) checks.push((digits) => shapeMatches(normalized.shape, digits));
  if (normalized.oddCount !== undefined) {
    checks.push((digits) => digits.reduce((count, value) => count + (value % 2), 0) === normalized.oddCount);
  }
  if (normalized.bigCount !== undefined) {
    checks.push((digits) => digits.reduce((count, value) => count + (value >= 5 ? 1 : 0), 0) === normalized.bigCount);
  }
  if (normalized.contains) {
    checks.push((digits) => normalized.contains.every((value) => digits.includes(value)));
  }
  if (normalized.excludes) {
    checks.push((digits) => normalized.excludes.every((value) => !digits.includes(value)));
  }
  if (normalized.consecutive !== undefined) {
    checks.push((digits) => hasConsecutive(digits) === normalized.consecutive);
  }

  return (digits) => {
    if (!digits || digits.length !== lottery.digits) return false;
    for (const check of checks) {
      if (!check(digits)) return false;
    }
    return true;
  };
}

// 卡片上的那行灰字，例如「百单 · 十单 · 个双」。名称留空时也会用它当规则名。
export function describeDefinition(definition, lottery) {
  const normalized = normalizeDefinition(definition, lottery);
  const parts = [];

  if (normalized.positions) {
    normalized.positions.forEach((position, index) => {
      if (!Object.keys(position).length) return;
      const bits = [];
      if (position.parity) bits.push(position.parity === "odd" ? "单" : "双");
      if (position.size) bits.push(position.size === "big" ? "大" : "小");
      if (position.prime) bits.push(position.prime === "prime" ? "质" : "合");
      if (position.road !== undefined) bits.push(`${position.road}路`);
      if (position.digits) bits.push(position.digits.join("/"));
      const label = lottery.short[index];
      parts.push(bits.length === 1 ? `${label}${bits[0]}` : `${label}(${bits.join("、")})`);
    });
  }

  if (normalized.sum) {
    if (normalized.sum.min !== undefined) {
      parts.push(normalized.sum.min === normalized.sum.max
        ? `和值${normalized.sum.min}`
        : `和值${normalized.sum.min}–${normalized.sum.max}`);
    }
    if (normalized.sum.parity) parts.push(normalized.sum.parity === "odd" ? "和值单" : "和值双");
    if (normalized.sum.size) parts.push(normalized.sum.size === "big" ? "和值大" : "和值小");
  }
  if (normalized.span) {
    if (normalized.span.min !== undefined) {
      parts.push(normalized.span.min === normalized.span.max
        ? `跨度${normalized.span.min}`
        : `跨度${normalized.span.min}–${normalized.span.max}`);
    }
    if (normalized.span.parity) parts.push(normalized.span.parity === "odd" ? "跨度单" : "跨度双");
  }
  if (normalized.shape) parts.push(SHAPE_LABEL[normalized.shape]);
  if (normalized.oddCount !== undefined) parts.push(`奇数${normalized.oddCount}个`);
  if (normalized.bigCount !== undefined) parts.push(`大数${normalized.bigCount}个`);
  if (normalized.contains) parts.push(`含${normalized.contains.join("、")}`);
  if (normalized.excludes) parts.push(`不含${normalized.excludes.join("、")}`);
  if (normalized.consecutive === true) parts.push("有连号");
  if (normalized.consecutive === false) parts.push("无连号");
  return parts.join(" · ") || "全部开奖";
}

function invalidNumber(value, max, label) {
  if (value === undefined || value === null || value === "") return "";
  if (clampInt(value, 0, max) === null) return `${label}要填 0 到 ${max} 的整数`;
  return "";
}

// 入库前的最后一道检查。名称为空就用中文说明；说明是「全部开奖」时拒绝保存。
export function prepareRule({ name, definition }, lottery) {
  const source = definition && typeof definition === "object" ? definition : {};
  const sumError = source.sum
    ? invalidNumber(source.sum.min, lottery.sumMax, "和值") || invalidNumber(source.sum.max, lottery.sumMax, "和值")
    : "";
  const spanError = source.span
    ? invalidNumber(source.span.min, 9, "跨度") || invalidNumber(source.span.max, 9, "跨度")
    : "";
  const message = sumError || spanError;
  if (message) {
    const error = new Error(message);
    error.status = 400;
    throw error;
  }

  const normalized = normalizeDefinition(source, lottery);
  if (!Object.keys(normalized).length) {
    const error = new Error("请至少加一个条件");
    error.status = 400;
    throw error;
  }

  const summary = describeDefinition(normalized, lottery);
  let title = String(name || "").trim();
  if (!title) title = summary;
  if ([...title].length > 40) {
    const error = new Error("规则名称最多 40 个字");
    error.status = 400;
    throw error;
  }
  return { name: title, definition: normalized, summary };
}

// 第一次建库时插入。改这里不会更新已经在数据库里的规则。
// 三位彩种用单双形态；排列五没有豹子/组三/组六/顺子，改用全单、全双和连号。
export function presetRules(lottery) {
  if (lottery?.digits === 5) {
    const positions = (parity) => Array.from({ length: 5 }, () => ({ parity }));
    return [
      { name: "全双", definition: { positions: positions("even") } },
      { name: "全单", definition: { positions: positions("odd") } },
      { name: "和值大", definition: { sum: { size: "big" } } },
      { name: "有连号", definition: { consecutive: true } },
    ];
  }
  return [
    {
      name: "单单双",
      definition: { positions: [{ parity: "odd" }, { parity: "odd" }, { parity: "even" }] },
    },
    {
      name: "双双双",
      definition: { positions: [{ parity: "even" }, { parity: "even" }, { parity: "even" }] },
    },
    { name: "豹子", definition: { shape: "leopard" } },
    { name: "组六", definition: { shape: "group6" } },
    { name: "顺子", definition: { shape: "straight" } },
    { name: "和值大", definition: { sum: { size: "big" } } },
  ];
}
