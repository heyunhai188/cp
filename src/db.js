// SQLite 在 data/app.sqlite。测试会设置 FC3D_DB 指向临时文件。
// draws 以 (lottery_code, issue) 为主键：同一期再拉到就覆盖，不同彩种的期号互不影响。
// extra_json 用来装星期、销售额，以及以后不想改表的字段。
import fs from "node:fs";
import path from "node:path";
import { randomInt } from "node:crypto";
import { DatabaseSync } from "node:sqlite";
import { fileURLToPath } from "node:url";
import { getLottery, LOTTERIES } from "./lottery.js";
import { hashPassword, randomPassword, verifyPassword } from "./password.js";
import { countBets, directHit, DEFAULT_DEADLINE, DIRECT_PRIZE, linePrize, lineStake, normalizeDeadline, normalizeMultiple, normalizeSelection, upcomingWindow } from "./play.js";
import { normalizeDefinition, presetRules } from "./rules.js";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

let database;
// 登录后最多保持 12 小时；数据库会话和浏览器 Cookie 共用此期限。
export const SESSION_TTL_SECONDS = 12 * 60 * 60;
const SESSION_TTL_MS = SESSION_TTL_SECONDS * 1000;
// 每个彩种一份「新的在前」的开奖数组。写入后必须 invalidate，否则统计还是旧数据。
const drawCache = new Map();

function nowIso() {
  return new Date().toISOString();
}

export function closeDatabase() {
  settleQueue.clear();
  settling = false;
  if (!database) return;
  database.close();
  database = undefined;
  drawCache.clear();
}

export function initDatabase() {
  if (database) return database;
  const file = process.env.FC3D_DB || path.join(root, "data", "app.sqlite");
  fs.mkdirSync(path.dirname(file), { recursive: true });
  database = new DatabaseSync(file);
  database.exec(`
    PRAGMA journal_mode = WAL;
    PRAGMA synchronous = NORMAL;
    PRAGMA busy_timeout = 3000;
    CREATE TABLE IF NOT EXISTS draws (
      lottery_code TEXT NOT NULL,
      issue TEXT NOT NULL,
      draw_date TEXT NOT NULL,
      digits TEXT NOT NULL,
      extra_json TEXT NOT NULL DEFAULT '{}',
      updated_at TEXT NOT NULL,
      PRIMARY KEY (lottery_code, issue)
    );
    CREATE TABLE IF NOT EXISTS self_draws (
      user_id INTEGER NOT NULL,
      lottery_code TEXT NOT NULL,
      issue TEXT NOT NULL,
      draw_date TEXT NOT NULL,
      digits TEXT NOT NULL,
      created_at TEXT NOT NULL,
      PRIMARY KEY (user_id, lottery_code, issue)
    );
    CREATE INDEX IF NOT EXISTS idx_draws_recent
      ON draws (lottery_code, draw_date DESC, issue DESC);
    CREATE TABLE IF NOT EXISTS rules (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      lottery_code TEXT NOT NULL,
      name TEXT NOT NULL,
      definition TEXT NOT NULL,
      sort_order INTEGER NOT NULL DEFAULT 0,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_rules_lottery ON rules (lottery_code, sort_order, id);
    CREATE TABLE IF NOT EXISTS sync_log (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      lottery_code TEXT NOT NULL,
      mode TEXT NOT NULL,
      ok INTEGER NOT NULL,
      message TEXT NOT NULL,
      inserted_count INTEGER NOT NULL DEFAULT 0,
      updated_count INTEGER NOT NULL DEFAULT 0,
      created_at TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS app_meta (
      key TEXT PRIMARY KEY,
      value TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS forecasts (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      lottery_code TEXT NOT NULL,
      based_issue TEXT NOT NULL,
      n INTEGER NOT NULL,
      k INTEGER NOT NULL,
      payload TEXT NOT NULL,
      created_at TEXT NOT NULL,
      UNIQUE (lottery_code, based_issue)
    );
    CREATE TABLE IF NOT EXISTS roles (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL UNIQUE,
      is_admin INTEGER NOT NULL DEFAULT 0,
      built_in INTEGER NOT NULL DEFAULT 0,
      created_at TEXT NOT NULL
    );
    CREATE UNIQUE INDEX IF NOT EXISTS idx_roles_single_superadmin ON roles (is_admin) WHERE is_admin = 1;
    CREATE TABLE IF NOT EXISTS users (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      username TEXT NOT NULL UNIQUE,
      password_hash TEXT NOT NULL,
      role_id INTEGER NOT NULL,
      play_balance INTEGER NOT NULL DEFAULT 0,
      must_change_password INTEGER NOT NULL DEFAULT 0,
      created_at TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS sessions (
      token TEXT PRIMARY KEY,
      user_id INTEGER NOT NULL,
      expires_at TEXT NOT NULL,
      created_at TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS play_orders (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id INTEGER NOT NULL,
      lottery_code TEXT NOT NULL,
      based_issue TEXT NOT NULL,
      selection TEXT NOT NULL,
      bets INTEGER NOT NULL,
      stake INTEGER NOT NULL,
      multiple INTEGER NOT NULL DEFAULT 1,
      target_issue TEXT NOT NULL DEFAULT '',
      ahead INTEGER NOT NULL DEFAULT 1,
      target_date TEXT NOT NULL DEFAULT '',
      deadline_at TEXT NOT NULL DEFAULT '',
      cancelled_at TEXT,
      settled_at TEXT,
      prize_credited INTEGER NOT NULL DEFAULT 0,
      prize_amount INTEGER NOT NULL DEFAULT -1,
      created_at TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS user_play_prizes (
      user_id INTEGER NOT NULL,
      lottery_code TEXT NOT NULL,
      prize INTEGER NOT NULL,
      PRIMARY KEY (user_id, lottery_code)
    );
  `);
  ensureRolePlayColumn();
  ensureRoleOperateColumn();
  ensurePlayColumns();
  ensureColumn("users", "must_change_password", "must_change_password INTEGER NOT NULL DEFAULT 0");
  ensureColumn("users", "can_recommend", "can_recommend INTEGER NOT NULL DEFAULT 0");
  database.exec(`
    CREATE TABLE IF NOT EXISTS expert_picks (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id INTEGER NOT NULL,
      lottery_code TEXT NOT NULL,
      based_issue TEXT NOT NULL,
      directs TEXT NOT NULL,
      compound TEXT,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      UNIQUE (user_id, lottery_code, based_issue)
    );
  `);
  seedRules(LOTTERIES.fc3d);
  seedRules(LOTTERIES.pl3);
  seedRules(LOTTERIES.pl5);
  seedAccounts();
  return database;
}

function ensureRoleOperateColumn() {
  const columns = database.prepare("PRAGMA table_info(roles)").all();
  if (!columns.some((column) => column.name === "can_operate")) {
    database.exec("ALTER TABLE roles ADD COLUMN can_operate INTEGER NOT NULL DEFAULT 0");
  }
  database.prepare(`
    UPDATE roles SET name = '查询'
    WHERE name = '查看' AND built_in = 1
      AND NOT EXISTS (SELECT 1 FROM roles WHERE name = '查询')
  `).run();
  database.prepare("UPDATE roles SET can_operate = 1 WHERE name = '管理员' AND is_admin = 0").run();
}

function ensureRolePlayColumn() {
  const columns = database.prepare("PRAGMA table_info(roles)").all();
  if (columns.some((column) => column.name === "can_play")) return;
  database.exec("ALTER TABLE roles ADD COLUMN can_play INTEGER NOT NULL DEFAULT 0");
  database.exec("UPDATE roles SET can_play = 1 WHERE is_admin = 1");
}

function ensureColumn(table, name, definition) {
  const columns = database.prepare(`PRAGMA table_info(${table})`).all();
  if (columns.some((column) => column.name === name)) return;
  database.exec(`ALTER TABLE ${table} ADD COLUMN ${definition}`);
}

function ensurePlayColumns() {
  ensureColumn("users", "play_balance", "play_balance INTEGER NOT NULL DEFAULT 0");
  ensureColumn("play_orders", "multiple", "multiple INTEGER NOT NULL DEFAULT 1");
  ensureColumn("play_orders", "target_issue", "target_issue TEXT NOT NULL DEFAULT ''");
  ensureColumn("play_orders", "ahead", "ahead INTEGER NOT NULL DEFAULT 1");
  ensureColumn("play_orders", "target_date", "target_date TEXT NOT NULL DEFAULT ''");
  ensureColumn("play_orders", "deadline_at", "deadline_at TEXT NOT NULL DEFAULT ''");
  ensureColumn("play_orders", "cancelled_at", "cancelled_at TEXT");
  ensureColumn("play_orders", "settled_at", "settled_at TEXT");
  ensureColumn("play_orders", "prize_credited", "prize_credited INTEGER NOT NULL DEFAULT 0");
  ensureColumn("play_orders", "prize_amount", "prize_amount INTEGER NOT NULL DEFAULT -1");
}

function metaGet(key) {
  return database.prepare("SELECT value FROM app_meta WHERE key = ?").get(key)?.value ?? null;
}

function metaSet(key, value) {
  database.prepare(`
    INSERT INTO app_meta (key, value) VALUES (?, ?)
    ON CONFLICT(key) DO UPDATE SET value = excluded.value
  `).run(key, value);
}

// 只在第一次建库时插入预设规则。删光规则再重启不会再种，标记在 app_meta。
function seedRules(lottery) {
  const key = `seeded:${lottery.code}`;
  if (metaGet(key)) return;
  const insert = database.prepare(`
    INSERT INTO rules (lottery_code, name, definition, sort_order, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, ?)
  `);
  const stamp = nowIso();
  database.exec("BEGIN");
  try {
    presetRules(lottery).forEach((preset, index) => {
      const definition = normalizeDefinition(preset.definition, lottery);
      insert.run(lottery.code, preset.name, JSON.stringify(definition), index + 1, stamp, stamp);
    });
    metaSet(key, "1");
    database.exec("COMMIT");
  } catch (error) {
    database.exec("ROLLBACK");
    throw error;
  }
}

function parseDraw(row) {
  let extra = {};
  try {
    extra = JSON.parse(row.extra_json || "{}");
  } catch {
    extra = {};
  }
  return {
    lotteryCode: row.lottery_code || "",
    issue: row.issue,
    drawDate: row.draw_date,
    digits: row.digits.split(",").map(Number),
    week: extra.week || "",
    sales: extra.sales || "",
  };
}

export function invalidateDraws(lotteryCode) {
  drawCache.delete(lotteryCode);
}

export function getDraws(lotteryCode) {
  const cached = drawCache.get(lotteryCode);
  if (cached) return cached;
  const rows = database.prepare(`
    SELECT lottery_code, issue, draw_date, digits, extra_json
    FROM draws
    WHERE lottery_code = ?
    ORDER BY draw_date DESC, issue DESC
  `).all(lotteryCode).map(parseDraw);
  drawCache.set(lotteryCode, rows);
  return rows;
}

// 内容没变的期号不写，避免每次同步都把最近一页算成「更正」。
// 比较的是日期、号码、星期、销售额。新增字段若也要参与覆盖判断，加进 signature。
export function upsertDraws(lotteryCode, rows) {
  const before = new Map(getDraws(lotteryCode).map((draw) => [
    draw.issue,
    `${draw.drawDate}|${draw.digits.join(",")}|${draw.week || ""}|${draw.sales || ""}`,
  ]));
  const insert = database.prepare(`
    INSERT INTO draws (lottery_code, issue, draw_date, digits, extra_json, updated_at)
    VALUES (?, ?, ?, ?, ?, ?)
    ON CONFLICT(lottery_code, issue) DO UPDATE SET
      draw_date = excluded.draw_date,
      digits = excluded.digits,
      extra_json = excluded.extra_json,
      updated_at = excluded.updated_at
  `);
  const stamp = nowIso();
  const seen = new Set();
  let inserted = 0;
  let updated = 0;
  database.exec("BEGIN");
  try {
    for (const row of rows) {
      if (!row?.issue || seen.has(row.issue)) continue;
      seen.add(row.issue);
      const digits = row.digits.join(",");
      const signature = `${row.drawDate}|${digits}|${row.week || ""}|${row.sales || ""}`;
      const previous = before.get(row.issue);
      if (previous === signature) continue;
      const extra = JSON.stringify({
        week: row.week || "",
        sales: row.sales || "",
        source: row.source || "cwl",
      });
      insert.run(lotteryCode, row.issue, row.drawDate, digits, extra, stamp);
      if (previous === undefined) inserted += 1;
      else updated += 1;
    }
    database.exec("COMMIT");
  } catch (error) {
    database.exec("ROLLBACK");
    throw error;
  }
  invalidateDraws(lotteryCode);
  return { inserted, updated };
}

function mapRule(row) {
  return {
    id: Number(row.id),
    lotteryCode: row.lottery_code,
    name: row.name,
    definition: JSON.parse(row.definition),
    sortOrder: row.sort_order,
  };
}

export function listRules(lotteryCode) {
  return database.prepare(`
    SELECT id, lottery_code, name, definition, sort_order
    FROM rules
    WHERE lottery_code = ?
    ORDER BY sort_order ASC, id ASC
  `).all(lotteryCode).map(mapRule);
}

export function getRule(id) {
  const row = database.prepare(`
    SELECT id, lottery_code, name, definition, sort_order
    FROM rules WHERE id = ?
  `).get(id);
  return row ? mapRule(row) : null;
}

// sort_order 越小越靠前。新建规则取当前最小值再减 1，所以出现在列表顶部。
export function createRule(lotteryCode, name, definition) {
  const current = database.prepare("SELECT MIN(sort_order) AS value FROM rules WHERE lottery_code = ?").get(lotteryCode);
  const sortOrder = Number.isInteger(current?.value) ? current.value - 1 : -1;
  const stamp = nowIso();
  const result = database.prepare(`
    INSERT INTO rules (lottery_code, name, definition, sort_order, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, ?)
  `).run(lotteryCode, name, JSON.stringify(definition), sortOrder, stamp, stamp);
  return getRule(Number(result.lastInsertRowid));
}

export function updateRule(id, name, definition) {
  database.prepare(`
    UPDATE rules
    SET name = ?, definition = ?, updated_at = ?
    WHERE id = ?
  `).run(name, JSON.stringify(definition), nowIso(), id);
  return getRule(id);
}

export function deleteRule(id) {
  database.prepare("DELETE FROM rules WHERE id = ?").run(id);
}

export function addSyncLog({ lotteryCode, mode, ok, message, inserted = 0, updated = 0 }) {
  database.prepare(`
    INSERT INTO sync_log (lottery_code, mode, ok, message, inserted_count, updated_count, created_at)
    VALUES (?, ?, ?, ?, ?, ?, ?)
  `).run(lotteryCode, mode, ok ? 1 : 0, message, inserted, updated, nowIso());
}

export function lastSync(lotteryCode) {
  const row = database.prepare(`
    SELECT mode, ok, message, inserted_count, updated_count, created_at
    FROM sync_log
    WHERE lottery_code = ?
    ORDER BY id DESC
    LIMIT 1
  `).get(lotteryCode);
  if (!row) return null;
  return {
    mode: row.mode,
    ok: row.ok === 1,
    message: row.message,
    inserted: row.inserted_count,
    updated: row.updated_count,
    at: row.created_at,
  };
}

// 定时同步标记写在 app_meta，服务重启后不会重复跑已完成的当天任务或同一时间槽。
export function getScheduledSyncState(date = "", lotteryCodes = []) {
  const byLottery = {};
  if (date) {
    for (const code of lotteryCodes) {
      const value = metaGet(`scheduledSync:state:${date}:${code}`);
      if (!value) continue;
      try { byLottery[code] = JSON.parse(value); } catch { /* 忽略旧版本或损坏的状态值 */ }
    }
  }
  return {
    completedDate: metaGet("scheduledSync:completedDate"),
    lastSlot: metaGet("scheduledSync:lastSlot"),
    byLottery,
  };
}

export function markScheduledSyncSlot(slot) {
  metaSet("scheduledSync:lastSlot", slot);
}

export function markScheduledSyncComplete(date) {
  metaSet("scheduledSync:completedDate", date);
}

export function markScheduledSyncLottery(date, lotteryCode, state) {
  metaSet(`scheduledSync:state:${date}:${lotteryCode}`, JSON.stringify(state));
}

export function getRemoteTotal(lotteryCode) {
  const value = metaGet(`remoteTotal:${lotteryCode}`);
  return value ? Number(value) : null;
}

export function setRemoteTotal(lotteryCode, total) {
  if (Number.isFinite(total) && total > 0) metaSet(`remoteTotal:${lotteryCode}`, String(total));
}

function likeContains(value) {
  return `%${String(value).replace(/[%_]/g, "")}%`;
}

// 开奖查询页用。按彩种、期号、日期、号码片段过滤，新的在前。
// number 只保留数字，再插成 "3,9,8" 去匹配 digits，所以输入 398 和 3 9 8 是一样的。
export function queryDraws({ lotteryCode = "", issue = "", dateFrom = "", dateTo = "", number = "", page = 1, pageSize = 40 } = {}) {
  const where = [];
  const params = [];
  if (lotteryCode) {
    where.push("lottery_code = ?");
    params.push(lotteryCode);
  }
  if (issue) {
    where.push("issue LIKE ?");
    params.push(likeContains(issue));
  }
  if (dateFrom) {
    where.push("draw_date >= ?");
    params.push(dateFrom);
  }
  if (dateTo) {
    where.push("draw_date <= ?");
    params.push(dateTo);
  }
  const digits = String(number).replace(/\D/g, "").split("").join(",");
  if (digits) {
    where.push("digits LIKE ?");
    params.push(likeContains(digits));
  }
  const clause = where.length ? `WHERE ${where.join(" AND ")}` : "";
  const total = database.prepare(`SELECT COUNT(*) AS n FROM draws ${clause}`).get(...params).n;
  const offset = (page - 1) * pageSize;
  const rows = database.prepare(`
    SELECT lottery_code, issue, draw_date, digits, extra_json
    FROM draws
    ${clause}
    ORDER BY draw_date DESC, lottery_code ASC, issue DESC
    LIMIT ? OFFSET ?
  `).all(...params, pageSize, offset).map(parseDraw);
  return { total: Number(total) || 0, page, pageSize, rows };
}

function selfDrawRow(row) {
  return {
    lotteryCode: row.lottery_code,
    issue: row.issue,
    drawDate: row.draw_date,
    digits: row.digits.split(",").map(Number),
    week: "",
    sales: "",
  };
}

function selfDrawByIssue(userId, lotteryCode, issue) {
  const row = database.prepare(`
    SELECT lottery_code, issue, draw_date, digits
    FROM self_draws
    WHERE user_id = ? AND lottery_code = ? AND issue = ?
  `).get(userId, lotteryCode, issue);
  return row ? selfDrawRow(row) : null;
}

function nextSelfIssue(userId, lotteryCode) {
  const row = database.prepare(`
    SELECT issue FROM self_draws
    WHERE user_id = ? AND lottery_code = ?
    ORDER BY CAST(issue AS INTEGER) DESC
    LIMIT 1
  `).get(userId, lotteryCode);
  return String((Number(row?.issue) || 0) + 1);
}

function pendingSelfOrders(userId, lotteryCode) {
  return database.prepare(`
    SELECT id, user_id, lottery_code, based_issue, selection, multiple, target_issue, ahead, cancelled_at, prize_credited
    FROM play_orders
    WHERE user_id = ? AND lottery_code = ? AND cancelled_at IS NULL AND prize_credited = 0
  `).all(userId, lotteryCode);
}

export function querySelfDraws({ userId, issue = "", dateFrom = "", dateTo = "", number = "", page = 1, pageSize = 40 } = {}) {
  const where = ["user_id = ?", "lottery_code = 'self3d'"];
  const params = [userId];
  if (issue) {
    where.push("issue LIKE ?");
    params.push(likeContains(issue));
  }
  if (dateFrom) {
    where.push("draw_date >= ?");
    params.push(dateFrom);
  }
  if (dateTo) {
    where.push("draw_date <= ?");
    params.push(dateTo);
  }
  const digits = String(number).replace(/\D/g, "").split("").join(",");
  if (digits) {
    where.push("digits LIKE ?");
    params.push(likeContains(digits));
  }
  const clause = `WHERE ${where.join(" AND ")}`;
  const total = database.prepare(`SELECT COUNT(*) AS n FROM self_draws ${clause}`).get(...params).n;
  const offset = (page - 1) * pageSize;
  const rows = database.prepare(`
    SELECT lottery_code, issue, draw_date, digits
    FROM self_draws
    ${clause}
    ORDER BY CAST(issue AS INTEGER) DESC
    LIMIT ? OFFSET ?
  `).all(...params, pageSize, offset).map(selfDrawRow);
  return { total: Number(total) || 0, page, pageSize, rows };
}

export function countSelfDraws(userId) {
  return Number(database.prepare("SELECT COUNT(*) AS n FROM self_draws WHERE user_id = ? AND lottery_code = 'self3d'").get(userId).n) || 0;
}

function forecastPayload(payload) {
  if (!payload || typeof payload !== "object" || !Object.hasOwn(payload, "positionStats")) return payload;
  const rest = { ...payload };
  delete rest.positionStats;
  return rest;
}

function mapForecast(row) {
  return {
    id: Number(row.id),
    lotteryCode: row.lottery_code,
    basedIssue: row.based_issue,
    n: row.n,
    k: row.k,
    payload: forecastPayload(JSON.parse(row.payload)),
    createdAt: row.created_at,
  };
}

// 每个彩种、每一期最新开奖只留一份预测。replace 为 false 时，已有存档不会被后来的页面刷新盖掉。
export function saveForecast({ lotteryCode, basedIssue, n, k, payload, replace = false }) {
  const existing = database.prepare(`
    SELECT id, lottery_code, based_issue, n, k, payload, created_at
    FROM forecasts WHERE lottery_code = ? AND based_issue = ?
  `).get(lotteryCode, basedIssue);
  const stamp = nowIso();
  const body = JSON.stringify(payload);
  if (!existing) {
    database.prepare(`
      INSERT INTO forecasts (lottery_code, based_issue, n, k, payload, created_at)
      VALUES (?, ?, ?, ?, ?, ?)
    `).run(lotteryCode, basedIssue, n, k, body, stamp);
  } else if (replace) {
    database.prepare(`
      UPDATE forecasts SET n = ?, k = ?, payload = ?, created_at = ?
      WHERE id = ?
    `).run(n, k, body, stamp, existing.id);
  } else {
    return { inserted: false, replaced: false, row: mapForecast(existing) };
  }
  const saved = database.prepare(`
    SELECT id, lottery_code, based_issue, n, k, payload, created_at
    FROM forecasts WHERE lottery_code = ? AND based_issue = ?
  `).get(lotteryCode, basedIssue);
  return { inserted: !existing, replaced: Boolean(existing && replace), row: mapForecast(saved) };
}

export function listForecasts(lotteryCode, limit = 5000) {
  return database.prepare(`
    SELECT id, lottery_code, based_issue, n, k, payload, created_at
    FROM forecasts
    WHERE lottery_code = ?
    ORDER BY created_at DESC, id DESC
    LIMIT ?
  `).all(lotteryCode, Math.min(5000, Math.max(1, Number(limit) || 5000))).map(mapForecast);
}

const TRIM_OLDEST_PHRASE = "删除最旧开奖";

// 只删一个彩种最旧的若干期，最新的开奖留着。期数必须小于现有期数，避免把这个彩种清空。
export function trimOldestDraws(lotteryCode, count, confirmation) {
  if (confirmation !== TRIM_OLDEST_PHRASE) {
    const error = new Error(`二次确认文字不正确，请输入“${TRIM_OLDEST_PHRASE}”`);
    error.status = 400;
    throw error;
  }
  if (!LOTTERIES[lotteryCode]) {
    const error = new Error("未知彩种");
    error.status = 400;
    throw error;
  }
  const periods = Number(count);
  if (!Number.isInteger(periods) || periods < 1 || periods > 5000) {
    const error = new Error("清理期数要在 1 到 5000 之间");
    error.status = 400;
    throw error;
  }
  const total = Number(database.prepare("SELECT COUNT(*) AS n FROM draws WHERE lottery_code = ?").get(lotteryCode).n);
  if (periods >= total) {
    const error = new Error(total ? `该彩种现有 ${total} 期，至少要保留最新 1 期` : "该彩种还没有开奖");
    error.status = 400;
    throw error;
  }
  const removed = database.prepare(`
    DELETE FROM draws WHERE rowid IN (
      SELECT rowid FROM draws
      WHERE lottery_code = ?
      ORDER BY draw_date ASC, issue ASC
      LIMIT ?
    )
  `).run(lotteryCode, periods).changes;
  invalidateDraws(lotteryCode);
  return {
    lotteryCode,
    removed: Number(removed) || 0,
    remaining: total - (Number(removed) || 0),
  };
}

export function countDrawsByLottery() {
  const rows = database.prepare(`
    SELECT lottery_code, COUNT(*) AS n
    FROM draws
    GROUP BY lottery_code
  `).all();
  return new Map(rows.map((row) => [row.lottery_code, Number(row.n)]));
}

export function getForecast(lotteryCode, basedIssue) {
  const row = database.prepare(`
    SELECT id, lottery_code, based_issue, n, k, payload, created_at
    FROM forecasts WHERE lottery_code = ? AND based_issue = ?
  `).get(lotteryCode, basedIssue);
  return row ? mapForecast(row) : null;
}

let initialAdmin = null;

function publicAccount(row) {
  const admin = row.is_admin === 1;
  return {
    id: row.id,
    username: row.username,
    roleId: row.role_id,
    roleName: row.role_name,
    canManage: admin,
    canOperate: admin || row.can_operate === 1,
    canPlay: admin || row.can_play === 1,
    canRecommend: row.can_recommend === 1,
    playBalance: row.play_balance || 0,
    mustChangePassword: row.must_change_password === 1,
  };
}

const userSelect = `
  SELECT u.id, u.username, u.password_hash, u.role_id, u.play_balance, u.must_change_password, u.can_recommend, u.created_at, r.name AS role_name, r.is_admin, r.can_play, r.can_operate
  FROM users u JOIN roles r ON r.id = u.role_id
`;

// 库里还没有用户时，种一个超级管理员和一个只能查看的角色。密码只在这次返回。
function seedAccounts() {
  const count = database.prepare("SELECT COUNT(*) AS n FROM users").get().n;
  if (count) return;
  const stamp = nowIso();
  let adminRole = database.prepare("SELECT id FROM roles WHERE is_admin = 1").get();
  if (!adminRole) {
    const inserted = database.prepare(`
      INSERT INTO roles (name, is_admin, built_in, can_play, can_operate, created_at) VALUES (?, 1, 1, 1, 1, ?)
    `).run("超级管理员", stamp);
    adminRole = { id: Number(inserted.lastInsertRowid) };
  }
  if (!database.prepare("SELECT id FROM roles WHERE name IN ('查询', '查看') LIMIT 1").get()) {
    database.prepare(`
      INSERT INTO roles (name, is_admin, built_in, can_play, can_operate, created_at) VALUES (?, 0, 1, 0, 0, ?)
    `).run("查询", stamp);
  }
  const password = randomPassword();
  database.prepare(`
    INSERT INTO users (username, password_hash, role_id, created_at) VALUES (?, ?, ?, ?)
  `).run("admin", hashPassword(password), Number(adminRole.id), stamp);
  initialAdmin = { username: "admin", password };
}

export function takeInitialAdmin() {
  const created = initialAdmin;
  initialAdmin = null;
  return created;
}

export function listRoles() {
  return database.prepare(`
    SELECT id, name, is_admin, built_in, can_play, can_operate, created_at FROM roles ORDER BY is_admin DESC, id
  `).all().map((row) => ({
    id: row.id,
    name: row.name,
    canManage: row.is_admin === 1,
    canOperate: row.is_admin === 1 || row.can_operate === 1,
    canPlay: row.is_admin === 1 || row.can_play === 1,
    builtIn: row.built_in === 1,
  }));
}

export function createRole(name, canPlay = false) {
  const trimmed = String(name || "").trim();
  if (!["管理员", "查询"].includes(trimmed)) {
    const error = new Error("只能创建“管理员”或“查询”角色，超级管理员仅初始化一个");
    error.status = 400;
    throw error;
  }
  try {
    const result = database.prepare(`
      INSERT INTO roles (name, is_admin, built_in, can_play, can_operate, created_at) VALUES (?, 0, 0, ?, ?, ?)
    `).run(trimmed, canPlay ? 1 : 0, trimmed === "管理员" ? 1 : 0, nowIso());
    return {
      id: Number(result.lastInsertRowid),
      name: trimmed,
      canManage: false,
      canOperate: trimmed === "管理员",
      canPlay: Boolean(canPlay),
      builtIn: false,
    };
  } catch (error) {
    if (String(error.message).includes("UNIQUE")) {
      const duplicate = new Error("已经有这个角色");
      duplicate.status = 400;
      throw duplicate;
    }
    throw error;
  }
}

export function deleteRole(id) {
  const role = database.prepare("SELECT id, built_in FROM roles WHERE id = ?").get(id);
  if (!role) {
    const error = new Error("角色不存在");
    error.status = 404;
    throw error;
  }
  if (role.built_in) {
    const error = new Error("内置角色不能删除");
    error.status = 400;
    throw error;
  }
  const used = database.prepare("SELECT COUNT(*) AS n FROM users WHERE role_id = ?").get(id).n;
  if (used) {
    const error = new Error("还有用户属于这个角色");
    error.status = 400;
    throw error;
  }
  database.prepare("DELETE FROM roles WHERE id = ?").run(id);
}

export function updateRolePlay(id, canPlay) {
  const role = database.prepare("SELECT id, is_admin FROM roles WHERE id = ?").get(id);
  if (!role) {
    const error = new Error("角色不存在");
    error.status = 404;
    throw error;
  }
  if (role.is_admin !== 1) {
    database.prepare("UPDATE roles SET can_play = ? WHERE id = ?").run(canPlay ? 1 : 0, id);
  }
  return listRoles().find((item) => item.id === id);
}

export function listUsers() {
  return database.prepare(`${userSelect} ORDER BY u.id`).all().map(publicAccount);
}

export function setUserRecommend(userId, enabled) {
  const existing = database.prepare("SELECT id FROM users WHERE id = ?").get(userId);
  if (!existing) {
    const error = new Error("用户不存在");
    error.status = 404;
    throw error;
  }
  database.prepare("UPDATE users SET can_recommend = ? WHERE id = ?").run(enabled ? 1 : 0, userId);
  return getAccount(userId);
}

function mapExpertPick(row) {
  return {
    id: Number(row.id),
    userId: Number(row.user_id),
    username: row.username,
    lotteryCode: row.lottery_code,
    basedIssue: row.based_issue,
    directs: JSON.parse(row.directs),
    compound: row.compound ? JSON.parse(row.compound) : null,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

export function listExpertPicks(lotteryCode) {
  return database.prepare(`
    SELECT p.id, p.user_id, p.lottery_code, p.based_issue, p.directs, p.compound, p.created_at, p.updated_at, u.username
    FROM expert_picks p
    JOIN users u ON u.id = p.user_id
    WHERE p.lottery_code = ?
    ORDER BY p.id
  `).all(lotteryCode).map(mapExpertPick);
}

export function saveExpertPick({ userId, lotteryCode, basedIssue, pick }) {
  if (!pick) {
    database.prepare(`
      DELETE FROM expert_picks WHERE user_id = ? AND lottery_code = ? AND based_issue = ?
    `).run(userId, lotteryCode, basedIssue);
    return null;
  }
  const stamp = nowIso();
  const directs = JSON.stringify(pick.directs);
  const compound = pick.compound ? JSON.stringify(pick.compound) : null;
  database.prepare(`
    INSERT INTO expert_picks (user_id, lottery_code, based_issue, directs, compound, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(user_id, lottery_code, based_issue) DO UPDATE SET
      directs = excluded.directs,
      compound = excluded.compound,
      updated_at = excluded.updated_at
  `).run(userId, lotteryCode, basedIssue, directs, compound, stamp, stamp);
  return listExpertPicks(lotteryCode).find((row) => row.userId === userId && row.basedIssue === basedIssue) || null;
}

// 管理后台只提供明确分区的清理，始终保留超级管理员、角色定义和站点配置。
const CLEARABLE_DATA = {
  draws: { phrase: "清空开奖记录" },
  customRules: { phrase: "清空自定义规则" },
  forecasts: { phrase: "清空预测存档" },
  playOrders: { phrase: "清空模拟订单" },
  playBalances: { phrase: "清空试玩余额" },
  accounts: { phrase: "清空普通用户和角色" },
  allRules: { phrase: "清空首页规则" },
};

export function adminDataSummary() {
  const count = (sql) => Number(database.prepare(sql).get().n);
  return {
    draws: count("SELECT COUNT(*) AS n FROM draws"),
    drawsByLottery: Object.values(LOTTERIES).filter((lottery) => lottery.source !== "local").map((lottery) => ({
      code: lottery.code,
      name: lottery.name,
      count: Number(database.prepare("SELECT COUNT(*) AS n FROM draws WHERE lottery_code = ?").get(lottery.code).n),
    })),
    customRules: count("SELECT COUNT(*) AS n FROM rules WHERE sort_order <= 0"),
    allRules: count("SELECT COUNT(*) AS n FROM rules"),
    forecasts: count("SELECT COUNT(*) AS n FROM forecasts"),
    playOrders: count("SELECT COUNT(*) AS n FROM play_orders"),
    playBalances: database.prepare("SELECT COUNT(*) AS n, COALESCE(SUM(play_balance), 0) AS amount FROM users WHERE play_balance <> 0").get(),
    accounts: database.prepare(`
      SELECT
        (SELECT COUNT(*) FROM users u JOIN roles r ON r.id = u.role_id WHERE r.is_admin = 0) AS users,
        (SELECT COUNT(*) FROM roles WHERE is_admin = 0 AND built_in = 0) AS roles,
        (SELECT COUNT(*) FROM play_orders WHERE user_id IN (SELECT u.id FROM users u JOIN roles r ON r.id = u.role_id WHERE r.is_admin = 0)) AS orders
    `).get(),
  };
}

export function clearAdminData(category, confirmation) {
  const definition = CLEARABLE_DATA[category];
  if (!definition) {
    const error = new Error("清理分类无效");
    error.status = 400;
    throw error;
  }
  if (confirmation !== definition.phrase) {
    const error = new Error(`二次确认文字不正确，请输入“${definition.phrase}”`);
    error.status = 400;
    throw error;
  }

  database.exec("BEGIN IMMEDIATE");
  let affected = 0;
  try {
    if (category === "draws") {
      affected = Number(database.prepare("SELECT COUNT(*) AS n FROM draws").get().n);
      database.exec("DELETE FROM draws; DELETE FROM sync_log;");
      database.prepare("DELETE FROM app_meta WHERE key LIKE 'remoteTotal:%'").run();
    } else if (category === "customRules") {
      affected = Number(database.prepare("SELECT COUNT(*) AS n FROM rules WHERE sort_order <= 0").get().n);
      database.prepare("DELETE FROM rules WHERE sort_order <= 0").run();
    } else if (category === "allRules") {
      affected = Number(database.prepare("SELECT COUNT(*) AS n FROM rules").get().n);
      database.exec("DELETE FROM rules");
    } else if (category === "forecasts") {
      affected = Number(database.prepare("SELECT COUNT(*) AS n FROM forecasts").get().n);
      database.exec("DELETE FROM forecasts");
    } else if (category === "playOrders") {
      affected = Number(database.prepare("SELECT COUNT(*) AS n FROM play_orders").get().n);
      database.exec("DELETE FROM play_orders");
    } else if (category === "playBalances") {
      affected = Number(database.prepare("SELECT COUNT(*) AS n FROM users WHERE play_balance <> 0").get().n);
      database.exec("UPDATE users SET play_balance = 0");
    } else if (category === "accounts") {
      const counts = database.prepare(`
        SELECT
          (SELECT COUNT(*) FROM users u JOIN roles r ON r.id = u.role_id WHERE r.is_admin = 0) AS users,
          (SELECT COUNT(*) FROM roles WHERE is_admin = 0 AND built_in = 0) AS roles,
          (SELECT COUNT(*) FROM play_orders WHERE user_id IN (SELECT u.id FROM users u JOIN roles r ON r.id = u.role_id WHERE r.is_admin = 0)) AS orders
      `).get();
      affected = Number(counts.users) + Number(counts.roles) + Number(counts.orders);
      database.exec(`
        DELETE FROM play_orders WHERE user_id IN (
          SELECT u.id FROM users u JOIN roles r ON r.id = u.role_id WHERE r.is_admin = 0
        );
        DELETE FROM user_play_prizes WHERE user_id IN (
          SELECT u.id FROM users u JOIN roles r ON r.id = u.role_id WHERE r.is_admin = 0
        );
        DELETE FROM sessions WHERE user_id IN (
          SELECT u.id FROM users u JOIN roles r ON r.id = u.role_id WHERE r.is_admin = 0
        );
        DELETE FROM users WHERE role_id IN (SELECT id FROM roles WHERE is_admin = 0);
        DELETE FROM roles WHERE is_admin = 0 AND built_in = 0;
      `);
    }
    database.exec("COMMIT");
  } catch (error) {
    database.exec("ROLLBACK");
    throw error;
  }
  if (category === "draws") for (const lottery of Object.values(LOTTERIES)) invalidateDraws(lottery.code);
  return { category, affected, summary: adminDataSummary() };
}

export function findUserByUsername(username) {
  return database.prepare(`${userSelect} WHERE u.username = ?`).get(username) || null;
}

export function getAccount(id) {
  const row = database.prepare(`${userSelect} WHERE u.id = ?`).get(id);
  return row ? publicAccount(row) : null;
}

export function createUser({ username, password, roleId }) {
  const name = String(username || "").trim();
  if (!/^[A-Za-z0-9_]{3,20}$/.test(name)) {
    const error = new Error("账号用 3 到 20 位字母、数字或下划线");
    error.status = 400;
    throw error;
  }
  if (typeof password !== "string" || password.length < 6 || password.length > 64) {
    const error = new Error("密码要有 6 到 64 位");
    error.status = 400;
    throw error;
  }
  const role = database.prepare("SELECT id, is_admin FROM roles WHERE id = ?").get(roleId);
  if (!role) {
    const error = new Error("角色不存在");
    error.status = 400;
    throw error;
  }
  if (role.is_admin === 1) {
    const error = new Error("不能通过用户管理添加超级管理员");
    error.status = 400;
    throw error;
  }
  try {
    const result = database.prepare(`
      INSERT INTO users (username, password_hash, role_id, must_change_password, created_at) VALUES (?, ?, ?, 1, ?)
    `).run(name, hashPassword(password), roleId, nowIso());
    return getAccount(Number(result.lastInsertRowid));
  } catch (error) {
    if (String(error.message).includes("UNIQUE")) {
      const duplicate = new Error("账号已经存在");
      duplicate.status = 400;
      throw duplicate;
    }
    throw error;
  }
}

export function changePassword(userId, oldPassword, newPassword, keepToken = "") {
  const record = database.prepare("SELECT password_hash, must_change_password FROM users WHERE id = ?").get(userId);
  if (!record || !verifyPassword(String(oldPassword || ""), record.password_hash)) {
    const error = new Error("原密码不对");
    error.status = 400;
    throw error;
  }
  if (typeof newPassword !== "string" || newPassword.length < 6 || newPassword.length > 64) {
    const error = new Error("新密码要有 6 到 64 位");
    error.status = 400;
    throw error;
  }
  if (String(oldPassword) === String(newPassword)) {
    const error = new Error(record.must_change_password === 1 ? "新密码不能与临时密码相同" : "新密码不能与当前密码相同");
    error.status = 400;
    throw error;
  }
  database.prepare("UPDATE users SET password_hash = ?, must_change_password = 0 WHERE id = ?").run(hashPassword(newPassword), userId);
  if (keepToken) {
    database.prepare("DELETE FROM sessions WHERE user_id = ? AND token != ?").run(userId, keepToken);
  } else {
    database.prepare("DELETE FROM sessions WHERE user_id = ?").run(userId);
  }
}

// 超级管理员重置普通用户密码后，删除其现有会话，要求使用新密码重新登录。
// 临时密码由服务端生成，只在这次返回里出现一次。
export function resetUserPassword(userId) {
  const target = getAccount(userId);
  if (!target) {
    const error = new Error("用户不存在");
    error.status = 404;
    throw error;
  }
  if (target.canManage) {
    const error = new Error("不能通过此功能重置超级管理员密码");
    error.status = 400;
    throw error;
  }
  const password = randomPassword();
  database.prepare("UPDATE users SET password_hash = ?, must_change_password = 1 WHERE id = ?").run(hashPassword(password), userId);
  database.prepare("DELETE FROM sessions WHERE user_id = ?").run(userId);
  return { id: target.id, username: target.username, password };
}

export function deleteUser(id) {
  const account = getAccount(id);
  if (!account) {
    const error = new Error("用户不存在");
    error.status = 404;
    throw error;
  }
  if (account.canManage) {
    const admins = database.prepare(`
      SELECT COUNT(*) AS n FROM users u JOIN roles r ON r.id = u.role_id WHERE r.is_admin = 1
    `).get().n;
    if (admins <= 1) {
      const error = new Error("至少留一个超级管理员");
      error.status = 400;
      throw error;
    }
  }
  database.exec("BEGIN");
  try {
    database.prepare("DELETE FROM expert_picks WHERE user_id = ?").run(id);
    database.prepare("DELETE FROM self_draws WHERE user_id = ?").run(id);
    database.prepare("DELETE FROM play_orders WHERE user_id = ?").run(id);
    database.prepare("DELETE FROM user_play_prizes WHERE user_id = ?").run(id);
    database.prepare("DELETE FROM sessions WHERE user_id = ?").run(id);
    database.prepare("DELETE FROM users WHERE id = ?").run(id);
    database.exec("COMMIT");
  } catch (error) {
    database.exec("ROLLBACK");
    throw error;
  }
}

export function createSession(userId) {
  const token = randomPassword() + randomPassword();
  const expires = new Date(Date.now() + SESSION_TTL_MS).toISOString();
  database.prepare(`
    INSERT INTO sessions (token, user_id, expires_at, created_at) VALUES (?, ?, ?, ?)
  `).run(token, userId, expires, nowIso());
  return { token, expires };
}

export function getSessionUser(token) {
  if (!token) return null;
  const row = database.prepare(`
    SELECT u.id, u.username, u.role_id, u.play_balance, u.must_change_password, u.can_recommend, r.name AS role_name, r.is_admin, r.can_play, r.can_operate, s.expires_at, s.created_at
    FROM sessions s
    JOIN users u ON u.id = s.user_id
    JOIN roles r ON r.id = u.role_id
    WHERE s.token = ?
  `).get(token);
  if (!row) return null;
  const now = Date.now();
  if (row.expires_at <= new Date(now).toISOString() || Date.parse(row.created_at) + SESSION_TTL_MS <= now) {
    database.prepare("DELETE FROM sessions WHERE token = ?").run(token);
    return null;
  }
  return publicAccount(row);
}

export function deleteSession(token) {
  if (!token) return;
  database.prepare("DELETE FROM sessions WHERE token = ?").run(token);
}

function drawByIssue(lotteryCode, issue) {
  if (!issue) return null;
  return getDraws(lotteryCode).find((draw) => draw.issue === issue) || null;
}

const orderSelect = `
  SELECT o.id, o.user_id, o.lottery_code, o.based_issue, o.selection, o.bets, o.stake, o.created_at,
    o.multiple, o.target_issue, o.ahead, o.target_date, o.deadline_at, o.cancelled_at, o.settled_at,
    o.prize_credited, o.prize_amount, u.username
  FROM play_orders o JOIN users u ON u.id = o.user_id
`;

function formatClock(date) {
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  const hour = String(date.getHours()).padStart(2, "0");
  const minute = String(date.getMinutes()).padStart(2, "0");
  return `${month}-${day} ${hour}:${minute}`;
}

function localDateKey(value) {
  const date = new Date(value);
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${date.getFullYear()}-${month}-${day}`;
}

function resolveResult(row) {
  const lottery = getLottery(row.lottery_code);
  if (lottery.source === "local") {
    if (!row.target_issue) return null;
    return selfDrawByIssue(row.user_id, row.lottery_code, row.target_issue);
  }
  const draws = getDraws(row.lottery_code);
  const ahead = row.ahead || 1;
  const index = draws.findIndex((draw) => draw.issue === row.based_issue);
  if (index >= ahead) return draws[index - ahead];
  // 依据期还在库里、但后面的开奖还没到，不能拿预计期号去误对。
  if (index >= 0) return null;
  if (row.target_issue) return drawByIssue(row.lottery_code, row.target_issue);
  return null;
}

function presentPlayOrder(row, now = new Date()) {
  const lottery = getLottery(row.lottery_code);
  const selection = JSON.parse(row.selection);
  const multiple = row.multiple || 1;
  const result = resolveResult(row);
  const hit = result ? directHit(selection, result.digits) : false;
  const cancelled = Boolean(row.cancelled_at);
  let status = "pending";
  if (cancelled) status = "cancelled";
  else if (result) status = hit ? "hit" : "miss";
  const local = lottery.source === "local";
  const deadline = row.deadline_at ? new Date(row.deadline_at) : null;
  const cancellable = status === "pending" && (local || (deadline && now.getTime() < deadline.getTime()));
  return {
    id: Number(row.id),
    userId: row.user_id,
    username: row.username,
    lotteryCode: row.lottery_code,
    lotteryName: lottery.name,
    basedIssue: row.based_issue,
    targetIssue: row.target_issue || "",
    ahead: row.ahead || 1,
    funded: Boolean(row.target_issue),
    targetDate: row.target_date || "",
    deadlineAt: row.deadline_at || "",
    deadlineText: deadline && !Number.isNaN(deadline.getTime()) ? formatClock(deadline) : "",
    selection,
    bets: row.bets,
    multiple,
    stake: row.stake,
    createdAt: row.created_at,
    createdText: formatClock(new Date(row.created_at)),
    status,
    cancellable,
    resultIssue: result?.issue || "",
    resultDate: result?.drawDate || "",
    resultDigits: result?.digits || [],
    prize: orderPrize(row, status, multiple),
  };
}

function orderPrize(row, status, multiple) {
  if (status !== "hit") return 0;
  if (Number(row.prize_amount) >= 0) return Number(row.prize_amount);
  return linePrize(unitPrize(row.user_id, row.lottery_code), multiple, true);
}

function unitPrize(userId, lotteryCode) {
  const saved = database.prepare(`
    SELECT prize FROM user_play_prizes WHERE user_id = ? AND lottery_code = ?
  `).get(userId, lotteryCode);
  if (saved) return saved.prize;
  return DIRECT_PRIZE[lotteryCode] || 0;
}

export function playPrizesFor(userId) {
  return {
    fc3d: unitPrize(userId, "fc3d"),
    pl3: unitPrize(userId, "pl3"),
    pl5: unitPrize(userId, "pl5"),
    self3d: unitPrize(userId, "self3d"),
  };
}

function readBalance(userId) {
  return database.prepare("SELECT play_balance FROM users WHERE id = ?").get(userId)?.play_balance || 0;
}

export function playBalance(userId) {
  settlePending();
  return readBalance(userId);
}

function orderRow(id) {
  return database.prepare(`${orderSelect} WHERE o.id = ?`).get(id);
}

function settleOrder(row) {
  if (!row || row.cancelled_at || row.prize_credited || !row.target_issue) return row;
  const result = resolveResult(row);
  if (!result) return row;
  const selection = JSON.parse(row.selection);
  const prize = linePrize(unitPrize(row.user_id, row.lottery_code), row.multiple || 1, directHit(selection, result.digits));
  database.exec("BEGIN");
  try {
    const fresh = database.prepare("SELECT prize_credited, cancelled_at FROM play_orders WHERE id = ?").get(row.id);
    if (fresh && !fresh.prize_credited && !fresh.cancelled_at) {
      if (prize) database.prepare("UPDATE users SET play_balance = play_balance + ? WHERE id = ?").run(prize, row.user_id);
      database.prepare("UPDATE play_orders SET prize_credited = 1, prize_amount = ?, settled_at = ? WHERE id = ?").run(prize, nowIso(), row.id);
    }
    database.exec("COMMIT");
  } catch (error) {
    database.exec("ROLLBACK");
    throw error;
  }
  return orderRow(row.id);
}

function settlePending(lotteryCodes) {
  const codes = (lotteryCodes || []).filter((code) => DIRECT_PRIZE[code]);
  const filter = codes.length ? ` AND lottery_code IN (${codes.map(() => "?").join(",")})` : "";
  const rows = database.prepare(`
    SELECT id, user_id, lottery_code, based_issue, selection, multiple, target_issue, ahead, cancelled_at, prize_credited
    FROM play_orders
    WHERE cancelled_at IS NULL AND prize_credited = 0 AND target_issue != ''${filter}
  `).all(...codes);
  rows.forEach((row) => settleOrder(row));
  return rows.length;
}

// 同步先返回。结算按小批让出事件循环，避免订单多时堵住后续开奖同步和页面请求。
const settleQueue = new Set();
let settling = false;
const SETTLE_BATCH = 40;

export function queuePlaySettlement(lotteryCodes) {
  for (const code of lotteryCodes || []) {
    if (DIRECT_PRIZE[code]) settleQueue.add(code);
  }
  if (settling || !settleQueue.size) return;
  settling = true;
  setImmediate(drainPlaySettlement);
}

function drainPlaySettlement() {
  const codes = [...settleQueue];
  settleQueue.clear();
  const rows = database.prepare(`
    SELECT id, user_id, lottery_code, based_issue, selection, multiple, target_issue, ahead, cancelled_at, prize_credited
    FROM play_orders
    WHERE cancelled_at IS NULL AND prize_credited = 0 AND target_issue != ''
      AND lottery_code IN (${codes.map(() => "?").join(",")})
  `).all(...codes);
  let index = 0;
  const step = () => {
    const end = Math.min(index + SETTLE_BATCH, rows.length);
    try {
      for (; index < end; index += 1) settleOrder(rows[index]);
    } catch (error) {
      settling = false;
      console.error(`[试玩结算] ${error.message || error}`);
      return;
    }
    if (index < rows.length) {
      setImmediate(step);
      return;
    }
    if (rows.length) console.log(`[试玩结算] ${codes.join("、")} 核对了 ${rows.length} 笔未开奖订单`);
    if (settleQueue.size) {
      setImmediate(drainPlaySettlement);
      return;
    }
    settling = false;
  };
  step();
}

export function getPlayDeadline(lotteryCode) {
  return metaGet(`play_deadline:${lotteryCode}`) || DEFAULT_DEADLINE;
}

export function listPlayDeadlines() {
  return Object.values(LOTTERIES).filter((lottery) => lottery.source !== "local").map((lottery) => ({
    code: lottery.code,
    name: lottery.name,
    time: getPlayDeadline(lottery.code),
  }));
}

export function savePlayDeadlines(times) {
  const saved = Object.values(LOTTERIES).filter((lottery) => lottery.source !== "local").map((lottery) => {
    const time = normalizeDeadline(times?.[lottery.code]);
    metaSet(`play_deadline:${lottery.code}`, time);
    return { code: lottery.code, name: lottery.name, time };
  });
  return saved;
}

export function setPlayBalance(userId, amount) {
  const account = getAccount(userId);
  if (!account) {
    const error = new Error("用户不存在");
    error.status = 404;
    throw error;
  }
  if (!account.canPlay) {
    const error = new Error("这个账号不能试玩");
    error.status = 400;
    throw error;
  }
  const balance = Number(amount);
  if (!Number.isInteger(balance) || balance < 0 || balance > 100000000) {
    const error = new Error("金额要是 0 到 1 亿的整数");
    error.status = 400;
    throw error;
  }
  database.prepare("UPDATE users SET play_balance = ? WHERE id = ?").run(balance, userId);
  return getAccount(userId);
}

export function setUserPlayPrizes(userIds, prizes = {}, reset = false) {
  const ids = [...new Set((userIds || []).map((id) => Number(id)))].filter((id) => Number.isInteger(id) && id > 0);
  if (!ids.length) {
    const error = new Error("请选择用户");
    error.status = 400;
    throw error;
  }
  const missing = ids.filter((id) => !getAccount(id));
  if (missing.length) {
    const error = new Error("有用户不存在");
    error.status = 404;
    throw error;
  }
  const codes = Object.keys(DIRECT_PRIZE).filter((code) => prizes?.[code] !== undefined && prizes?.[code] !== "");
  if (!reset && !codes.length) {
    const error = new Error("请填写至少一个彩种的单注奖金");
    error.status = 400;
    throw error;
  }
  const amounts = {};
  for (const code of codes) {
    const prize = Number(prizes[code]);
    if (!Number.isInteger(prize) || prize < 0 || prize > 100000000) {
      const error = new Error("单注奖金要是 0 到 1 亿的整数");
      error.status = 400;
      throw error;
    }
    amounts[code] = prize;
  }
  const upsert = database.prepare(`
    INSERT INTO user_play_prizes (user_id, lottery_code, prize) VALUES (?, ?, ?)
    ON CONFLICT(user_id, lottery_code) DO UPDATE SET prize = excluded.prize
  `);
  const remove = database.prepare("DELETE FROM user_play_prizes WHERE user_id = ?");
  database.exec("BEGIN");
  try {
    for (const id of ids) {
      if (reset) {
        remove.run(id);
        continue;
      }
      for (const code of Object.keys(amounts)) upsert.run(id, code, amounts[code]);
    }
    database.exec("COMMIT");
  } catch (error) {
    database.exec("ROLLBACK");
    throw error;
  }
  return ids.map((id) => ({ id, prizes: playPrizesFor(id) }));
}

export function createPlayOrders({ userId, lotteryCode, selection, lines, multiple, now = new Date() }) {
  const lottery = getLottery(lotteryCode);
  if (lottery.source === "local") return createLocalPlayOrders({ userId, lottery, selection, lines, multiple, now });
  const chosen = normalizeMultiple(multiple);
  const rawLines = Array.isArray(lines) ? lines : (selection ? [selection] : []);
  if (!rawLines.length || rawLines.length > 50) {
    const error = new Error("请先选号");
    error.status = 400;
    throw error;
  }
  const latest = getDraws(lottery.code)[0];
  if (!latest) {
    const error = new Error("还没有开奖，不能模拟");
    error.status = 400;
    throw error;
  }
  const window = upcomingWindow(latest, getPlayDeadline(lottery.code), now);
  const cleaned = rawLines.map((line) => {
    const numbers = normalizeSelection(line, lottery.digits);
    const bets = countBets(numbers);
    return { numbers, bets, stake: lineStake(bets, chosen) };
  });
  const total = cleaned.reduce((sum, line) => sum + line.stake, 0);
  const stamp = now.toISOString();
  const insert = database.prepare(`
    INSERT INTO play_orders (
      user_id, lottery_code, based_issue, selection, bets, stake, multiple,
      target_issue, ahead, target_date, deadline_at, created_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);
  let firstId = 0;
  database.exec("BEGIN");
  try {
    const balance = readBalance(userId);
    if (balance <= 0) {
      const error = new Error("余额不足，暂时无法下单");
      error.status = 400;
      throw error;
    }
    if (balance < total) {
      const error = new Error(`试玩余额不足，还差 ${total - balance} 元`);
      error.status = 400;
      throw error;
    }
    database.prepare("UPDATE users SET play_balance = play_balance - ? WHERE id = ?").run(total, userId);
    cleaned.forEach((line) => {
      const result = insert.run(
        userId,
        lottery.code,
        latest.issue,
        JSON.stringify(line.numbers),
        line.bets,
        line.stake,
        chosen,
        window.issue,
        window.ahead,
        window.date,
        window.deadline,
        stamp,
      );
      if (!firstId) firstId = Number(result.lastInsertRowid);
    });
    database.exec("COMMIT");
  } catch (error) {
    database.exec("ROLLBACK");
    throw error;
  }
  const rows = database.prepare(`${orderSelect} WHERE o.id >= ? AND o.user_id = ? ORDER BY o.id`).all(firstId, userId);
  return {
    orders: rows.map((row) => presentPlayOrder(row, now)),
    balance: readBalance(userId),
  };
}

export function createPlayOrder(args) {
  return createPlayOrders(args).orders[0];
}

function createLocalPlayOrders({ userId, lottery, selection, lines, multiple, now }) {
  const chosen = normalizeMultiple(multiple);
  const rawLines = Array.isArray(lines) ? lines : (selection ? [selection] : []);
  if (!rawLines.length || rawLines.length > 50) {
    const error = new Error("请先选号");
    error.status = 400;
    throw error;
  }
  const pending = pendingSelfOrders(userId, lottery.code);
  const issue = pending[0]?.target_issue || nextSelfIssue(userId, lottery.code);
  const basedIssue = String(Math.max(0, Number(issue) - 1));
  const cleaned = rawLines.map((line) => {
    const numbers = normalizeSelection(line, lottery.digits);
    const bets = countBets(numbers);
    return { numbers, bets, stake: lineStake(bets, chosen) };
  });
  const total = cleaned.reduce((sum, line) => sum + line.stake, 0);
  const stamp = now.toISOString();
  const insert = database.prepare(`
    INSERT INTO play_orders (
      user_id, lottery_code, based_issue, selection, bets, stake, multiple,
      target_issue, ahead, target_date, deadline_at, created_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);
  let firstId = 0;
  database.exec("BEGIN");
  try {
    const balance = readBalance(userId);
    if (balance <= 0) {
      const error = new Error("余额不足，暂时无法下单");
      error.status = 400;
      throw error;
    }
    if (balance < total) {
      const error = new Error(`试玩余额不足，还差 ${total - balance} 元`);
      error.status = 400;
      throw error;
    }
    database.prepare("UPDATE users SET play_balance = play_balance - ? WHERE id = ?").run(total, userId);
    cleaned.forEach((line) => {
      const result = insert.run(
        userId, lottery.code, basedIssue, JSON.stringify(line.numbers), line.bets, line.stake, chosen,
        issue, 1, "", "", stamp,
      );
      if (!firstId) firstId = Number(result.lastInsertRowid);
    });
    database.exec("COMMIT");
  } catch (error) {
    database.exec("ROLLBACK");
    throw error;
  }
  const rows = database.prepare(`${orderSelect} WHERE o.id >= ? AND o.user_id = ? ORDER BY o.id`).all(firstId, userId);
  return {
    orders: rows.map((row) => presentPlayOrder(row, now)),
    balance: readBalance(userId),
  };
}

export function selfPlayBoard(userId, lotteryCode) {
  const pending = pendingSelfOrders(userId, lotteryCode);
  const recent = database.prepare(`
    SELECT lottery_code, issue, draw_date, digits
    FROM self_draws
    WHERE user_id = ? AND lottery_code = ?
    ORDER BY CAST(issue AS INTEGER) DESC
    LIMIT 10
  `).all(userId, lotteryCode).map(selfDrawRow);
  const nextIssue = pending[0]?.target_issue || nextSelfIssue(userId, lotteryCode);
  return {
    latest: recent[0] || null,
    recent,
    pendingCount: pending.length,
    nextIssue,
  };
}

export function drawSelfPlay({ userId, lotteryCode = "self3d", now = new Date(), digits } = {}) {
  const lottery = getLottery(lotteryCode);
  if (lottery.source !== "local") {
    const error = new Error("这个彩种不能自开");
    error.status = 400;
    throw error;
  }
  const pending = pendingSelfOrders(userId, lottery.code);
  if (!pending.length) {
    const error = new Error("还没有未开奖的注");
    error.status = 400;
    throw error;
  }
  const issue = pending[0].target_issue || nextSelfIssue(userId, lottery.code);
  const drawn = (Array.isArray(digits) ? digits : [randomInt(10), randomInt(10), randomInt(10)]).map(Number);
  if (drawn.length !== lottery.digits || drawn.some((digit) => !Number.isInteger(digit) || digit < 0 || digit > 9)) {
    const error = new Error("开奖号码不正确");
    error.status = 400;
    throw error;
  }
  const stamp = now.toISOString();
  database.exec("BEGIN");
  try {
    database.prepare(`
      INSERT INTO self_draws (user_id, lottery_code, issue, draw_date, digits, created_at)
      VALUES (?, ?, ?, ?, ?, ?)
    `).run(userId, lottery.code, issue, localDateKey(stamp), drawn.join(","), stamp);
    database.exec("COMMIT");
  } catch (error) {
    database.exec("ROLLBACK");
    throw error;
  }
  pending.forEach((row) => settleOrder({ ...row, target_issue: issue }));
  const orders = database.prepare(`${orderSelect} WHERE o.user_id = ? AND o.lottery_code = ? AND o.target_issue = ? ORDER BY o.id`).all(userId, lottery.code, issue);
  return {
    draw: selfDrawByIssue(userId, lottery.code, issue),
    orders: orders.map((row) => presentPlayOrder(row, now)),
    balance: readBalance(userId),
  };
}

export function deleteSelfPlayData(userIds) {
  const ids = [...new Set((userIds || []).map((id) => Number(id)))].filter((id) => Number.isInteger(id) && id > 0);
  if (!ids.length) {
    const error = new Error("请选择用户");
    error.status = 400;
    throw error;
  }
  const missing = ids.filter((id) => !getAccount(id));
  if (missing.length) {
    const error = new Error("有用户不存在");
    error.status = 404;
    throw error;
  }
  const placeholders = ids.map(() => "?").join(",");
  database.exec("BEGIN");
  try {
    const pending = database.prepare(`
      SELECT id, user_id, stake FROM play_orders
      WHERE lottery_code = 'self3d' AND cancelled_at IS NULL AND prize_credited = 0
        AND user_id IN (${placeholders})
    `).all(...ids);
    for (const row of pending) {
      database.prepare("UPDATE users SET play_balance = play_balance + ? WHERE id = ?").run(row.stake, row.user_id);
    }
    const removedOrders = database.prepare(`DELETE FROM play_orders WHERE lottery_code = 'self3d' AND user_id IN (${placeholders})`).run(...ids);
    const removedDraws = database.prepare(`DELETE FROM self_draws WHERE lottery_code = 'self3d' AND user_id IN (${placeholders})`).run(...ids);
    database.exec("COMMIT");
    return {
      users: ids.length,
      orders: removedOrders.changes,
      draws: removedDraws.changes,
      refunded: pending.reduce((sum, row) => sum + row.stake, 0),
    };
  } catch (error) {
    database.exec("ROLLBACK");
    throw error;
  }
}

export function listPlayOrders(account, now = new Date()) {
  settlePending();
  const sql = `
    ${orderSelect}
    ${account.canManage ? "" : "WHERE o.user_id = ?"}
    ORDER BY o.id DESC
    LIMIT 200
  `;
  const rows = account.canManage ? database.prepare(sql).all() : database.prepare(sql).all(account.id);
  const orders = rows.map((row) => presentPlayOrder(row, now));
  return {
    orders,
    balance: readBalance(account.id),
    summary: playSummary(orders.filter((order) => order.userId === account.id), now),
  };
}

function playSummary(orders, now) {
  const today = localDateKey(now.toISOString());
  const month = today.slice(0, 7);
  return {
    today: summarizeOrders(orders.filter((order) => localDateKey(order.createdAt) === today)),
    month: summarizeOrders(orders.filter((order) => localDateKey(order.createdAt).startsWith(month))),
  };
}

export function cancelPlayOrder({ id, account, now = new Date() }) {
  const row = orderRow(id);
  if (!row || (!account.canManage && row.user_id !== account.id)) {
    const error = new Error("订单不存在");
    error.status = 404;
    throw error;
  }
  if (row.cancelled_at) {
    const error = new Error("已经撤销");
    error.status = 400;
    throw error;
  }
  if (row.prize_credited || resolveResult(row)) {
    const error = new Error("已经开奖，不能撤销");
    error.status = 400;
    throw error;
  }
  const local = getLottery(row.lottery_code).source === "local";
  const deadline = row.deadline_at ? new Date(row.deadline_at) : null;
  if (!local && (!deadline || now.getTime() >= deadline.getTime())) {
    const error = new Error("已过截止时间，不能撤销");
    error.status = 400;
    throw error;
  }
  database.exec("BEGIN");
  try {
    const fresh = database.prepare("SELECT cancelled_at, stake, user_id FROM play_orders WHERE id = ?").get(id);
    if (!fresh.cancelled_at) {
      database.prepare("UPDATE play_orders SET cancelled_at = ? WHERE id = ?").run(now.toISOString(), id);
      database.prepare("UPDATE users SET play_balance = play_balance + ? WHERE id = ?").run(fresh.stake, fresh.user_id);
    }
    database.exec("COMMIT");
  } catch (error) {
    database.exec("ROLLBACK");
    throw error;
  }
  return {
    order: presentPlayOrder(orderRow(id), now),
    balance: readBalance(account.id),
  };
}

export function dismissPlayOrder({ id, account }) {
  const row = orderRow(id);
  if (!row || (!account.canManage && row.user_id !== account.id)) {
    const error = new Error("订单不存在");
    error.status = 404;
    throw error;
  }
  const order = presentPlayOrder(row);
  if (order.funded && order.status !== "cancelled") {
    const error = new Error("已经计入余额的单不能移除");
    error.status = 400;
    throw error;
  }
  database.prepare("DELETE FROM play_orders WHERE id = ?").run(id);
  return { balance: readBalance(account.id) };
}

function summarizeOrders(orders) {
  const active = orders.filter((order) => order.status !== "cancelled" && order.funded);
  const settled = active.filter((order) => order.status === "hit" || order.status === "miss");
  const stake = settled.reduce((sum, order) => sum + order.stake, 0);
  const prize = settled.reduce((sum, order) => sum + order.prize, 0);
  const pendingStake = active.filter((order) => order.status === "pending").reduce((sum, order) => sum + order.stake, 0);
  return { stake, prize, profit: prize - stake, pendingStake, count: settled.length };
}

export function playAdminReport(now = new Date()) {
  settlePending();
  const today = localDateKey(now.toISOString());
  const month = today.slice(0, 7);
  const orders = database.prepare(`${orderSelect} ORDER BY o.id DESC`).all().map((row) => presentPlayOrder(row, now));
  const users = database.prepare(`${userSelect} ORDER BY u.id`).all().map(publicAccount).filter((user) => user.canPlay);
  return {
    deadlines: listPlayDeadlines(),
    pendingCount: orders.filter((order) => order.status === "pending" && order.funded).length,
    summary: {
      today: summarizeOrders(orders.filter((order) => localDateKey(order.createdAt) === today)),
      month: summarizeOrders(orders.filter((order) => localDateKey(order.createdAt).startsWith(month))),
    },
    users: users.map((user) => {
      const own = orders.filter((order) => order.userId === user.id);
      return {
        ...user,
        balance: user.playBalance,
        prizes: playPrizesFor(user.id),
        pendingStake: summarizeOrders(own).pendingStake,
        todayProfit: summarizeOrders(own.filter((order) => localDateKey(order.createdAt) === today)).profit,
        monthProfit: summarizeOrders(own.filter((order) => localDateKey(order.createdAt).startsWith(month))).profit,
      };
    }),
    orders: orders.slice(0, 300),
  };
}
