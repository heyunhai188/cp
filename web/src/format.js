export function clampN(value) {
  const number = Number(value);
  if (!Number.isInteger(number)) return 100;
  return Math.min(5000, Math.max(1, number));
}

export function percent(ratio) {
  if (ratio === null || ratio === undefined) return "—";
  return `${(ratio * 100).toFixed(1)}%`;
}

export function omissionLabel(omission) {
  if (omission === null || omission === undefined) return { text: "库内未出现", kind: "" };
  if (omission === 0) return { text: "最新一期命中", kind: "fresh" };
  return { text: `遗漏 ${omission} 期`, kind: "plain" };
}

export function formatElapsed(ms) {
  if (!Number.isFinite(ms) || ms < 1) return "不到 1 毫秒";
  return `${ms} 毫秒`;
}

export function formatWhen(iso) {
  if (!iso) return "";
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return "";
  return date.toLocaleString("zh-CN", { hour12: false });
}

export function formatStamp(value) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "";
  const pad = (number) => String(number).padStart(2, "0");
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())} ${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

export function formatCount(value) {
  if (value >= 10) return value.toFixed(1);
  if (value >= 0.1) return value.toFixed(2);
  return value.toFixed(3);
}

export function formatRate(hits, trials) {
  if (!trials || !hits) return "0%";
  const pct = (100 * hits) / trials;
  if (pct >= 0.1) return `${pct.toFixed(2)}%`;
  return `${pct.toFixed(3)}%`;
}

export function formatBets(value) {
  const rounded = Math.round(value);
  return Math.abs(value - rounded) < 0.05 ? String(rounded) : value.toFixed(1);
}

export function formatMoney(value) {
  const negative = value < 0;
  const abs = Math.abs(value);
  const text = Number.isInteger(abs) ? String(abs) : abs.toFixed(2);
  const [whole, fraction] = text.split(".");
  const grouped = whole.replace(/\B(?=(\d{3})+(?!\d))/g, ",");
  return `${negative ? "-" : ""}${grouped}${fraction ? `.${fraction}` : ""}`;
}

export function readMultiple(value) {
  const text = String(value).trim();
  if (!text) return 1;
  const number = Number(text);
  if (!Number.isInteger(number) || number < 1 || number > 9999) return null;
  return number;
}

export function readPrize(value) {
  const text = String(value).replace(/,/g, "").trim();
  if (!text) return null;
  const number = Number(text);
  if (!Number.isFinite(number) || number < 0) return null;
  return number;
}

export function longestText(longest) {
  if (!longest?.length) return "这段里没有连续未中";
  if (longest.length === 1) return `${longest.fromDate} ${longest.fromIssue}`.trim();
  return `${longest.fromDate} ${longest.fromIssue} → ${longest.toDate} ${longest.toIssue}`.trim();
}
