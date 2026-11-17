import { fetchDrawPage } from "./cwl.js";
import { LOTTERIES } from "./lottery.js";
import { fetchSportteryPage } from "./sporttery.js";
import {
  addSyncLog,
  getDraws,
  setRemoteTotal,
  upsertDraws,
} from "./db.js";
import { planSync, syncMessage } from "./sync.js";

const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

// 福彩和体彩的分页格式不一样，这里收成 planSync 需要的 { total, result }。
function pageFetcher(lottery) {
  if (lottery.source === "cwl") return (page) => fetchDrawPage(page, 100, lottery.digits);
  if (lottery.source === "sporttery") return (page) => fetchSportteryPage(lottery, page, 100);
  const error = new Error(`${lottery.name} 还没有对应的官网拉取`);
  error.status = 400;
  throw error;
}

// 一次同步的入口。limit 就是「获取近 500 期 / 向前补 500 期」里的 500。
// 空库时即使用户点了补历史，也先按 auto 拉最新 500 期。失败会记一条 sync_log，不清空已有数据。

export async function syncDraws(lotteryCode, mode) {
  const lottery = LOTTERIES[lotteryCode];
  if (!lottery) {
    const error = new Error("未知彩种");
    error.status = 400;
    throw error;
  }
  const fetchPage = pageFetcher(lottery);
  const safeMode = mode === "backfill" ? "backfill" : "auto";
  try {
    const known = new Set(getDraws(lotteryCode).map((draw) => draw.issue));
    const planned = await planSync({
      mode: known.size === 0 ? "auto" : safeMode,
      known,
      limit: 500,
      pageSize: 100,
      pause: () => delay(120),
      fetchPage,
    });
    const written = upsertDraws(lotteryCode, planned.rows);
    setRemoteTotal(lotteryCode, planned.total);
    const message = syncMessage(known.size === 0 ? "auto" : safeMode, written, planned);
    addSyncLog({
      lotteryCode,
      mode: safeMode,
      ok: true,
      message,
      inserted: written.inserted,
      updated: written.updated,
    });
    return {
      ...written,
      message,
      totalRemote: planned.total,
      latestDate: planned.rows[0]?.drawDate || "",
    };
  } catch (error) {
    addSyncLog({
      lotteryCode,
      mode: safeMode,
      ok: false,
      message: error.message || "同步失败",
    });
    throw error;
  }
}
