<script setup>
import { computed, onMounted, ref, watch } from "vue";
import { useRoute, useRouter } from "vue-router";
import { request } from "../api.js";
import SectionTabs from "../components/SectionTabs.vue";

const route = useRoute();
const router = useRouter();
const PANES = [
  { id: "deadline", label: "截止时间", hash: "#deadline-management" },
  { id: "prize", label: "单注奖金", hash: "#prize-management" },
  { id: "wallet", label: "余额", hash: "#wallet-management" },
  { id: "orders", label: "订单", hash: "#order-management" },
];
function paneFromHash(hash) {
  return PANES.find((item) => item.hash === hash)?.id || "deadline";
}
const pane = ref(paneFromHash(route.hash));
watch(() => route.hash, (hash) => { pane.value = paneFromHash(hash); });
function showPane(id) {
  const next = PANES.find((item) => item.id === id);
  pane.value = next.id;
  if (route.hash !== next.hash) router.replace({ hash: next.hash });
}

const deadlines = ref([]);
const summary = ref(null);
const users = ref([]);
const orders = ref([]);
const drafts = ref({});
const selectedIds = ref([]);
const prizeDraft = ref({ fc3d: "1040", pl3: "1040", pl5: "100000", self3d: "1040" });
const prizeSaving = ref(false);
const error = ref("");
const saving = ref(false);
const busyId = ref(0);
const notice = ref("");
const walletSearch = ref("");
const orderSearch = ref("");
const orderLottery = ref("");
const orderStatus = ref("");

const filteredUsers = computed(() => {
  const needle = walletSearch.value.trim().toLowerCase();
  return users.value.filter((user) => !needle || user.username.toLowerCase().includes(needle));
});
const allFilteredSelected = computed(() => filteredUsers.value.length > 0 && filteredUsers.value.every((user) => selectedIds.value.includes(user.id)));
const filteredOrders = computed(() => {
  const needle = orderSearch.value.trim().toLowerCase();
  return orders.value.filter((order) => {
    if (orderLottery.value && order.lotteryCode !== orderLottery.value) return false;
    if (orderStatus.value && order.status !== orderStatus.value) return false;
    if (needle && !order.username.toLowerCase().includes(needle)) return false;
    return true;
  });
});
const totalBalance = computed(() => users.value.reduce((sum, user) => sum + Number(user.balance || 0), 0));
const pendingOrders = computed(() => orders.value.filter((order) => order.status === "pending" && order.funded).length);

function money(value) {
  if (value > 0) return `赚 ${value}`;
  if (value < 0) return `亏 ${Math.abs(value)}`;
  return "0";
}

function statusText(order) {
  if (order.status === "pending") return "待开奖";
  if (order.status === "hit") return "中了";
  if (order.status === "cancelled") return "已撤销";
  return "未中";
}

function toggleUser(id) {
  selectedIds.value = selectedIds.value.includes(id)
    ? selectedIds.value.filter((item) => item !== id)
    : [...selectedIds.value, id];
}

function toggleFiltered() {
  if (allFilteredSelected.value) {
    const visible = new Set(filteredUsers.value.map((user) => user.id));
    selectedIds.value = selectedIds.value.filter((id) => !visible.has(id));
    return;
  }
  selectedIds.value = [...new Set([...selectedIds.value, ...filteredUsers.value.map((user) => user.id)])];
}

function prizeText(user) {
  const prizes = user.prizes || {};
  return `福彩3D ${prizes.fc3d ?? 1040} · 排列三 ${prizes.pl3 ?? 1040} · 排列五 ${prizes.pl5 ?? 100000} · 自开3D ${prizes.self3d ?? 1040}`;
}

async function savePrizes(reset) {
  if (!selectedIds.value.length) {
    error.value = "请先勾选要设置奖金的用户";
    notice.value = "";
    return;
  }
  const prizes = {
    fc3d: Number(prizeDraft.value.fc3d),
    pl3: Number(prizeDraft.value.pl3),
    pl5: Number(prizeDraft.value.pl5),
    self3d: Number(prizeDraft.value.self3d),
  };
  if (!reset && Object.values(prizes).some((prize) => !Number.isInteger(prize) || prize < 0 || prize > 100000000)) {
    error.value = "单注奖金必须是 0 到 1 亿之间的整数";
    notice.value = "";
    return;
  }
  const names = users.value.filter((user) => selectedIds.value.includes(user.id)).map((user) => user.username).join("、");
  const question = reset
    ? `把 ${names} 的单注奖金恢复为默认（福彩3D 1040、排列三 1040、排列五 100000）？`
    : `把 ${names} 的单注奖金设为福彩3D ${prizes.fc3d}、排列三 ${prizes.pl3}、排列五 ${prizes.pl5}、自开3D ${prizes.self3d}？`;
  if (!window.confirm(`${question}已经开奖的订单仍按当时结算的金额，不会重算。`)) return;
  prizeSaving.value = true;
  error.value = "";
  notice.value = "";
  try {
    await request("/api/admin/play/prizes", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ userIds: selectedIds.value, prizes, reset }),
    });
    await load();
    notice.value = reset ? "选中用户已恢复默认单注奖金。" : "选中用户的单注奖金已保存。未开奖的订单按这个金额结算。";
  } catch (err) {
    error.value = err.message || "保存奖金失败";
  } finally {
    prizeSaving.value = false;
  }
}

function selectionText(order) {
  return order.selection.map((bag) => bag.join("")).join(" ");
}

async function load() {
  const data = await request("/api/admin/play");
  deadlines.value = data.deadlines;
  summary.value = data.summary;
  users.value = data.users;
  orders.value = data.orders;
  summary.value.pendingCount = data.pendingCount;
  const next = { ...drafts.value };
  data.users.forEach((user) => {
    if (next[user.id] === undefined) next[user.id] = String(user.balance);
  });
  drafts.value = next;
}

async function saveDeadlines() {
  saving.value = true;
  error.value = "";
  notice.value = "";
  try {
    const body = Object.fromEntries(deadlines.value.map((item) => [item.code, item.time]));
    const data = await request("/api/admin/play/deadlines", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    deadlines.value = data.deadlines;
    notice.value = "截止时间已保存。已提交的订单仍按下单时记录的截止时间处理。";
  } catch (err) {
    error.value = err.message || "保存失败";
  } finally {
    saving.value = false;
  }
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

async function resetBalance(user) {
  const rawBalance = String(drafts.value[user.id] ?? "").trim();
  if (!rawBalance) {
    error.value = "请输入要设置的试玩金额";
    notice.value = "";
    return;
  }
  const balance = Number(rawBalance);
  if (!Number.isInteger(balance) || balance < 0 || balance > 100000000) {
    error.value = "试玩金额必须是 0 到 1 亿之间的整数";
    notice.value = "";
    return;
  }
  if (balance === user.balance) {
    notice.value = `${user.username} 的余额没有变化。`;
    error.value = "";
    return;
  }
  const pending = user.pendingStake ? `未开奖还占 ${user.pendingStake} 元，这些单不会取消。` : "已有的单不会取消。";
  if (!window.confirm(`将 ${user.username} 的模拟余额从 ${user.balance} 元改为 ${balance} 元？${pending}此操作不会修改历史盈亏。`)) return;
  error.value = "";
  notice.value = "";
  try {
    await request(`/api/admin/play/balances/${user.id}`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ balance }),
    });
    await load();
    notice.value = `已将 ${user.username} 的模拟余额调整为 ${balance} 元。`;
  } catch (err) {
    error.value = err.message || "重置失败";
  }
}

async function deleteSelf() {
  error.value = "";
  notice.value = "";
  const picked = users.value.filter((user) => selectedIds.value.includes(user.id));
  if (!picked.length) {
    error.value = "请先勾选用户";
    return;
  }
  const names = picked.map((user) => user.username).join("、");
  if (!window.confirm(`删除 ${names} 的自开3D订单和开奖记录？未开奖的注会退回占用金额，已经派过的奖金留在余额里。其他彩种不动。`)) return;
  try {
    const result = await request("/api/admin/play/self3d", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ userIds: picked.map((user) => user.id) }),
    });
    await load();
    notice.value = `已删除 ${result.users} 人的自开3D：订单 ${result.orders} 笔，开奖 ${result.draws} 期，退回 ${result.refunded} 元。`;
  } catch (err) {
    error.value = err.message || "删除失败";
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
  <p v-if="notice" class="admin-notice" role="status">{{ notice }}</p>
  <SectionTabs :tabs="PANES" :model-value="pane" @update:model-value="showPane" />
  <p class="quiet">一次只改一件事。盈亏只统计已开奖的模拟订单，未开奖金额单独占用，不计入当前盈亏。</p>

  <section v-if="summary" class="play-admin-kpis">
    <article class="panel"><span>可试玩用户</span><strong>{{ users.length }}<small>人</small></strong><em>模拟余额合计 {{ totalBalance }} 元</em></article>
    <article class="panel"><span>待开奖订单</span><strong>{{ summary.pendingCount ?? pendingOrders }}<small>笔</small></strong><em>最近订单列表显示最近 300 笔</em></article>
    <article class="panel"><span>今日模拟盈亏</span><strong :class="summary.today.profit >= 0 ? 'gain' : 'loss'">{{ money(summary.today.profit) }}</strong><em>投入 {{ summary.today.stake }} · 收回 {{ summary.today.prize }} 元</em></article>
    <article class="panel"><span>本月模拟盈亏</span><strong :class="summary.month.profit >= 0 ? 'gain' : 'loss'">{{ money(summary.month.profit) }}</strong><em>投入 {{ summary.month.stake }} · 收回 {{ summary.month.prize }} 元</em></article>
  </section>
  <p v-if="pane === 'deadline'" class="quiet play-admin-note">修改截止时间只对之后新下的订单生效。</p>

  <section v-if="pane === 'deadline'" id="deadline-management" class="panel play-admin-section">
    <div class="play-admin-section-head"><div><p class="eyebrow">彩种设置</p><h2>撤销截止时间</h2></div></div>
    <p class="quiet">截止前允许用户撤销并退回金额。修改只对之后新下的订单生效，已有订单保留原截止时间。</p>
    <form class="deadline-form" @submit.prevent="saveDeadlines">
      <label v-for="item in deadlines" :key="item.code" class="deadline-card">
        <span>{{ item.name }}<small>撤销截止</small></span>
        <input v-model="item.time" type="time" required>
      </label>
      <button class="btn gold" type="submit" :disabled="saving">{{ saving ? "保存中…" : "保存三个彩种的设置" }}</button>
    </form>
  </section>

  <section v-if="pane === 'prize'" id="prize-management" class="panel play-admin-section">
    <div class="play-admin-section-head"><div><p class="eyebrow">结算金额</p><h2>单注奖金</h2></div><span class="admin-count">已选 {{ selectedIds.length }} 人</span></div>
    <p class="quiet">每个彩种可以按人单独设置。不设置时福彩3D、排列三、自开3D默认 1040 元，排列五默认 100000 元。勾选多人后一次保存，会把下面的金额同时应用到这些人。已经开奖的订单不重算。</p>
    <form class="prize-form" @submit.prevent="savePrizes(false)">
      <label>福彩3D<input v-model="prizeDraft.fc3d" inputmode="numeric" aria-label="福彩3D单注奖金" /></label>
      <label>排列三<input v-model="prizeDraft.pl3" inputmode="numeric" aria-label="排列三单注奖金" /></label>
      <label>排列五<input v-model="prizeDraft.pl5" inputmode="numeric" aria-label="排列五单注奖金" /></label>
      <label>自开3D<input v-model="prizeDraft.self3d" inputmode="numeric" aria-label="自开3D单注奖金" /></label>
      <div class="prize-actions">
        <button class="btn gold" type="submit" :disabled="prizeSaving">应用到选中用户</button>
        <button class="btn ghost" type="button" :disabled="prizeSaving" @click="savePrizes(true)">选中的人恢复默认</button>
      </div>
    </form>
  </section>

  <section v-if="pane === 'wallet'" id="wallet-management" class="panel play-admin-section">
    <div class="play-admin-section-head"><div><p class="eyebrow">额度管理</p><h2>用户模拟余额</h2></div><span class="admin-count">{{ users.length }} 人 · {{ totalBalance }} 元</span></div>
    <p class="quiet">调整余额不会取消未开奖订单，也不会覆盖历史订单。金额只用于模拟试玩。</p>
    <button class="btn ghost small" type="button" @click="deleteSelf">删除所选用户的自开3D</button>
    <label class="play-admin-search">搜索试玩用户<input v-model="walletSearch" type="search" placeholder="输入账号" /></label>
    <button class="btn ghost small" type="button" @click="toggleFiltered">{{ allFilteredSelected ? "取消全选" : "全选当前列表" }}</button>
    <div class="wallet-list">
      <article v-for="user in filteredUsers" :key="user.id" class="wallet-card">
        <header><div><label class="user-check"><input type="checkbox" :checked="selectedIds.includes(user.id)" @change="toggleUser(user.id)" /><strong>{{ user.username }}</strong></label><span>{{ user.roleName }}</span></div><span class="wallet-balance">当前余额 <b>{{ user.balance }}</b> 元</span></header>
        <p class="quiet">{{ prizeText(user) }}</p>
        <div class="wallet-stats"><span>今日 {{ money(user.todayProfit) }}</span><span>本月 {{ money(user.monthProfit) }}</span><span>未开奖占用 {{ user.pendingStake }} 元</span></div>
        <div class="wallet-reset"><label>调整为<input v-model="drafts[user.id]" inputmode="numeric" type="number" min="0" max="100000000" step="1" :aria-label="`设置 ${user.username} 的余额`"></label><span>元</span><button class="btn gold small" type="button" @click="resetBalance(user)">设置金额</button></div>
      </article>
      <p v-if="!filteredUsers.length" class="quiet empty-hint">{{ users.length ? "没有匹配的试玩用户。" : "还没有开启试玩权限的用户。" }}</p>
    </div>
  </section>

  <section v-if="pane === 'orders'" id="order-management" class="panel play-admin-section">
    <div class="play-admin-section-head"><div><p class="eyebrow">订单核对</p><h2>模拟下注明细</h2></div><span class="admin-count">显示 {{ filteredOrders.length }} / {{ orders.length }}</span></div>
    <div class="play-admin-filters">
      <input v-model="orderSearch" type="search" placeholder="按用户名搜索" aria-label="按用户名搜索订单">
      <select v-model="orderLottery" aria-label="按彩种筛选"><option value="">全部彩种</option><option value="fc3d">福彩3D</option><option value="pl3">排列三</option><option value="pl5">排列五</option><option value="self3d">自开3D</option></select>
    </div>
    <div class="order-status-tabs" role="group" aria-label="按订单状态筛选">
      <button v-for="option in [{ label: '全部', value: '' }, { label: '待开奖', value: 'pending' }, { label: '已中奖', value: 'hit' }, { label: '未中奖', value: 'miss' }, { label: '已撤销', value: 'cancelled' }]" :key="option.value || 'all'" type="button" :class="{ selected: orderStatus === option.value }" @click="orderStatus = option.value">{{ option.label }}</button>
    </div>
    <div class="table-wrap order-table">
      <table class="data-table">
        <thead>
          <tr><th>用户</th><th>彩种</th><th>号码</th><th>金额</th><th>状态</th><th>说明</th><th></th></tr>
        </thead>
        <tbody>
          <tr v-if="!filteredOrders.length"><td colspan="7">{{ orders.length ? "没有符合条件的订单。" : "还没有模拟订单。" }}</td></tr>
          <tr v-for="order in filteredOrders" :key="order.id">
            <td><strong>{{ order.username }}</strong></td>
            <td>{{ order.lotteryName }} · 第{{ order.targetIssue || order.basedIssue }}期</td>
            <td class="picks">{{ selectionText(order) }}</td>
            <td>{{ order.multiple }}倍 · {{ order.bets }}注 · {{ order.stake }}元</td>
            <td><span :class="['order-status', order.status]">{{ statusText(order) }}</span></td>
            <td class="wrap quiet">
              <template v-if="!order.funded">未扣余额</template>
              <template v-else-if="order.status === 'hit'">奖金 {{ order.prize }} 元 · {{ money(order.prize - order.stake) }}</template>
              <template v-else-if="order.status === 'miss'">{{ money(-order.stake) }}<span v-if="order.resultDigits?.length"> · 开奖 {{ order.resultDigits.join(" ") }}</span></template>
              <template v-else-if="order.status === 'pending'">占用 {{ order.stake }} 元<template v-if="order.deadlineText"> · 可撤销至 {{ order.deadlineText }}</template></template>
              <template v-else>已退回 {{ order.stake }} 元</template>
            </td>
            <td><button v-if="!order.funded || order.status === 'cancelled'" class="btn ghost small" type="button" :disabled="busyId === order.id" @click="dismiss(order)">移除</button></td>
          </tr>
        </tbody>
      </table>
    </div>
  </section>
</template>
