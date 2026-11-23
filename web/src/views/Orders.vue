<script setup>
import { computed, onMounted, ref } from "vue";
import { request } from "../api.js";
import { session } from "../session.js";

const orders = ref([]);
const balance = ref(0);
const summary = ref(null);
const error = ref("");
const busyId = ref(0);
const syncing = ref(false);
const lotteryFilter = ref("");
const statusFilter = ref("");
const visibleOrders = computed(() => orders.value.filter((order) => {
  if (lotteryFilter.value && order.lotteryCode !== lotteryFilter.value) return false;
  if (statusFilter.value === "cancellable" && !order.cancellable) return false;
  if (statusFilter.value && statusFilter.value !== "cancellable" && order.status !== statusFilter.value) return false;
  return true;
}));
const pendingCount = computed(() => orders.value.filter((order) => order.status === "pending").length);
const cancellableCount = computed(() => orders.value.filter((order) => order.cancellable).length);

function money(value) {
  if (value > 0) return `赚 ${value}`;
  if (value < 0) return `亏 ${Math.abs(value)}`;
  return "0";
}

function selectionText(order) {
  return order.selection.map((bag) => bag.join("")).join(" ");
}

function statusText(order) {
  if (order.status === "pending") return "待开奖";
  if (order.status === "hit") return "中了";
  if (order.status === "cancelled") return "已撤销";
  return "未中";
}

async function dismiss(order) {
  if (busyId.value) return;
  if (!window.confirm("移除这条订单？已经退回或从未扣过的金额不会再变动。")) return;
  busyId.value = order.id;
  error.value = "";
  try {
    await request(`/api/orders/${order.id}`, { method: "DELETE" });
    await load();
  } catch (err) {
    error.value = err.message || "移除失败";
  } finally {
    busyId.value = 0;
  }
}

async function load() {
  const data = await request("/api/orders");
  orders.value = data.orders;
  balance.value = data.balance;
  summary.value = data.summary;
}

async function syncDraws() {
  if (syncing.value) return;
  syncing.value = true;
  error.value = "";
  try {
    await request("/api/play/sync", { method: "POST" });
    await load();
  } catch (err) {
    error.value = err.message || "同步失败";
  } finally {
    syncing.value = false;
  }
}

async function cancel(order) {
  if (busyId.value) return;
  if (!window.confirm(`撤销这注 ${order.stake} 元？截止前会退回余额。`)) return;
  busyId.value = order.id;
  error.value = "";
  try {
    const data = await request(`/api/orders/${order.id}/cancel`, { method: "POST" });
    balance.value = data.balance;
    await load();
  } catch (err) {
    error.value = err.message || "撤销失败";
  } finally {
    busyId.value = 0;
  }
}

onMounted(async () => {
  try {
    await load();
  } catch (err) {
    error.value = err.message || "读取失败";
  }
});
</script>

<template>
  <p v-if="error" class="banner">{{ error }}</p>
  <header class="page-hero">
    <p class="lede">模拟余额 {{ balance }} 元。这里查看开奖、奖金和撤单状态；模拟奖金不是实际派奖。</p>
    <button class="btn ghost" type="button" :disabled="syncing" @click="syncDraws">{{ syncing ? "正在同步三个彩种…" : "同步开奖并核对" }}</button>
  </header>
  <section class="order-status-overview">
    <button type="button" :class="{ selected: statusFilter === 'pending' }" @click="statusFilter = statusFilter === 'pending' ? '' : 'pending'"><strong>{{ pendingCount }}</strong><span>待开奖</span></button>
    <button type="button" :class="{ selected: statusFilter === 'cancellable' }" @click="statusFilter = statusFilter === 'cancellable' ? '' : 'cancellable'"><strong>{{ cancellableCount }}</strong><span>可撤销</span></button>
    <p v-if="cancellableCount" class="order-cutoff-hint">可撤销订单会显示对应截止时间，到点后撤销入口自动关闭。</p>
  </section>
  <section v-if="summary" class="profit-row">
    <article class="panel">
      <p class="eyebrow">我的今日</p>
      <strong :class="summary.today.profit >= 0 ? 'gain' : 'loss'">{{ money(summary.today.profit) }}</strong>
      <p class="quiet">投入 {{ summary.today.stake }} 元 · 收回 {{ summary.today.prize }} 元</p>
    </article>
    <article class="panel">
      <p class="eyebrow">我的本月</p>
      <strong :class="summary.month.profit >= 0 ? 'gain' : 'loss'">{{ money(summary.month.profit) }}</strong>
      <p class="quiet">投入 {{ summary.month.stake }} 元 · 收回 {{ summary.month.prize }} 元</p>
    </article>
  </section>
  <p class="quiet">盈亏只算已经开奖的单，按下注日期归到今天或本月。未开奖单独显示，不先算成亏。</p>
  <div class="order-filters">
    <select v-model="lotteryFilter" aria-label="按彩种筛选">
      <option value="">全部彩种</option>
      <option value="fc3d">福彩3D</option>
      <option value="pl3">排列三</option>
      <option value="pl5">排列五</option>
      <option value="self3d">自开3D</option>
    </select>
    <select v-model="statusFilter" aria-label="按状态筛选">
      <option value="">全部状态</option>
      <option value="pending">待开奖</option>
      <option value="hit">中了</option>
      <option value="miss">未中</option>
      <option value="cancelled">已撤销</option>
    </select>
  </div>
  <p v-if="!error && !visibleOrders.length" class="quiet">没有符合条件的订单。</p>
  <article v-for="order in visibleOrders" :key="order.id" class="order">
    <header>
      <strong>{{ order.lotteryName }} 直选</strong>
      <span :class="['order-status', order.status]">{{ statusText(order) }}<template v-if="order.cancellable"> · 可撤销</template></span>
    </header>
    <p v-if="session.user?.canManage" class="quiet">{{ order.username }}</p>
    <p class="picks">{{ selectionText(order) }}</p>
    <p v-if="order.funded" class="quiet">第{{ order.targetIssue }}期 · {{ order.multiple }}倍 · {{ order.bets }}注 · {{ order.stake }}元</p>
    <p v-else class="quiet">余额功能之前的单 · 依据第{{ order.basedIssue }}期 · {{ order.bets }}注 · {{ order.stake }}元</p>
    <p class="quiet">{{ order.createdText }} 下单</p>
    <p v-if="order.cancellable && order.deadlineText" class="order-deadline">可撤销至 {{ order.deadlineText }}</p>
    <p v-else-if="order.deadlineText && order.status === 'pending'" class="quiet">撤销截止：{{ order.deadlineText }}（已过截止时间）</p>
    <p v-if="order.status === 'pending' && order.lotteryCode === 'self3d'" class="quiet">第{{ order.targetIssue }}期，回到试玩点开奖后一起兑奖。</p>
    <p v-else-if="order.status === 'pending' && order.funded" class="quiet">预计第{{ order.targetIssue }}期，还没同步到开奖。</p>
    <p v-else-if="order.status === 'pending'" class="quiet">还没同步到开奖。</p>
    <p v-else-if="order.status === 'cancelled'" class="quiet">已退回 {{ order.stake }} 元。</p>
    <p v-else class="quiet">开奖第{{ order.resultIssue }}期 {{ order.resultDigits.join(" ") }}<template v-if="order.targetIssue && order.resultIssue !== order.targetIssue">（下单时预计 {{ order.targetIssue }}）</template><template v-if="order.status === 'hit'"> · 模拟奖金 {{ order.prize }} 元</template></p>
    <button v-if="order.cancellable" class="btn ghost small" type="button" :disabled="busyId === order.id" @click="cancel(order)">撤销</button>
    <button v-if="!order.funded || order.status === 'cancelled'" class="btn ghost small" type="button" :disabled="busyId === order.id" @click="dismiss(order)">移除</button>
  </article>
</template>
