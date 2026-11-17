import { createRouter, createWebHistory } from "vue-router";
import { loadSession, session } from "./session.js";
import AppShell from "./components/AppShell.vue";
import Login from "./views/Login.vue";
import Stats from "./views/Stats.vue";
import Query from "./views/Query.vue";
import Predict from "./views/Predict.vue";
import Backtest from "./views/Backtest.vue";
import Admin from "./views/Admin.vue";
import Mine from "./views/Mine.vue";
import Play from "./views/Play.vue";
import Orders from "./views/Orders.vue";
import PlayAdmin from "./views/PlayAdmin.vue";
import Manage from "./views/Manage.vue";

function safeNext(value) {
  if (typeof value !== "string" || !value.startsWith("/") || value.startsWith("//") || value.startsWith("/login")) return "/";
  return value;
}

export const router = createRouter({
  history: createWebHistory(),
  linkActiveClass: "on",
  routes: [
    { path: "/login", component: Login, meta: { public: true, title: "登录" } },
    {
      path: "/",
      component: AppShell,
      children: [
        { path: "", component: Stats, meta: { title: "首页" } },
        { path: "predict", component: Predict, meta: { title: "号码预测" } },
        { path: "backtest", component: Backtest, meta: { title: "向前回测" } },
        { path: "query", component: Query, meta: { title: "开奖查询" } },
        { path: "play", component: Play, meta: { title: "模拟试玩", play: true } },
        { path: "orders", component: Orders, meta: { title: "模拟订单", play: true } },
        { path: "mine", component: Mine, meta: { title: "我的" } },
        { path: "admin", component: Admin, meta: { title: "用户管理", manage: true } },
        { path: "play-admin", component: PlayAdmin, meta: { title: "试玩管理", manage: true } },
        { path: "manage", component: Manage, meta: { title: "管理中心", manage: true } },
      ],
    },
  ],
});

router.beforeEach(async (to) => {
  if (!session.ready) {
    try {
      await loadSession();
    } catch {
      session.user = null;
      session.ready = true;
    }
  }
  if (to.meta.public) {
    if (session.user && to.path === "/login") return safeNext(to.query.next);
    return true;
  }
  if (!session.user) return { path: "/login", query: { next: to.fullPath } };
  if (session.user.mustChangePassword && to.path !== "/mine") return { path: "/mine", query: { passwordRequired: "1" } };
  if (to.meta.manage && !session.user.canManage) return "/";
  if (to.meta.play && !session.user.canPlay) return "/mine";
  return true;
});
