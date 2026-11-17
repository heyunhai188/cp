// 福彩官网开奖查询。只负责把原始 JSON 收成 { issue, drawDate, week, digits, sales }。
// 官网要求带浏览器头，否则可能返回空页面。red 有时是 "1,9,0"，有时是 "190"，两种都认。
const API = "https://www.cwl.gov.cn/cwl_admin/front/cwlkj/search/kjxx/findDrawNotice";

const HEADERS = {
  "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36",
  Referer: "https://www.cwl.gov.cn/ygkj/wqkjgg/3d/",
  Accept: "application/json, text/javascript, */*; q=0.01",
  "X-Requested-With": "XMLHttpRequest",
  "Accept-Language": "zh-CN,zh;q=0.9",
};

// 官网日期形如 2026-11-10(二)，只留下 YYYY-MM-DD。
export function parseDate(value) {
  const matched = String(value || "").match(/(\d{4}-\d{2}-\d{2})/);
  return matched ? matched[1] : "";
}

export function parseDigits(value, digitCount) {
  const text = String(value || "").trim();
  const parts = text.split(/[,，\s]+/).filter(Boolean);
  const numbers = parts.length === 1 && parts[0].length === digitCount
    ? [...parts[0]].map(Number)
    : parts.map(Number);
  if (numbers.length !== digitCount || numbers.some((number) => !Number.isInteger(number) || number < 0 || number > 9)) {
    throw new Error(`号码无法解析: ${value}`);
  }
  return numbers;
}

export function mapDraw(row, digitCount) {
  try {
    const issue = String(row?.code || "").trim();
    const drawDate = parseDate(row?.date);
    if (!issue || !drawDate) return null;
    return {
      issue,
      drawDate,
      week: row.week || "",
      digits: parseDigits(row.red, digitCount),
      sales: row.sales || "",
      source: "cwl",
    };
  } catch (error) {
    console.warn(`跳过无法解析的开奖 ${row?.code || ""}: ${error.message}`);
    return null;
  }
}

export async function fetchDrawPage(pageNo, pageSize, digitCount) {
  const url = new URL(API);
  const params = {
    name: "3d",
    issueCount: "",
    issueStart: "",
    issueEnd: "",
    dayStart: "",
    dayEnd: "",
    pageNo: String(pageNo),
    pageSize: String(pageSize),
    week: "",
    systemType: "PC",
  };
  for (const [key, value] of Object.entries(params)) url.searchParams.set(key, value);

  let response;
  try {
    response = await fetch(url, { headers: HEADERS, signal: AbortSignal.timeout(20000) });
  } catch (error) {
    const wrapped = new Error("连不上福彩官网，请检查网络后再同步");
    wrapped.status = 502;
    wrapped.cause = error;
    throw wrapped;
  }
  if (!response.ok) {
    const error = new Error(`福彩官网响应 ${response.status}`);
    error.status = 502;
    throw error;
  }

  let data;
  try {
    data = await response.json();
  } catch {
    const error = new Error("福彩官网没有返回开奖数据，请稍后再试");
    error.status = 502;
    throw error;
  }
  if (data.state !== 0) {
    const error = new Error(data.message || "福彩官网查询失败");
    error.status = 502;
    throw error;
  }

  return {
    total: Number(data.total) || 0,
    result: (data.result || []).map((row) => mapDraw(row, digitCount)).filter(Boolean),
  };
}
