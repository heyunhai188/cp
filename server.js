// 本机服务。默认只绑定 127.0.0.1。接口在这个文件底部，页面是 web/dist 里的 Vue 构建结果。
// 启动：npm start ，然后打开 http://127.0.0.1:3840 。改页面后先 npm run build。
import fs from "node:fs";
import http from "node:http";
import path from "node:path";
import { randomBytes, randomInt } from "node:crypto";
import { fileURLToPath } from "node:url";
import {
  countDrawsByLottery,
  adminDataSummary,
  clearAdminData,
  createRule,
  cancelPlayOrder,
  changePassword,
  createPlayOrders,
  createRole,
  createSession,
  createUser,
  deleteRole,
  deleteRule,
  dismissPlayOrder,
  deleteSession,
  deleteUser,
  findUserByUsername,
  getDraws,
  getForecast,
  getPlayDeadline,
  getRemoteTotal,
  getRule,
  getSessionUser,
  getScheduledSyncState,
  initDatabase,
  lastSync,
  trimOldestDraws,
  listForecasts,
  listPlayOrders,
  playAdminReport,
  playBalance,
  playPrizesFor,
  queuePlaySettlement,
  listRoles,
  listRules,
  listUsers,
  listExpertPicks,
  markScheduledSyncComplete,
  markScheduledSyncLottery,
  markScheduledSyncSlot,
  queryDraws,
  resetUserPassword,
  saveExpertPick,
  saveForecast,
  savePlayDeadlines,
  SESSION_TTL_SECONDS,
  setPlayBalance,
  setUserPlayPrizes,
  setUserRecommend,
  takeInitialAdmin,
  updateRule,
  updateRolePlay,
} from "./src/db.js";
import { expertBoard, expertWindowSize, normalizeExpertPick } from "./src/expert.js";
import { markLatestForecast, reviewForecasts } from "./src/forecastCheck.js";
import { getLottery, listLotteries } from "./src/lottery.js";
import { hashPassword, randomPassword, verifyPassword } from "./src/password.js";
import { upcomingWindow } from "./src/play.js";
import { compileRule, describeDefinition, prepareRule } from "./src/rules.js";
import { backtestLottery, BACKTEST_METHODS } from "./src/backtest.js";
import { archivePayload, predict } from "./src/predict.js";
import { presentDraw, summarize } from "./src/stats.js";
import { officialDrawIsToday } from "./src/sync.js";
import { syncDraws } from "./src/syncDraws.js";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)));
const webDir = path.join(root, "web", "dist");
const PORT = Number(process.env.PORT) || 3840;
const HOST = process.env.HOST || "127.0.0.1";

const TYPES = {
  ".html": "text/html; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".svg": "image/svg+xml",
};

// 同步要连着请求官网，同时点两次会互相打架，所以加一把锁。
let syncing = false;
const backtestCache = new Map();
const captchaChallenges = new Map();
const captchaFetches = new Map();
const loginFailuresByIp = new Map();
const loginFailuresByAccount = new Map();
const captchaAlphabet = "23456789ABCDEFGHJKLMNPQRSTUVWXYZ";
const dummyPasswordHash = hashPassword(randomPassword());
const beijingClock = new Intl.DateTimeFormat("en-CA", {
  timeZone: "Asia/Shanghai",
  year: "numeric", month: "2-digit", day: "2-digit",
  hour: "2-digit", minute: "2-digit", second: "2-digit", hourCycle: "h23",
});
initDatabase();
const createdAdmin = takeInitialAdmin();
if (createdAdmin) {
  const credentialFile = path.join(root, "data", "admin-initial.txt");
  fs.writeFileSync(credentialFile, `账号: ${createdAdmin.username}\n密码: ${createdAdmin.password}\n`, "utf8");
  console.log("超级管理员已创建，初始密码写在 data/admin-initial.txt");
}

function send(response, status, payload, extraHeaders = {}) {
  const body = JSON.stringify(payload);
  response.writeHead(status, {
    "Content-Type": "application/json; charset=utf-8",
    "Cache-Control": "no-store",
    "X-Content-Type-Options": "nosniff",
    "X-Frame-Options": "DENY",
    "Referrer-Policy": "same-origin",
    "X-Robots-Tag": "noindex, nofollow, noarchive",
    "Content-Security-Policy": "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; connect-src 'self'; object-src 'none'; base-uri 'self'; frame-ancestors 'none'; form-action 'self'",
    "Content-Length": Buffer.byteLength(body),
    ...extraHeaders,
  });
  response.end(body);
}

const LOOPBACKS = new Set(["127.0.0.1", "::1", "::ffff:127.0.0.1"]);
function clientAddress(request) {
  const peer = String(request.socket.remoteAddress || "").toLowerCase();
  // 只信任本机反代传来的地址；取 X-Forwarded-For 最右侧的代理追加值，避免客户端伪造左侧字段。
  if (LOOPBACKS.has(peer)) {
    const forwarded = String(request.headers["x-real-ip"] || request.headers["x-forwarded-for"] || "");
    const address = forwarded.split(",").at(-1)?.trim();
    if (address) return address.slice(0, 80);
  }
  return peer || "unknown";
}

function pruneBuckets(map, olderThan) {
  const now = Date.now();
  for (const [key, value] of map) {
    if (value.updatedAt < olderThan || map.size > 8000) map.delete(key);
  }
  return now;
}

function takeBucket(map, key, now) {
  let bucket = map.get(key);
  if (!bucket) {
    bucket = { attempts: [], blockedUntil: 0, updatedAt: now };
    map.set(key, bucket);
  }
  bucket.attempts = bucket.attempts.filter((stamp) => stamp > now - 15 * 60 * 1000);
  bucket.updatedAt = now;
  return bucket;
}

function loginBlock(ip, accountKey) {
  const now = pruneBuckets(loginFailuresByIp, nowMinusDay());
  pruneBuckets(loginFailuresByAccount, now - 24 * 60 * 60 * 1000);
  const ipBucket = loginFailuresByIp.get(ip);
  const userBucket = loginFailuresByAccount.get(accountKey);
  const blockedUntil = Math.max(ipBucket?.blockedUntil || 0, userBucket?.blockedUntil || 0);
  return Math.max(0, blockedUntil - now);
}

function nowMinusDay() {
  return Date.now() - 24 * 60 * 60 * 1000;
}

function recordLoginFailure(ip, accountKey) {
  const now = Date.now();
  for (const [map, key, limit, lockMs] of [
    [loginFailuresByIp, ip, 20, 30 * 60 * 1000],
    [loginFailuresByAccount, accountKey, 5, 15 * 60 * 1000],
  ]) {
    const bucket = takeBucket(map, key, now);
    bucket.attempts.push(now);
    if (bucket.attempts.length >= limit) {
      bucket.blockedUntil = now + lockMs;
      bucket.attempts = [];
    }
  }
}

function captchaIsRequired(ip, accountKey) {
  const ipAttempts = loginFailuresByIp.get(ip)?.attempts.length || 0;
  const accountAttempts = loginFailuresByAccount.get(accountKey)?.attempts.length || 0;
  return ipAttempts >= 3 || accountAttempts >= 3;
}

function rateLimitResponse(response, waitMs, message) {
  const seconds = Math.max(1, Math.ceil(waitMs / 1000));
  send(response, 429, { error: message, retryAfterSeconds: seconds }, { "Retry-After": String(seconds) });
}

function makeCaptchaSvg(answer) {
  const lines = Array.from({ length: 10 }, () => {
    const x1 = randomInt(0, 190), y1 = randomInt(0, 56);
    const x2 = randomInt(0, 190), y2 = randomInt(0, 56);
    return `<path d="M${x1} ${y1} Q${randomInt(0, 190)} ${randomInt(0, 56)} ${x2} ${y2}" stroke="#596273" stroke-opacity=".32" stroke-width="${randomInt(1, 3)}" fill="none"/>`;
  }).join("");
  const text = [...answer].map((character, index) => {
    const x = 15 + index * 33 + randomInt(-2, 3);
    const y = 38 + randomInt(-5, 6);
    const rotation = randomInt(-18, 19);
    const size = randomInt(25, 32);
    return `<text x="${x}" y="${y}" font-size="${size}" transform="rotate(${rotation} ${x} ${y})">${character}</text>`;
  }).join("");
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="190" height="56" viewBox="0 0 190 56"><rect width="190" height="56" rx="9" fill="#f6f1e8"/><g>${lines}</g><g fill="#29334a" font-family="Arial,sans-serif" font-weight="700" letter-spacing="2">${text}</g></svg>`;
  return `data:image/svg+xml;base64,${Buffer.from(svg).toString("base64")}`;
}

function issueCaptcha(request, response) {
  const ip = clientAddress(request);
  const now = Date.now();
  pruneBuckets(captchaFetches, now - 60 * 60 * 1000);
  const bucket = takeBucket(captchaFetches, ip, now);
  if (bucket.attempts.length >= 30) {
    rateLimitResponse(response, bucket.attempts[0] + 15 * 60 * 1000 - now, "验证码请求过于频繁，请稍后再试");
    return;
  }
  bucket.attempts.push(now);
  if (captchaChallenges.size > 5000) {
    for (const [id, value] of captchaChallenges) if (value.expiresAt <= now) captchaChallenges.delete(id);
    while (captchaChallenges.size > 4500) captchaChallenges.delete(captchaChallenges.keys().next().value);
  }
  const answer = Array.from({ length: 5 }, () => captchaAlphabet[randomInt(0, captchaAlphabet.length)]).join("");
  const id = randomBytes(24).toString("base64url");
  captchaChallenges.set(id, { answer, ip, expiresAt: now + 5 * 60 * 1000 });
  send(response, 200, { id, image: makeCaptchaSvg(answer), expiresInSeconds: 300 });
}

async function readJson(request) {
  const chunks = [];
  let size = 0;
  for await (const chunk of request) {
    size += chunk.length;
    if (size > 65536) {
      const error = new Error("请求体过大");
      error.status = 413;
      throw error;
    }
    chunks.push(chunk);
  }
  if (!size) return {};
  try {
    return JSON.parse(Buffer.concat(chunks).toString("utf8"));
  } catch {
    const error = new Error("请求格式不对");
    error.status = 400;
    throw error;
  }
}

// 近 N 期。非法输入落到 100，上限 5000，避免一次把明细拉得过大。
function clampN(value) {
  const number = Number(value);
  if (!Number.isInteger(number)) return 100;
  return Math.min(5000, Math.max(1, number));
}

function publicLottery(lottery) {
  return {
    code: lottery.code,
    name: lottery.name,
    digits: lottery.digits,
    positions: lottery.positions,
    short: lottery.short,
    sumMax: lottery.sumMax,
    sumBigMin: lottery.sumBigMin,
    source: lottery.source,
    // 豹子、组三、组六、顺子只对三位号码有意义。
    shapes: lottery.digits === 3,
  };
}

function lotteryCodeFrom(value, fallback = "fc3d") {
  const code = value || fallback;
  return getLottery(code).code;
}

function dateOrEmpty(value) {
  return /^\d{4}-\d{2}-\d{2}$/.test(value || "") ? value : "";
}

function overview(url, response) {
  const n = clampN(url.searchParams.get("n"));
  const code = lotteryCodeFrom(url.searchParams.get("lottery"));
  const lottery = getLottery(code);
  const draws = getDraws(code);
  const rules = listRules(code);
  const started = performance.now();
  const stats = summarize(draws, rules, n, lottery);
  send(response, 200, {
    lotteries: listLotteries().map(publicLottery),
    lottery: publicLottery(lottery),
    drawCount: draws.length,
    remoteTotal: getRemoteTotal(code),
    latest: draws[0] ? presentDraw(draws[0]) : null,
    forecastMark: markLatestForecast(draws, draws[1] ? getForecast(code, draws[1].issue) : null),
    recent: draws.slice(0, 10).map(presentDraw),
    lastSync: lastSync(code),
    n,
    window: stats.window,
    elapsedMs: Math.max(stats.elapsedMs, Math.round(performance.now() - started)),
    rules: stats.rules,
  });
}

async function sync(request, response) {
  if (syncing) {
    send(response, 409, { error: "正在同步，请等这一次完成" });
    return;
  }
  const body = await readJson(request);
  const mode = body.mode === "backfill" ? "backfill" : "auto";
  const code = lotteryCodeFrom(body.lottery);
  syncing = true;
  try {
    const written = await syncDraws(code, mode);
    queuePlaySettlement([code]);
    send(response, 200, written);
  } finally {
    syncing = false;
  }
}

async function syncPlayDraws() {
  if (syncing) {
    const error = new Error("正在同步，请等这一次完成");
    error.status = 409;
    throw error;
  }
  syncing = true;
  try {
    const results = [];
    for (const lottery of listLotteries()) {
      try {
        const written = await syncDraws(lottery.code, "auto");
        results.push({ code: lottery.code, name: lottery.name, ok: true, message: written.message });
      } catch (error) {
        results.push({ code: lottery.code, name: lottery.name, ok: false, message: error.message || "同步失败" });
      }
    }
    queuePlaySettlement(results.filter((item) => item.ok).map((item) => item.code));
    return { results };
  } finally {
    syncing = false;
  }
}

function scheduledSyncStatus() {
  const time = beijingDateTime();
  const date = `${time.year}-${time.month}-${time.day}`;
  const minuteOfDay = Number(time.hour) * 60 + Number(time.minute);
  const lotteries = listLotteries();
  const state = getScheduledSyncState(date, lotteries.map((lottery) => lottery.code));
  return {
    date,
    window: "21:30–22:30",
    everyMinutes: 5,
    lotteries: lotteries.map((lottery) => {
      const saved = state.byLottery[lottery.code];
      const complete = saved?.complete === true;
      let status = complete ? "complete" : "waiting";
      if (!complete && minuteOfDay > 22 * 60 + 30) status = "expired";
      return {
        code: lottery.code,
        name: lottery.name,
        status,
        lastAttempt: saved?.lastAttempt || "",
        message: saved?.message || (status === "expired" ? "今晚时段已结束，未确认官网已更新" : "等待今晚自动检查"),
      };
    }),
  };
}

function beijingDateTime() {
  return Object.fromEntries(beijingClock.formatToParts(new Date()).map(({ type, value }) => [type, value]));
}

// 每晚 21:30–22:30（北京时间）每 5 分钟检查一次；每个彩种各自完成后停止检查。
async function runScheduledAutoSync() {
  const time = beijingDateTime();
  const date = `${time.year}-${time.month}-${time.day}`;
  const hour = Number(time.hour);
  const minute = Number(time.minute);
  const minuteOfDay = hour * 60 + minute;
  const firstSlot = 21 * 60 + 30;
  const lastSlot = 22 * 60 + 30;
  if (minuteOfDay < firstSlot || minuteOfDay > lastSlot || (minuteOfDay - firstSlot) % 5 !== 0) return;

  const slot = `${date} ${time.hour}:${time.minute}`;
  const lotteries = listLotteries();
  const state = getScheduledSyncState(date, lotteries.map((lottery) => lottery.code));
  if (state.lastSlot === slot || syncing) return;
  // 先落盘本轮时间槽。已完成时也要记下，避免同一分钟里每 15 秒再结算一次。
  markScheduledSyncSlot(slot);
  if (lotteries.every((lottery) => state.byLottery[lottery.code]?.complete === true)) {
    markScheduledSyncComplete(date);
    return;
  }
  syncing = true;
  let landedToday = false;
  try {
    for (const lottery of lotteries) {
      if (state.byLottery[lottery.code]?.complete === true) continue;
      try {
        const result = await syncDraws(lottery.code, "auto");
        const complete = officialDrawIsToday(result.latestDate, date);
        if (complete) landedToday = true;
        const message = complete
          ? result.message
          : `官网最新仍是 ${result.latestDate || "更早的日期"}，继续等待今日开奖`;
        markScheduledSyncLottery(date, lottery.code, {
          complete,
          lastAttempt: slot,
          message,
        });
        console.log(`[定时同步] ${date} ${time.hour}:${time.minute} ${lottery.name}: ${message}`);
      } catch (error) {
        markScheduledSyncLottery(date, lottery.code, {
          complete: false,
          lastAttempt: slot,
          message: error.message || "同步失败",
        });
        console.error(`[定时同步] ${lottery.name}失败: ${error.message || error}`);
      }
    }
    const latestState = getScheduledSyncState(date, lotteries.map((lottery) => lottery.code));
    if (lotteries.every((lottery) => latestState.byLottery[lottery.code]?.complete === true)) {
      markScheduledSyncComplete(date);
      console.log(`[定时同步] ${date} 三个彩种均已完成，今晚任务结束`);
    }
    if (landedToday) queuePlaySettlement(lotteries.map((lottery) => lottery.code));
  } finally {
    syncing = false;
  }
}

const scheduledSyncTimer = setInterval(() => {
  runScheduledAutoSync().catch((error) => console.error(`[定时同步] 任务异常: ${error.message || error}`));
}, 15 * 1000);
scheduledSyncTimer.unref();

function preview(body, response) {
  const lottery = getLottery(lotteryCodeFrom(body.lottery));
  try {
    const prepared = prepareRule({ name: body.name, definition: body.definition }, lottery);
    send(response, 200, { summary: prepared.summary, name: prepared.name, empty: false });
  } catch (error) {
    if (error.message === "请至少加一个条件") {
      send(response, 200, { summary: "还没有条件", empty: true });
      return;
    }
    send(response, 200, { summary: error.message, empty: true, error: error.message });
  }
}

function saveRule(body, response, id) {
  const lottery = getLottery(lotteryCodeFrom(body.lottery));
  const prepared = prepareRule(body, lottery);
  const saved = id
    ? updateRule(id, prepared.name, prepared.definition)
    : createRule(lottery.code, prepared.name, prepared.definition);
  if (!saved) {
    send(response, 404, { error: "规则不存在" });
    return;
  }
  send(response, id ? 200 : 201, saved);
}

function hits(url, id, response) {
  const rule = getRule(id);
  if (!rule) {
    send(response, 404, { error: "规则不存在" });
    return;
  }
  const lottery = getLottery(rule.lotteryCode);
  const n = clampN(url.searchParams.get("n"));
  const draws = getDraws(rule.lotteryCode);
  const test = compileRule(rule.definition, lottery);
  const windowDraws = draws.slice(0, Math.min(n, draws.length));
  const rows = [];
  for (const draw of windowDraws) {
    if (test(draw.digits)) rows.push(presentDraw(draw));
  }
  const stats = summarize(draws, [rule], n, lottery).rules[0];
  send(response, 200, {
    id: rule.id,
    name: rule.name,
    summary: describeDefinition(rule.definition, lottery),
    n,
    window: windowDraws.length,
    hits: rows.length,
    ratio: windowDraws.length ? rows.length / windowDraws.length : null,
    omission: stats.omission,
    rows,
  });
}

function forecastRecord(code, draws, result, replace) {
  if (!draws[0]) return null;
  const saved = saveForecast({
    lotteryCode: code,
    basedIssue: draws[0].issue,
    n: result.n,
    k: result.k,
    payload: archivePayload(result),
    replace,
  });
  return {
    inserted: saved.inserted,
    replaced: saved.replaced,
    basedIssue: saved.row.basedIssue,
    n: saved.row.n,
    k: saved.row.k,
    createdAt: saved.row.createdAt,
    payload: saved.row.payload,
  };
}

function backtest(url, response, account) {
  const code = lotteryCodeFrom(url.searchParams.get("lottery"));
  if (code === "pl5" && !account?.canManage) {
    send(response, 403, { error: "排列五回测只对超级管理员开放" });
    return;
  }
  const lottery = getLottery(code);
  const draws = getDraws(code);
  const nValue = url.searchParams.get("n");
  const n = nValue === null || nValue === "" ? 100 : clampN(nValue);
  const kValue = url.searchParams.get("k");
  const k = kValue === null || kValue === "" ? null : kValue;
  const key = `${code}|${n}|${k ?? ""}|${draws.length}|${draws[0]?.issue || ""}`;
  let payload = backtestCache.get(key);
  if (!payload) {
    payload = {
      n,
      k,
      methods: BACKTEST_METHODS,
      result: backtestLottery(draws, lottery, n, k),
    };
    backtestCache.set(key, payload);
    if (backtestCache.size > 12) backtestCache.delete(backtestCache.keys().next().value);
  }
  send(response, 200, payload);
}

function forecast(url, response, user) {
  const code = lotteryCodeFrom(url.searchParams.get("lottery"));
  const lottery = getLottery(code);
  const draws = getDraws(code);
  const result = predict(draws, lottery, clampN(url.searchParams.get("n")), url.searchParams.get("k"));
  const archive = user.canOperate
    ? forecastRecord(code, draws, result, false)
    : readArchive(code, draws);
  const picks = listExpertPicks(code);
  const mine = user.canRecommend && draws[0]
    ? picks.find((row) => row.userId === user.id && row.basedIssue === draws[0].issue) || null
    : null;
  send(response, 200, {
    lottery: publicLottery(lottery),
    drawCount: draws.length,
    latest: draws[0] ? presentDraw(draws[0]) : null,
    archive,
    checks: reviewForecasts(draws, listForecasts(code, clampN(url.searchParams.get("checksN") || 30))),
    experts: {
      ...expertBoard(draws, picks, expertWindowSize(url.searchParams.get("expertN"))),
      mine,
    },
    ...result,
  });
}

function readArchive(code, draws) {
  if (!draws[0]) return null;
  const row = getForecast(code, draws[0].issue);
  if (!row) return null;
  return {
    inserted: false,
    replaced: false,
    basedIssue: row.basedIssue,
    n: row.n,
    k: row.k,
    createdAt: row.createdAt,
    payload: row.payload,
  };
}

async function replaceForecast(request, response) {
  const body = await readJson(request);
  const code = lotteryCodeFrom(body.lottery);
  const lottery = getLottery(code);
  const draws = getDraws(code);
  if (!draws[0]) {
    send(response, 400, { error: "还没有开奖，不能保存预测" });
    return;
  }
  const result = predict(draws, lottery, clampN(body.n), body.k);
  send(response, 200, {
    archive: forecastRecord(code, draws, result, true),
    checks: reviewForecasts(draws, listForecasts(code, clampN(body.checksN || 30))),
  });
}

function draws(url, response) {
  const page = Math.min(500, Math.max(1, Number(url.searchParams.get("page")) || 1));
  const pageSize = Math.min(100, Math.max(10, Number(url.searchParams.get("pageSize")) || 40));
  const requested = url.searchParams.get("lottery") || "";
  const lotteryCode = requested ? lotteryCodeFrom(requested, "") : "";
  const result = queryDraws({
    lotteryCode,
    issue: (url.searchParams.get("issue") || "").replace(/\D/g, "").slice(0, 12),
    dateFrom: dateOrEmpty(url.searchParams.get("dateFrom")),
    dateTo: dateOrEmpty(url.searchParams.get("dateTo")),
    number: url.searchParams.get("number") || "",
    page,
    pageSize,
  });
  const counts = countDrawsByLottery();
  send(response, 200, {
    total: result.total,
    page: result.page,
    pageSize: result.pageSize,
    rows: result.rows.map((row) => ({
      lotteryCode: row.lotteryCode,
      lotteryName: getLottery(row.lotteryCode).name,
      sales: row.sales,
      ...presentDraw(row),
    })),
    counts: listLotteries().map((lottery) => ({
      code: lottery.code,
      name: lottery.name,
      count: counts.get(lottery.code) || 0,
    })),
  });
}

const PAGE_REDIRECTS = {
  "/query.html": "/query",
  "/predict.html": "/predict",
  "/backtest.html": "/backtest",
  "/admin.html": "/admin",
  "/login.html": "/login",
};

function serveFile(filePath, response) {
  fs.readFile(filePath, (error, content) => {
    if (error) {
      send(response, 404, { error: "页面还没构建，先运行 npm run build" });
      return;
    }
    const hashed = filePath.includes(`${path.sep}assets${path.sep}`);
    response.writeHead(200, {
      "Content-Type": TYPES[path.extname(filePath)] || "application/octet-stream",
      "Cache-Control": hashed ? "public, max-age=31536000, immutable" : "no-cache",
      "X-Content-Type-Options": "nosniff",
      "X-Frame-Options": "DENY",
      "Referrer-Policy": "same-origin",
      "X-Robots-Tag": "noindex, nofollow, noarchive",
      "Content-Security-Policy": "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; connect-src 'self'; object-src 'none'; base-uri 'self'; frame-ancestors 'none'; form-action 'self'",
    });
    response.end(content);
  });
}

function serveStatic(url, response) {
  const redirect = PAGE_REDIRECTS[url.pathname];
  if (redirect) {
    response.writeHead(302, { Location: redirect });
    response.end();
    return;
  }
  const requestPath = url.pathname === "/" ? "/index.html" : decodeURIComponent(url.pathname);
  const filePath = path.resolve(webDir, `.${requestPath}`);
  const relative = path.relative(webDir, filePath);
  if (relative.startsWith("..") || path.isAbsolute(relative)) {
    send(response, 403, { error: "禁止访问" });
    return;
  }
  fs.stat(filePath, (error, stat) => {
    if (!error && stat.isFile()) {
      serveFile(filePath, response);
      return;
    }
    if (requestPath.startsWith("/assets/") || path.extname(requestPath)) {
      send(response, 404, { error: "没有这个文件" });
      return;
    }
    serveFile(path.join(webDir, "index.html"), response);
  });
}

function readCookie(request, name) {
  const header = request.headers.cookie || "";
  for (const part of header.split(";")) {
    const [key, ...rest] = part.trim().split("=");
    if (key === name) return decodeURIComponent(rest.join("="));
  }
  return "";
}

function sessionCookie(token, maxAge, request) {
  const secure = LOOPBACKS.has(String(request.socket.remoteAddress || "").toLowerCase()) && request.headers["x-forwarded-proto"] === "https";
  return `session=${encodeURIComponent(token)}; HttpOnly; SameSite=Lax; Path=/; Max-Age=${maxAge}${secure ? "; Secure" : ""}`;
}

function accessMode(request, url) {
  if (url.pathname === "/api/me/password") return "view";
  if (url.pathname === "/api/expert-picks") return "recommend";
  if (url.pathname.startsWith("/api/admin/")) return "manage";
  if (url.pathname === "/api/play" || url.pathname.startsWith("/api/play/") || url.pathname === "/api/orders" || url.pathname.startsWith("/api/orders/")) return "play";
  if (request.method === "GET" || request.method === "HEAD") return "view";
  return "operate";
}

function requireAccount(request, response, mode) {
  const account = getSessionUser(readCookie(request, "session"));
  if (!account) {
    send(response, 401, { error: "请先登录" });
    return null;
  }
  if (mode === "operate" && !account.canOperate) {
    send(response, 403, { error: "当前账号只能查看" });
    return null;
  }
  if (mode === "play" && !account.canPlay) {
    send(response, 403, { error: "没有模拟试玩权限" });
    return null;
  }
  if (mode === "recommend" && !account.canRecommend) {
    send(response, 403, { error: "没有专家推荐权限" });
    return null;
  }
  if (mode === "manage" && !account.canManage) {
    send(response, 403, { error: "需要超级管理员" });
    return null;
  }
  return account;
}

async function login(request, response) {
  const body = await readJson(request);
  const username = String(body.username || "").trim();
  const ip = clientAddress(request);
  const accountKey = `${ip}|${username.toLowerCase().slice(0, 64)}`;
  const blockedFor = loginBlock(ip, accountKey);
  if (blockedFor > 0) {
    rateLimitResponse(response, blockedFor, "登录尝试过多，请稍后再试");
    return;
  }

  if (captchaIsRequired(ip, accountKey)) {
    const challengeId = String(body.captchaId || "");
    const challenge = captchaChallenges.get(challengeId);
    captchaChallenges.delete(challengeId);
    if (!challenge || challenge.expiresAt <= Date.now() || challenge.ip !== ip ||
        String(body.captchaAnswer || "").trim().toUpperCase() !== challenge.answer) {
      recordLoginFailure(ip, accountKey);
      send(response, 400, { error: "连续登录失败，请正确填写验证码", captchaRequired: true });
      return;
    }
  }

  const record = findUserByUsername(username);
  const validPassword = verifyPassword(String(body.password || ""), record?.password_hash || dummyPasswordHash);
  if (!record || !validPassword) {
    recordLoginFailure(ip, accountKey);
    send(response, 401, { error: "账号或密码不正确", captchaRequired: captchaIsRequired(ip, accountKey) });
    return;
  }
  loginFailuresByAccount.delete(accountKey);
  loginFailuresByIp.delete(ip);
  const session = createSession(record.id);
  const account = getSessionUser(session.token);
  send(response, 200, account, { "Set-Cookie": sessionCookie(session.token, SESSION_TTL_SECONDS, request) });
}

function logout(request, response) {
  deleteSession(readCookie(request, "session"));
  send(response, 200, { ok: true }, { "Set-Cookie": sessionCookie("", 0, request) });
}

const server = http.createServer(async (request, response) => {
  const url = new URL(request.url, "http://127.0.0.1");
  try {
    if (request.method === "GET" && url.pathname === "/favicon.ico") {
      response.writeHead(204);
      response.end();
      return;
    }
    if (request.method === "GET" && url.pathname === "/robots.txt") {
      const body = "User-agent: *\nDisallow: /\n";
      response.writeHead(200, { "Content-Type": "text/plain; charset=utf-8", "Content-Length": Buffer.byteLength(body), "X-Robots-Tag": "noindex, nofollow, noarchive", "Cache-Control": "no-store" });
      response.end(body);
      return;
    }
    if (["POST", "PUT", "PATCH", "DELETE"].includes(request.method) && request.headers.origin) {
      let originHost = "";
      try { originHost = new URL(request.headers.origin).host; } catch { /* malformed Origin is rejected below */ }
      if (!originHost || originHost !== request.headers.host) {
        send(response, 403, { error: "跨站请求已拒绝" });
        return;
      }
    }
    if (request.method === "POST" && url.pathname === "/api/login") {
      await login(request, response);
      return;
    }
    if (request.method === "GET" && url.pathname === "/api/captcha") {
      issueCaptcha(request, response);
      return;
    }
    if (request.method === "POST" && url.pathname === "/api/logout") {
      logout(request, response);
      return;
    }
    let account = null;
    if (url.pathname.startsWith("/api/")) {
      account = requireAccount(request, response, accessMode(request, url));
      if (!account) return;
      if (account.mustChangePassword && !(request.method === "GET" && url.pathname === "/api/me") &&
          !(request.method === "PUT" && url.pathname === "/api/me/password")) {
        send(response, 403, { error: "请先修改临时密码", mustChangePassword: true });
        return;
      }
    }
    if (request.method === "GET" && url.pathname === "/api/me") {
      send(response, 200, account);
      return;
    }
    if (request.method === "PUT" && url.pathname === "/api/me/password") {
      const body = await readJson(request);
      changePassword(account.id, body.oldPassword, body.newPassword, readCookie(request, "session"));
      send(response, 200, { ok: true });
      return;
    }
    if (request.method === "GET" && url.pathname === "/api/admin/roles") {
      send(response, 200, { roles: listRoles() });
      return;
    }
    if (request.method === "POST" && url.pathname === "/api/admin/roles") {
      const body = await readJson(request);
      send(response, 200, { role: createRole(body.name, Boolean(body.canPlay)) });
      return;
    }
    const roleMatch = url.pathname.match(/^\/api\/admin\/roles\/(\d+)$/);
    if (roleMatch && request.method === "PUT") {
      const body = await readJson(request);
      send(response, 200, { role: updateRolePlay(Number(roleMatch[1]), Boolean(body.canPlay)) });
      return;
    }
    if (roleMatch && request.method === "DELETE") {
      deleteRole(Number(roleMatch[1]));
      send(response, 200, { ok: true });
      return;
    }
    if (request.method === "GET" && url.pathname === "/api/admin/users") {
      send(response, 200, { users: listUsers() });
      return;
    }
    if (request.method === "GET" && url.pathname === "/api/admin/data-summary") {
      send(response, 200, adminDataSummary());
      return;
    }
    if (request.method === "GET" && url.pathname === "/api/admin/sync-status") {
      send(response, 200, scheduledSyncStatus());
      return;
    }
    if (request.method === "POST" && url.pathname === "/api/admin/data-clear") {
      const body = await readJson(request);
      send(response, 200, clearAdminData(body.category, body.confirmation));
      return;
    }
    if (request.method === "POST" && url.pathname === "/api/admin/draws-trim") {
      const body = await readJson(request);
      const lottery = getLottery(body.lottery);
      const result = trimOldestDraws(lottery.code, body.count, body.confirmation);
      send(response, 200, { ...result, name: lottery.name, summary: adminDataSummary() });
      return;
    }
    if (request.method === "POST" && url.pathname === "/api/admin/users") {
      const body = await readJson(request);
      send(response, 200, { user: createUser(body) });
      return;
    }
    const userMatch = url.pathname.match(/^\/api\/admin\/users\/(\d+)$/);
    const userPasswordMatch = url.pathname.match(/^\/api\/admin\/users\/(\d+)\/password$/);
    if (userPasswordMatch && request.method === "PUT") {
      await readJson(request);
      const user = resetUserPassword(Number(userPasswordMatch[1]));
      send(response, 200, { user });
      return;
    }
    const userRecommendMatch = url.pathname.match(/^\/api\/admin\/users\/(\d+)\/recommend$/);
    if (userRecommendMatch && request.method === "PUT") {
      const body = await readJson(request);
      const user = setUserRecommend(Number(userRecommendMatch[1]), Boolean(body.enabled));
      send(response, 200, { user });
      return;
    }
    if (userMatch && request.method === "DELETE") {
      const id = Number(userMatch[1]);
      if (id === account.id) {
        send(response, 400, { error: "不能删除自己" });
        return;
      }
      deleteUser(id);
      send(response, 200, { ok: true });
      return;
    }
    if (request.method === "GET" && url.pathname === "/api/overview") {
      overview(url, response);
      return;
    }
    if (request.method === "POST" && url.pathname === "/api/sync") {
      await sync(request, response);
      return;
    }
    if (request.method === "POST" && url.pathname === "/api/rules/preview") {
      preview(await readJson(request), response);
      return;
    }
    if (request.method === "POST" && url.pathname === "/api/rules") {
      saveRule(await readJson(request), response);
      return;
    }
    const ruleMatch = url.pathname.match(/^\/api\/rules\/(\d+)$/);
    if (ruleMatch && request.method === "PUT") {
      saveRule(await readJson(request), response, Number(ruleMatch[1]));
      return;
    }
    if (ruleMatch && request.method === "DELETE") {
      const rule = getRule(Number(ruleMatch[1]));
      if (!rule) {
        send(response, 404, { error: "规则不存在" });
        return;
      }
      deleteRule(rule.id);
      send(response, 200, { ok: true });
      return;
    }
    const hitMatch = url.pathname.match(/^\/api\/rules\/(\d+)\/hits$/);
    if (hitMatch && request.method === "GET") {
      hits(url, Number(hitMatch[1]), response);
      return;
    }
    if (request.method === "GET" && url.pathname === "/api/predict") {
      forecast(url, response, account);
      return;
    }
    if (request.method === "GET" && url.pathname === "/api/backtest") {
      backtest(url, response, account);
      return;
    }
    if (request.method === "POST" && url.pathname === "/api/forecasts") {
      await replaceForecast(request, response);
      return;
    }
    if (request.method === "PUT" && url.pathname === "/api/expert-picks") {
      const body = await readJson(request);
      const lottery = getLottery(lotteryCodeFrom(body.lottery));
      const draws = getDraws(lottery.code);
      if (!draws[0]) {
        send(response, 400, { error: "还没有开奖，不能推荐" });
        return;
      }
      saveExpertPick({
        userId: account.id,
        lotteryCode: lottery.code,
        basedIssue: draws[0].issue,
        pick: normalizeExpertPick(body, lottery),
      });
      send(response, 200, { ok: true });
      return;
    }
    if (request.method === "GET" && url.pathname === "/api/draws") {
      draws(url, response);
      return;
    }
    if (request.method === "GET" && url.pathname === "/api/admin/play") {
      send(response, 200, playAdminReport());
      return;
    }
    if (request.method === "PUT" && url.pathname === "/api/admin/play/deadlines") {
      send(response, 200, { deadlines: savePlayDeadlines(await readJson(request)) });
      return;
    }
    const balanceMatch = url.pathname.match(/^\/api\/admin\/play\/balances\/(\d+)$/);
    if (balanceMatch && request.method === "PUT") {
      const body = await readJson(request);
      send(response, 200, { user: setPlayBalance(Number(balanceMatch[1]), body.balance) });
      return;
    }
    if (request.method === "PUT" && url.pathname === "/api/admin/play/prizes") {
      const body = await readJson(request);
      send(response, 200, { users: setUserPlayPrizes(body.userIds, body.prizes, body.reset === true) });
      return;
    }
    if (request.method === "POST" && url.pathname === "/api/play/sync") {
      send(response, 200, await syncPlayDraws());
      return;
    }
    if (request.method === "GET" && url.pathname === "/api/play") {
      const code = lotteryCodeFrom(url.searchParams.get("lottery") || "pl3");
      const lottery = getLottery(code);
      const latest = getDraws(code)[0] || null;
      send(response, 200, {
        lottery: publicLottery(lottery),
        latest: latest ? presentDraw(latest) : null,
        upcoming: latest ? upcomingWindow(latest, getPlayDeadline(code)) : null,
        balance: playBalance(account.id),
        prizes: playPrizesFor(account.id),
      });
      return;
    }
    if (request.method === "GET" && url.pathname === "/api/orders") {
      send(response, 200, listPlayOrders(account));
      return;
    }
    const orderMatch = url.pathname.match(/^\/api\/orders\/(\d+)$/);
    if (orderMatch && request.method === "DELETE") {
      send(response, 200, dismissPlayOrder({ id: Number(orderMatch[1]), account }));
      return;
    }
    const cancelMatch = url.pathname.match(/^\/api\/orders\/(\d+)\/cancel$/);
    if (cancelMatch && request.method === "POST") {
      send(response, 200, cancelPlayOrder({ id: Number(cancelMatch[1]), account }));
      return;
    }
    if (request.method === "POST" && url.pathname === "/api/orders") {
      const body = await readJson(request);
      send(response, 201, createPlayOrders({
        userId: account.id,
        lotteryCode: body.lottery,
        selection: body.selection,
        lines: body.lines,
        multiple: body.multiple,
      }));
      return;
    }
    if (request.method === "GET" && url.pathname === "/login.html") {
      serveStatic(url, response);
      return;
    }
    if (request.method === "GET") {
      serveStatic(url, response);
      return;
    }
    send(response, 404, { error: "没有这个接口" });
  } catch (error) {
    if (!response.headersSent) {
      console.error(error);
      send(response, error.status || 500, { error: error.message || "服务器出错" });
    }
  }
});

if (!fs.existsSync(path.join(webDir, "index.html"))) {
  console.error("前端还没构建。先运行 npm run build");
}

server.listen(PORT, HOST, () => {
  console.log(`http://${HOST}:${PORT}`);
});
