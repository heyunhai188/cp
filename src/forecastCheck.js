// 把已经存下来的预测和后来开出的号码对比。直选要每一位都相同，复式要每一位的开奖号都在所选号码里。

function sameDigits(left, right) {
  return left.length === right.length && left.every((digit, index) => digit === right[index]);
}

function compoundHit(group, digits) {
  if (!group?.positions || group.positions.length !== digits.length) return false;
  return group.positions.every((position, index) => position.digits.includes(digits[index]));
}

function directHits(list, digits) {
  return (list || []).filter((item) => sameDigits(item.digits, digits)).map((item) => item.name);
}

export function gradeForecast(payload, digits) {
  return {
    jointDirects: directHits(payload.jointDirects, digits),
    jointCompound: compoundHit(payload.jointCompound, digits),
    hotDirects: directHits(payload.hotDirects, digits),
    hotCompound: compoundHit(payload.hotCompound, digits),
    coldCompound: compoundHit(payload.coldCompound, digits),
  };
}

// 综合、热号、冷号里，直选和复式任意一项对上就算中。
export function forecastMatched(grade) {
  return Boolean(
    grade?.jointDirects?.length ||
    grade?.jointCompound ||
    grade?.hotDirects?.length ||
    grade?.hotCompound ||
    grade?.coldCompound
  );
}

// 只给最新一期打标。row 必须是紧挨着它的上一期存档；还没开奖、对不上这一期、或没有存档时不标。
export function markLatestForecast(draws, row) {
  if (!row || !draws?.length) return null;
  const [reviewed] = reviewForecasts(draws, [row]);
  if (reviewed?.status !== "drawn" || reviewed.resultIssue !== draws[0].issue) return null;
  return forecastMatched(reviewed.grade) ? "hit" : "miss";
}

// draws 必须是新的在前。存档依据的期号如果已经不是最新，紧挨着它的更新一期就是要核对的开奖。
export function reviewForecasts(draws, rows) {
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
      grade: gradeForecast(row.payload, draw.digits),
    };
  });
}
