<script setup>
import { computed, watch } from "vue";
import { useRoute, useRouter } from "vue-router";
import { NButton, NIcon } from "naive-ui";
import { HomeOutline, PersonOutline, SearchOutline, TicketOutline, TrendingUpOutline } from "@vicons/ionicons5";
import { logout, session } from "../session.js";
import { applyTheme, themeStorageKey } from "../theme.js";

const route = useRoute();
const router = useRouter();
const title = computed(() => route.meta.title || "开奖统计");
const showBack = computed(() => route.path !== "/");
const tabs = computed(() => {
  const items = [
    { to: "/", label: "首页", icon: HomeOutline },
    { to: "/predict", label: "预测", icon: TrendingUpOutline },
  ];
  if (session.user?.canPlay) items.push({ to: "/play", label: "试玩", icon: TicketOutline });
  else items.push({ to: "/query", label: "查询", icon: SearchOutline });
  items.push({ to: "/mine", label: "我的", icon: PersonOutline });
  return items;
});

watch(title, (value) => {
  document.title = value;
}, { immediate: true });

watch(() => session.user?.id, (userId) => {
  const saved = localStorage.getItem(themeStorageKey(userId)) || localStorage.getItem("lottery.theme") || "classic";
  applyTheme(saved);
}, { immediate: true });

function active(tab) {
  if (tab.to === "/") return route.path === "/";
  if (tab.to === "/predict") return route.path === "/predict" || route.path === "/backtest";
  if (tab.to === "/play") return route.path === "/play" || route.path === "/orders";
  if (tab.to === "/mine") return ["/mine", "/manage", "/admin", "/play-admin"].includes(route.path);
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
  <div class="app-frame" :class="{ 'has-nav': !session.user?.mustChangePassword }">
    <header class="app-bar" :class="{ 'has-back': showBack }">
      <strong>{{ title }}</strong>
      <n-button v-if="showBack" text text-color="#ffffff" class="back-trigger" aria-label="返回上一页" @click="goBack"><span aria-hidden="true">‹</span>返回</n-button>
      <n-button v-if="session.user?.canManage && !session.user?.mustChangePassword" text text-color="#ffffff" class="manage-shortcut" @click="router.push('/manage')">管理</n-button>
      <n-button text text-color="#ffffff" class="exit" @click="onLogout">退出</n-button>
    </header>
    <main class="page" :class="{ 'play-page': route.path === '/play' }">
      <RouterView />
    </main>
    <nav v-if="!session.user?.mustChangePassword" class="tabbar">
      <p class="side-brand">开奖统计</p>
      <n-button
        v-for="tab in tabs"
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
