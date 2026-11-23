<script setup>
import { computed, watch } from "vue";
import { useRoute, useRouter } from "vue-router";
import { NButton, NIcon } from "naive-ui";
import {
  GridOutline,
  HomeOutline,
  PeopleOutline,
  PersonOutline,
  ReceiptOutline,
  SearchOutline,
  SettingsOutline,
  TicketOutline,
  TrendingUpOutline,
} from "@vicons/ionicons5";
import { logout, session } from "../session.js";
import { applyTheme } from "../theme.js";

const route = useRoute();
const router = useRouter();
const title = computed(() => route.meta.title || "开奖统计");
const showNav = computed(() => !session.user?.mustChangePassword);

const mobileTabs = computed(() => {
  const items = [
    { to: "/", label: "总览", icon: HomeOutline },
    { to: "/predict", label: "预测", icon: TrendingUpOutline },
  ];
  if (session.user?.canPlay) items.push({ to: "/play", label: "试玩", icon: TicketOutline });
  else items.push({ to: "/query", label: "开奖", icon: SearchOutline });
  items.push({ to: "/mine", label: "我的", icon: PersonOutline });
  return items;
});

const workNav = computed(() => {
  const items = [
    { to: "/", label: "总览", icon: HomeOutline },
    { to: "/predict", label: "预测", icon: TrendingUpOutline },
    { to: "/query", label: "开奖", icon: SearchOutline },
  ];
  if (session.user?.canPlay) {
    items.push({ to: "/play", label: "模拟投注", icon: TicketOutline });
    items.push({ to: "/orders", label: "订单", icon: ReceiptOutline });
  }
  items.push({ to: "/mine", label: "我的", icon: PersonOutline });
  return items;
});

const manageNav = computed(() => {
  if (!session.user?.canManage) return [];
  return [
    { to: "/manage", label: "管理中心", icon: GridOutline },
    { to: "/admin", label: "用户", icon: PeopleOutline },
    { to: "/play-admin", label: "试玩运营", icon: SettingsOutline },
  ];
});

const showBack = computed(() => !mobileTabs.value.some((tab) => tab.to === route.path));
const initial = computed(() => (session.user?.username || "开").slice(0, 1).toUpperCase());

watch(title, (value) => {
  document.title = value;
}, { immediate: true });

watch(() => session.user?.id, () => {
  applyTheme();
}, { immediate: true });

function active(tab) {
  if (tab.to === "/") return route.path === "/";
  if (tab.to === "/predict") return route.path === "/predict" || route.path === "/backtest";
  if (tab.to === "/play") return route.path === "/play" || route.path === "/orders";
  if (tab.to === "/mine") return route.path === "/mine";
  return route.path === tab.to;
}

function goBack() {
  if (window.history.state?.back) {
    router.back();
    return;
  }
  const fallback = {
    "/orders": "/play",
    "/play-admin": "/manage",
    "/admin": "/manage",
    "/manage": "/mine",
    "/query": "/",
  }[route.path] || "/";
  router.push(fallback);
}

async function onLogout() {
  if (!window.confirm("退出当前账号？")) return;
  await logout();
  router.replace("/login");
}
</script>

<template>
  <div class="app-frame" :class="{ 'has-nav': showNav }">
    <aside v-if="showNav" class="sidenav">
      <div class="side-brand">
        <span class="mark">开</span>
        <strong>开奖统计</strong>
      </div>
      <p class="nav-label">工作台</p>
      <button
        v-for="item in workNav"
        :key="item.to"
        type="button"
        class="nav-link"
        :class="{ on: active(item) }"
        @click="router.push(item.to)"
      >
        <n-icon :size="18" :component="item.icon" />
        <span>{{ item.label }}</span>
      </button>
      <template v-if="manageNav.length">
        <p class="nav-label">管理</p>
        <button
          v-for="item in manageNav"
          :key="item.to"
          type="button"
          class="nav-link"
          :class="{ on: active(item) }"
          @click="router.push(item.to)"
        >
          <n-icon :size="18" :component="item.icon" />
          <span>{{ item.label }}</span>
        </button>
      </template>
      <button class="side-user" type="button" @click="router.push('/mine')">
        <span class="avatar">{{ initial }}</span>
        <span class="side-user-meta">
          <b>{{ session.user?.username }}</b>
          <small>{{ session.user?.roleName || "已登录" }}</small>
        </span>
      </button>
    </aside>
    <header class="app-bar" :class="{ 'has-back': showBack }">
      <n-button v-if="showBack" text class="back-trigger" aria-label="返回上一页" @click="goBack"><span aria-hidden="true">‹</span>返回</n-button>
      <div class="greet">
        <strong>你好，{{ session.user?.username }}</strong>
        <p>{{ title }}</p>
      </div>
      <div class="bar-actions">
        <n-button class="exit" secondary @click="onLogout">退出</n-button>
      </div>
    </header>
    <main class="page" :class="{ 'play-page': route.path === '/play' }">
      <RouterView />
    </main>
    <nav v-if="showNav" class="tabbar">
      <n-button
        v-for="tab in mobileTabs"
        :key="tab.to"
        quaternary
        class="tab-btn"
        :type="active(tab) ? 'primary' : 'default'"
        @click="router.push(tab.to)"
      >
        <span class="tab-item">
          <n-icon :size="18" :component="tab.icon" />
          <span>{{ tab.label }}</span>
        </span>
      </n-button>
    </nav>
  </div>
</template>
