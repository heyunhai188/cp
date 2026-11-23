// 预测存档按「当时最新一期」保存，用来核对紧接着的下一期。
// 只用这一期和更早的开奖计算，避免事后补档时看到已经开出的号码。
import { getDraws, getForecast, saveForecast } from "./db.js";
import { getLottery } from "./lottery.js";
import { archivePayload, predict } from "./predict.js";

export function missingForecastWindows(draws, savedIssues, lookback = 15) {
  const saved = savedIssues instanceof Set ? savedIssues : new Set(savedIssues || []);
  const limit = Math.min(Math.max(lookback, 0), draws?.length || 0);
  const windows = [];
  for (let index = 0; index < limit; index += 1) {
    if (saved.has(draws[index].issue)) continue;
    windows.push({ issue: draws[index].issue, draws: draws.slice(index) });
  }
  return windows;
}

export function ensureAdvanceForecasts(lotteryCode, { lookback = 15, n = 100 } = {}) {
  const lottery = getLottery(lotteryCode);
  if (lottery.source === "local") return [];
  const draws = getDraws(lottery.code);
  const savedIssues = new Set();
  for (const draw of draws.slice(0, Math.min(lookback, draws.length))) {
    if (getForecast(lottery.code, draw.issue)) savedIssues.add(draw.issue);
  }
  const inserted = [];
  for (const window of missingForecastWindows(draws, savedIssues, lookback)) {
    const result = predict(window.draws, lottery, n, null);
    const saved = saveForecast({
      lotteryCode: lottery.code,
      basedIssue: window.issue,
      n: result.n,
      k: result.k,
      payload: archivePayload(result),
      replace: false,
    });
    if (saved.inserted) inserted.push(window.issue);
  }
  return inserted;
}
