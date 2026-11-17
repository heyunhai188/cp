<script setup>
import { computed, watch } from "vue";
import { useRoute, useRouter } from "vue-router";
import { logout, session } from "../session.js";
import { applyTheme, themeStorageKey } from "../theme.js";

const route = useRoute();
const router = useRouter();
const title = computed(() => route.meta.title || "开奖统计");
const showBack = computed(() => route.path !== "/");
const tabs = computed(() => {
  const items = [
    { to: "/", label: "首页", icon: "home", exact: true },
    { to: "/predict", label: "预测", icon: "predict" },
    { to: "/query", label: "查询", icon: "search" },
  ];
  if (session.user?.canPlay) items.push({ to: "/play", label: "试玩", icon: "ticket" });
  items.push({ to: "/mine", label: "我的", icon: "user" });
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
  return tab.exact ? route.path === tab.to : route.path === tab.to;
}

function goBack() {
  // 浏览器有站内历史就按真实访问顺序返回；直接打开深层链接时回到合适的上级页。
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
  <div class="app-frame">
    <header class="app-bar" :class="{ 'has-back': showBack }">
      <strong>{{ title }}</strong>
      <button v-if="showBack" class="back-trigger" type="button" aria-label="返回上一页" @click="goBack"><span aria-hidden="true">‹</span>返回</button>
      <RouterLink v-if="session.user?.canManage && !session.user?.mustChangePassword" class="manage-shortcut" to="/manage">管理</RouterLink>
      <button class="exit" type="button" @click="onLogout">退出</button>
    </header>
    <main class="page" :class="{ 'play-page': route.path === '/play' }">
      <RouterView />
    </main>
    <nav v-if="!session.user?.mustChangePassword" class="tabbar">
      <RouterLink v-for="tab in tabs" :key="tab.to" :to="tab.to" custom v-slot="{ href, navigate }">
        <a :href="href" :class="{ on: active(tab) }" @click="navigate"><svg class="tab-icon" viewBox="0 0 24 24" aria-hidden="true"><path v-if="tab.icon === 'home'" d="m3 10 9-7 9 7v10a1 1 0 0 1-1 1h-5v-7H9v7H4a1 1 0 0 1-1-1Z"/><path v-else-if="tab.icon === 'predict'" d="M4 18 9 13l3 3 7-9M14 7h5v5"/><path v-else-if="tab.icon === 'search'" d="M10.5 3a7.5 7.5 0 1 0 0 15 7.5 7.5 0 0 0 0-15ZM16 16l5 5"/><path v-else-if="tab.icon === 'ticket'" d="M4 6h16v4a2 2 0 0 0 0 4v4H4v-4a2 2 0 0 0 0-4Zm6 0v2m0 3v2m0 3v2"/><path v-else d="M12 12a4 4 0 1 0 0-8 4 4 0 0 0 0 8ZM4 21a8 8 0 0 1 16 0"/></svg><span>{{ tab.label }}</span></a>
      </RouterLink>
    </nav>
  </div>
</template>
