// 体彩官网历史开奖。排列三、排列五共用这个接口，用 lottery.gameNo 区分。
// 必须用 lotteryDrawResult。排列三的 lotteryUnsortDrawresult 会带上排列五的后两位，不能拿来入库。
const API = "https://webapi.sporttery.cn/gateway/lottery/getHistoryPageListV1.qry";

const HEADERS = {
  "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36",
  Referer: "https://www.lottery.gov.cn/",
  Accept: "application/json, text/javascript, */*; q=0.01",
  "Accept-Language": "zh-CN,zh;q=0.9",
};

const WEEKDAYS = "日一二三四五六";

export function weekdayFromDate(iso) {
  const matched = String(iso || "").match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!matched) return "";
  const date = new Date(Number(matched[1]), Number(matched[2]) - 1, Number(matched[3]));
  return WEEKDAYS[date.getDay()] || "";
}

export function mapSportteryDraw(row, digitCount) {
  try {
    const issue = String(row?.lotteryDrawNum || "").trim();
    const drawDate = String(row?.lotteryDrawTime || "").slice(0, 10);
    const parts = String(row?.lotteryDrawResult || "").trim().split(/[\s,，]+/).filter(Boolean).map(Number);
    if (!issue || !/^\d{4}-\d{2}-\d{2}$/.test(drawDate)) return null;
    if (parts.length !== digitCount || parts.some((number) => !Number.isInteger(number) || number < 0 || number > 9)) {
      throw new Error(`号码无法解析: ${row?.lotteryDrawResult}`);
    }
    return {
      issue,
      drawDate,
      week: weekdayFromDate(drawDate),
      digits: parts,
      sales: String(row.totalSaleAmount || "").replace(/,/g, ""),
      source: "sporttery",
    };
  } catch (error) {
    console.warn(`跳过无法解析的体彩开奖 ${row?.lotteryDrawNum || ""}: ${error.message}`);
    return null;
  }
}

export async function fetchSportteryPage(lottery, pageNo, pageSize) {
  const url = new URL(API);
  url.searchParams.set("gameNo", lottery.gameNo);
  url.searchParams.set("provinceId", "0");
  url.searchParams.set("pageSize", String(pageSize));
  url.searchParams.set("isVerify", "1");
  url.searchParams.set("pageNo", String(pageNo));

  let response;
  try {
    response = await fetch(url, { headers: HEADERS, signal: AbortSignal.timeout(20000) });
  } catch (error) {
    const wrapped = new Error("连不上体彩官网，请检查网络后再同步");
    wrapped.status = 502;
    wrapped.cause = error;
    throw wrapped;
  }
  if (!response.ok) {
    const error = new Error(`体彩官网响应 ${response.status}`);
    error.status = 502;
    throw error;
  }

  let data;
  try {
    data = await response.json();
  } catch {
    const error = new Error("体彩官网没有返回开奖数据，请稍后再试");
    error.status = 502;
    throw error;
  }
  if (String(data.errorCode) !== "0") {
    const error = new Error(data.errorMessage || "体彩官网查询失败");
    error.status = 502;
    throw error;
  }

  const value = data.value || {};
  return {
    total: Number(value.total) || 0,
    result: (value.list || []).map((row) => mapSportteryDraw(row, lottery.digits)).filter(Boolean),
  };
}
