// 专家推荐和系统预测用同一套中奖口径：直选每一位相同，或复式每一位都包住开奖号。
// 没提交的期不出现，也不计入中奖率。窗口只取每位专家自己最近的已开奖推荐。

const MAX_DIRECTS = 8;

function sameDigits(left, right) {
  return left.length === right.length && left.every((digit, index) => digit === right[index]);
}

function digitsOf(value, width) {
  const source = Array.isArray(value?.digits) ? value.digits : value;
  if (!Array.isArray(source) || source.length !== width) return null;
  const digits = source.map(Number);
  if (digits.some((digit) => !Number.isInteger(digit) || digit < 0 || digit > 9)) return null;
  return digits;
}

function positionDigits(value) {
  const source = Array.isArray(value?.digits) ? value.digits : value;
  if (!Array.isArray(source) || !source.length) return null;
  const digits = [...new Set(source.map(Number))].sort((left, right) => left - right);
  if (digits.some((digit) => !Number.isInteger(digit) || digit < 0 || digit > 9)) return null;
  return digits;
}

export function normalizeExpertPick(input, lottery) {
  if (input?.clear) return null;
  const width = lottery.digits;
  const rawDirects = Array.isArray(input?.directs) ? input.directs : [];
  if (rawDirects.length > MAX_DIRECTS) {
    const error = new Error("直选最多 8 注");
    error.status = 400;
    throw error;
  }
  const directs = [];
  const seen = new Set();
  for (const item of rawDirects) {
    const digits = digitsOf(item, width);
    if (!digits) {
      const error = new Error("直选号码不完整");
      error.status = 400;
      throw error;
    }
    const key = digits.join(",");
    if (seen.has(key)) continue;
    seen.add(key);
    directs.push(digits);
  }

  let compound = null;
  if (input?.compound) {
    const source = Array.isArray(input.compound) ? input.compound : input.compound.positions;
    if (!Array.isArray(source) || source.length !== width) {
      const error = new Error("复式要覆盖每一个位置");
      error.status = 400;
      throw error;
    }
    const positions = lottery.positions.map((name, index) => {
      const digits = positionDigits(source[index]);
      if (!digits) {
        const error = new Error("复式每一位至少选一个号");
        error.status = 400;
        throw error;
      }
      return { name, digits };
    });
    compound = {
      positions,
      bets: positions.reduce((total, position) => total * position.digits.length, 1),
    };
  }
  if (!directs.length && !compound) return null;
  return { directs, compound };
}

export function expertHit(pick, digits) {
  const directHit = (pick?.directs || []).some((item) => sameDigits(item, digits));
  const positions = pick?.compound?.positions;
  const compoundHit = Boolean(
    positions &&
    positions.length === digits.length &&
    positions.every((position, index) => position.digits.includes(digits[index]))
  );
  return { hit: directHit || compoundHit, directHit, compoundHit };
}

export function expertWindowSize(value) {
  if (value === "all" || value === "0" || value === 0) return null;
  const number = Number(value);
  if (!Number.isInteger(number) || number < 1) return 100;
  return Math.min(5000, number);
}

// draws 必须是新的在前。依据期号仍是最新时，这份推荐还没开奖。
export function reviewExpertPicks(draws, rows) {
  return rows.map((row) => {
    const index = draws.findIndex((draw) => draw.issue === row.basedIssue);
    if (index < 0) return { ...row, status: "missing" };
    if (index === 0) return { ...row, status: "pending" };
    const draw = draws[index - 1];
    return {
      ...row,
      status: "drawn",
      resultIssue: draw.issue,
      resultDate: draw.drawDate,
      resultDigits: draw.digits,
      recency: index - 1,
      ...expertHit(row, draw.digits),
    };
  });
}

export function expertBoard(draws, rows, windowSize) {
  const reviewed = reviewExpertPicks(draws, rows);
  const latest = draws[0]?.issue || "";
  const byUser = new Map();
  for (const row of reviewed) {
    if (!byUser.has(row.userId)) {
      byUser.set(row.userId, { userId: row.userId, username: row.username, drawn: [], current: null });
    }
    const bucket = byUser.get(row.userId);
    if (row.status === "drawn") bucket.drawn.push(row);
    if (row.status === "pending" && row.basedIssue === latest) bucket.current = row;
  }

  const current = [];
  const history = [];
  for (const bucket of byUser.values()) {
    bucket.drawn.sort((left, right) => left.recency - right.recency);
    const sample = windowSize ? bucket.drawn.slice(0, windowSize) : bucket.drawn;
    const hits = sample.filter((item) => item.hit).length;
    const rate = sample.length ? { hits, graded: sample.length, ratio: hits / sample.length } : null;
    if (bucket.current) {
      current.push({
        userId: bucket.userId,
        username: bucket.username,
        rate,
        directs: bucket.current.directs,
        compound: bucket.current.compound,
      });
    }
    for (const item of sample) {
      history.push({
        userId: bucket.userId,
        username: bucket.username,
        basedIssue: item.basedIssue,
        resultIssue: item.resultIssue,
        resultDate: item.resultDate,
        resultDigits: item.resultDigits,
        hit: item.hit,
        directs: item.directs,
        compound: item.compound,
        recency: item.recency,
      });
    }
  }
  current.sort((left, right) => {
    const leftRatio = left.rate?.ratio ?? -1;
    const rightRatio = right.rate?.ratio ?? -1;
    if (rightRatio !== leftRatio) return rightRatio - leftRatio;
    const leftGraded = left.rate?.graded ?? 0;
    const rightGraded = right.rate?.graded ?? 0;
    if (rightGraded !== leftGraded) return rightGraded - leftGraded;
    return left.username.localeCompare(right.username, "zh");
  });
  history.sort((left, right) => left.recency - right.recency || left.username.localeCompare(right.username, "zh"));
  return { basedIssue: latest, window: windowSize, current, history };
}
