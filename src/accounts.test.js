// 账号、角色、会话。临时库，不碰正式数据。
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { verifyPassword } from "./password.js";

const dbFile = path.join(os.tmpdir(), `fc3d-accounts-${process.pid}-${Date.now()}.sqlite`);
process.env.FC3D_DB = dbFile;

let adminPassword = "";

const {
  changePassword,
  closeDatabase,
  createRole,
  createSession,
  createPlayOrders,
  createUser,
  deleteRole,
  deleteSession,
  deleteUser,
  findUserByUsername,
  getSessionUser,
  initDatabase,
  listPlayOrders,
  listRoles,
  listUsers,
  resetUserPassword,
  setPlayBalance,
  takeInitialAdmin,
  upsertDraws,
} = await import("./db.js");

test("the first startup creates one super admin and does not rotate the password", () => {
  initDatabase();
  const created = takeInitialAdmin();
  adminPassword = created.password;
  assert.equal(created.username, "admin");
  assert.equal(verifyPassword(created.password, findUserByUsername("admin").password_hash), true);
  assert.equal(listUsers().length, 1);
  assert.equal(listRoles().some((role) => role.name === "查询" && !role.canManage), true);
  closeDatabase();
  initDatabase();
  assert.equal(takeInitialAdmin(), null);
  assert.equal(listUsers().length, 1);
});

test("a view role can be added and removed, a built-in role stays", () => {
  const role = createRole("管理员");
  assert.equal(role.canManage, false);
  assert.equal(role.canOperate, true);
  const view = listRoles().find((item) => item.name === "查询");
  const user = createUser({ username: "guest", password: "guest-pass", roleId: view.id });
  assert.equal(user.canOperate, false);
  assert.throws(() => deleteRole(view.id), /内置角色不能删除/);
  deleteUser(user.id);
  deleteRole(role.id);
  const adminRole = listRoles().find((item) => item.name === "超级管理员");
  assert.throws(() => deleteRole(adminRole.id), /内置角色不能删除/);
  assert.throws(() => deleteUser(listUsers()[0].id), /至少留一个超级管理员/);
});

test("a session opens the account until it is logged out", () => {
  const admin = listUsers()[0];
  const session = createSession(admin.id);
  assert.equal(getSessionUser(session.token).username, "admin");
  assert.equal(getSessionUser(session.token).canManage, true);
  deleteSession(session.token);
  assert.equal(getSessionUser(session.token), null);
});

test("a user can replace the password only when the old one matches", () => {
  const admin = listUsers()[0];
  const kept = createSession(admin.id);
  const other = createSession(admin.id);
  assert.throws(() => changePassword(admin.id, "wrong-password", "new-secret"), /原密码不对/);
  assert.throws(() => changePassword(admin.id, adminPassword, adminPassword), /新密码不能与当前密码相同/);
  changePassword(admin.id, adminPassword, "new-secret", kept.token);
  assert.equal(verifyPassword("new-secret", findUserByUsername("admin").password_hash), true);
  assert.equal(getSessionUser(kept.token).username, "admin");
  assert.equal(getSessionUser(other.token), null);
});

test("resetting a password issues a one-time password and ends that user's logins", () => {
  const role = listRoles().find((item) => item.name === "查询");
  const user = createUser({ username: "resetme", password: "old-secret", roleId: role.id });
  const session = createSession(user.id);
  const reset = resetUserPassword(user.id);
  assert.equal(verifyPassword(reset.password, findUserByUsername("resetme").password_hash), true);
  assert.notEqual(reset.password, "old-secret");
  assert.equal(getSessionUser(session.token), null);
  assert.equal(listUsers().find((item) => item.id === user.id).mustChangePassword, true);
  assert.throws(() => changePassword(user.id, reset.password, reset.password), /新密码不能与临时密码相同/);
  deleteUser(user.id);
});

test("deleting a user removes that user's play orders", () => {
  const role = createRole("管理员", true);
  const user = createUser({ username: "bettor", password: "bettor-pass", roleId: role.id });
  upsertDraws("fc3d", [{ issue: "2026001", drawDate: "2026-01-01", digits: [1, 2, 3], week: "周四" }]);
  setPlayBalance(user.id, 100);
  createPlayOrders({
    userId: user.id,
    lotteryCode: "fc3d",
    selection: [[1], [2], [3]],
    multiple: 1,
    now: new Date("2026-01-02T02:00:00Z"),
  });
  const admin = listUsers().find((item) => item.canManage);
  assert.equal(listPlayOrders(admin).orders.some((order) => order.userId === user.id), true);
  deleteUser(user.id);
  assert.equal(listPlayOrders(admin).orders.some((order) => order.userId === user.id), false);
  assert.equal(findUserByUsername("bettor"), null);
  deleteRole(role.id);
});

test.after(() => {
  closeDatabase();
  fs.rmSync(dbFile, { force: true });
});
