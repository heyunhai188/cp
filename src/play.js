// 模拟直选。每位选 1 个或多个号，注数是各位个数相乘，每注 2 元。
// 开奖号每一位都落在所选号码里算中。复式只中这一注的奖金，不按注数重复派奖。

export const UNIT_PRICE = 2;

export const DIRECT_PRIZE = {
  fc3d: 1040,
  pl3: 1040,
  pl5: 100000,
};

export function normalizeSelection(selection, digits) {
  if (!Array.isArray(selection) || selection.length !== digits) {
    const error = new Error("每位都要选号");
    error.status = 400;
    throw error;
  }
  return selection.map((bag) => {
    if (!Array.isArray(bag) || bag.length === 0) {
      const error = new Error("每位至少选择 1 个号码");
      error.status = 400;
      throw error;
    }
    const unique = [...new Set(bag.map((value) => Number(value)))];
    if (unique.some((value) => !Number.isInteger(value) || value < 0 || value > 9)) {
      const error = new Error("号码只能是 0 到 9");
      error.status = 400;
      throw error;
    }
    return unique.sort((left, right) => left - right);
  });
}

export function countBets(selection) {
  return selection.reduce((total, bag) => total * bag.length, 1);
}

export function directHit(selection, digits) {
  return selection.every((bag, index) => bag.includes(digits[index]));
}

export const MAX_MULTIPLE = 99;
export const DEFAULT_DEADLINE = "21:00";
const WEEKDAYS = ["周日", "周一", "周二", "周三", "周四", "周五", "周六"];

export function normalizeMultiple(value) {
  const multiple = Number(value ?? 1);
  if (!Number.isInteger(multiple) || multiple < 1 || multiple > MAX_MULTIPLE) {
    const error = new Error("倍数要在 1 到 99");
    error.status = 400;
    throw error;
  }
  return multiple;
}

export function normalizeDeadline(value) {
  const match = /^(\d{1,2}):(\d{2})(?::\d{2})?$/.exec(String(value || "").trim());
  if (!match) {
    const error = new Error("截止时间写成 21:00 这样");
    error.status = 400;
    throw error;
  }
  const hour = Number(match[1]);
  const minute = Number(match[2]);
  if (hour > 23 || minute > 59) {
    const error = new Error("截止时间写成 21:00 这样");
    error.status = 400;
    throw error;
  }
  return `${String(hour).padStart(2, "0")}:${String(minute).padStart(2, "0")}`;
}

export function lineStake(bets, multiple) {
  return bets * UNIT_PRICE * multiple;
}

export function linePrize(unitPrize, multiple, hit) {
  if (!hit) return 0;
  return (Number(unitPrize) || 0) * multiple;
}

function parseDay(value) {
  const [year, month, day] = String(value).split("-").map(Number);
  return new Date(year, month - 1, day);
}

function formatDay(date) {
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${date.getFullYear()}-${month}-${day}`;
}

function addDays(date, days) {
  return new Date(date.getFullYear(), date.getMonth(), date.getDate() + days);
}

function atTime(date, time) {
  const [hour, minute] = time.split(":").map(Number);
  return new Date(date.getFullYear(), date.getMonth(), date.getDate(), hour, minute, 0, 0);
}

// 期号按天往后推。跨年时体彩 26365 变成 27001，福彩 2026365 变成 2027001。
export function advanceIssue(issue, fromDate, toDate) {
  const text = String(issue);
  if (!/^\d{5,8}$/.test(text)) return text;
  const yearLength = text.length >= 7 ? 4 : 2;
  let year = Number(text.slice(0, yearLength));
  let sequence = Number(text.slice(yearLength));
  const sequenceLength = text.length - yearLength;
  let cursor = parseDay(formatDay(fromDate));
  const end = parseDay(formatDay(toDate)).getTime();
  while (cursor.getTime() < end) {
    cursor = addDays(cursor, 1);
    if (cursor.getMonth() === 0 && cursor.getDate() === 1) {
      year = yearLength === 4 ? cursor.getFullYear() : cursor.getFullYear() % 100;
      sequence = 1;
    } else {
      sequence += 1;
    }
  }
  return String(year) + String(sequence).padStart(sequenceLength, "0");
}

// 下一期还没到截止时间就买这一期；过了截止时间就改买再下一期。
export function upcomingWindow(latest, time, now = new Date()) {
  const deadlineTime = normalizeDeadline(time);
  const latestDate = parseDay(latest.drawDate);
  let target = addDays(latestDate, 1);
  let deadline = atTime(target, deadlineTime);
  let guard = 0;
  while (now.getTime() >= deadline.getTime() && guard < 800) {
    target = addDays(target, 1);
    deadline = atTime(target, deadlineTime);
    guard += 1;
  }
  const month = String(target.getMonth() + 1).padStart(2, "0");
  const day = String(target.getDate()).padStart(2, "0");
  const ahead = Math.max(1, Math.round((parseDay(formatDay(target)) - latestDate) / 86400000));
  return {
    issue: advanceIssue(latest.issue, latestDate, target),
    date: formatDay(target),
    ahead,
    label: `${month}-${day}（${WEEKDAYS[target.getDay()]}）`,
    time: deadlineTime,
    deadline: deadline.toISOString(),
  };
}
