<script setup>
import { computed, onMounted, ref } from "vue";
import { request } from "../api.js";

const accounts = ref([]);
const play = ref(null);
const sync = ref(null);
const error = ref("");
const loading = ref(true);

const cards = computed(() => {
  if (!play.value) return [];
  return [
    { label: "用户账号", value: accounts.value.length, suffix: "个", to: "/admin#users" },
    { label: "可模拟用户", value: play.value.users.length, suffix: "人", to: "/play-admin" },
    { label: "待开奖订单", value: play.value.pendingCount, suffix: "笔", to: "/play-admin" },
    { label: "今日模拟盈亏", value: signed(play.value.summary.today.profit), suffix: "元", to: "/play-admin", tone: play.value.summary.today.profit >= 0 ? "positive" : "negative" },
  ];
});

function signed(value) {
  const number = Number(value) || 0;
  return `${number > 0 ? "+" : ""}${number}`;
}

function syncLabel(status) {
  return status === "complete" ? "已完成" : status === "expired" ? "已结束" : "等待检查";
}

async function load() {
  loading.value = true;
  error.value = "";
  try {
    const [userData, playData, syncData] = await Promise.all([
      request("/api/admin/users"),
      request("/api/admin/play"),
      request("/api/admin/sync-status"),
    ]);
    accounts.value = userData.users;
    play.value = playData;
    sync.value = syncData;
  } catch (err) {
    error.value = err.message || "读取管理概况失败";
  } finally {
    loading.value = false;
  }
}

onMounted(load);
</script>

<template>
  <p v-if="error" class="banner" role="alert">{{ error }}</p>
  <header class="page-hero manage-hero">
    <p class="lede">账号、模拟试玩和开奖状态集中在这里。</p>
    <button class="text-btn" type="button" :disabled="loading" @click="load">{{ loading ? "正在刷新…" : "刷新概况" }}</button>
  </header>

  <section v-if="play" class="manage-metrics" aria-label="管理概况">
    <RouterLink v-for="card in cards" :key="card.label" :to="card.to" class="panel manage-metric" :class="card.tone">
      <span>{{ card.label }}</span><strong>{{ card.value }}<small>{{ card.suffix }}</small></strong>
    </RouterLink>
    <article class="panel manage-metric month-metric">
      <span>本月模拟盈亏</span><strong :class="play.summary.month.profit >= 0 ? 'positive' : 'negative'">{{ signed(play.summary.month.profit) }}<small>元</small></strong>
    </article>
  </section>

  <section class="panel manage-section">
    <div class="manage-section-head"><div><h2>快捷管理</h2><p class="quiet">直接进入常用管理操作</p></div></div>
    <nav class="manage-actions">
      <RouterLink to="/admin#users"><span class="manage-action-icon">♙</span><span><b>用户账号</b><small>创建、搜索、重置密码</small></span><i>›</i></RouterLink>
      <RouterLink to="/admin#roles"><span class="manage-action-icon">♧</span><span><b>角色权限</b><small>管理员、查询与试玩权限</small></span><i>›</i></RouterLink>
      <RouterLink to="/play-admin"><span class="manage-action-icon">￥</span><span><b>试玩管理</b><small>余额、订单和截止时间</small></span><i>›</i></RouterLink>
      <RouterLink to="/admin#clear-data"><span class="manage-action-icon">⌫</span><span><b>数据清理</b><small>分区清理与影响数量</small></span><i>›</i></RouterLink>
    </nav>
  </section>

  <section v-if="sync" class="panel manage-section">
    <div class="manage-section-head"><div><h2>今晚开奖同步</h2><p class="quiet">北京时间 {{ sync.window }} 开始，每 5 分钟检查；每个彩种分别完成。新号码同步后会在后台核对未开奖订单。</p></div><span class="manage-date">{{ sync.date }}</span></div>
    <div class="sync-status-list">
      <article v-for="item in sync.lotteries" :key="item.code" class="sync-status-row">
        <div class="sync-status-main"><strong>{{ item.name }}</strong><span :class="['sync-state', item.status]">{{ syncLabel(item.status) }}</span></div>
        <p class="quiet">{{ item.message }}<span v-if="item.lastAttempt"> · 最近检查 {{ item.lastAttempt.slice(11) }}</span></p>
      </article>
    </div>
    <p class="quiet sync-footnote">已完成的彩种会停止检查；尚未确认官网更新的彩种会继续检查到 22:30。订单分批结算，不挡住拉号码。服务需保持运行。</p>
  </section>
</template>
