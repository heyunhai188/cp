// 决定这次要入库哪些期，不直接写数据库，方便测试。
// 官网按「新的在前」分页。本地数据保持「从最新一期往旧连续」，中间不留洞。
// auto 且本地为空：只取最新 limit 期。
// auto 且已有数据：从第 1 页往后翻，整页写入（用来覆盖更正），直到这一页最旧的期号已经在库里。
// backfill：二分找到第一页里还有本地没有的期号，再往后收集，最多 limit 条。
export async function planSync({
  mode,
  known,
  limit,
  fetchPage,
  pageSize = 100,
  pause = async () => {},
}) {
  const first = await fetchPage(1);
  const firstRows = first.result || [];
  const total = Number(first.total) || firstRows.length;
  const size = Math.max(1, firstRows.length || pageSize);
  const pages = Math.max(1, Math.ceil((total || firstRows.length || 1) / size));

  async function pageRows(page) {
    if (page === 1) return firstRows;
    await pause();
    const data = await fetchPage(page);
    return data.result || [];
  }

  if (!firstRows.length && !total) return { rows: [], total: 0, complete: true };

  if (mode === "auto" && known.size === 0) {
    const rows = [];
    for (let page = 1; page <= pages && rows.length < limit; page += 1) {
      const batch = await pageRows(page);
      if (!batch.length) break;
      rows.push(...batch);
    }
    return { rows: rows.slice(0, limit), total, complete: false };
  }

  if (mode === "auto") {
    const rows = [];
    for (let page = 1; page <= pages; page += 1) {
      const batch = await pageRows(page);
      if (!batch.length) break;
      rows.push(...batch);
      const oldest = batch[batch.length - 1];
      if (oldest && known.has(oldest.issue)) break;
      if (rows.length >= 1000) break;
    }
    return { rows, total, complete: false };
  }

  let left = 1;
  let right = pages;
  let start = -1;
  while (left <= right) {
    const mid = (left + right) >> 1;
    const batch = await pageRows(mid);
    const hasUnknown = batch.some((row) => row && !known.has(row.issue));
    if (hasUnknown) {
      start = mid;
      right = mid - 1;
    } else {
      left = mid + 1;
    }
  }
  if (start < 0) return { rows: [], total, complete: true };

  const rows = [];
  for (let page = start; page <= pages && rows.length < limit; page += 1) {
    const batch = await pageRows(page);
    if (!batch.length) break;
    for (const row of batch) {
      if (!known.has(row.issue)) rows.push(row);
      if (rows.length >= limit) break;
    }
  }
  return { rows, total, complete: false };
}

// 今晚的自动同步只在官网最新一期的开奖日就是今天时结束。昨天的号码还在官网最前面时，要继续等到 22:30。
export function officialDrawIsToday(latestDate, today) {
  return Boolean(today) && latestDate === today;
}

export function syncMessage(mode, result, planned) {
  if (planned.complete && result.inserted === 0) return "官网已公布的期数都在本地了。";
  if (result.inserted && result.updated) return `新增 ${result.inserted} 期，更正 ${result.updated} 期。`;
  if (result.inserted) {
    return mode === "backfill"
      ? `又向前补了 ${result.inserted} 期。`
      : `新增 ${result.inserted} 期。`;
  }
  if (result.updated) return `没有新期，已按官网更正 ${result.updated} 期。`;
  return "已经是最新数据。";
}
