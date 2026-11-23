<script setup>
import { computed, onMounted, onUnmounted, ref, watch } from "vue";
import { request } from "../api.js";
import { PLAY_LOTTERIES, currentLottery } from "../lottery.js";
function savedPlayCode() {
  const saved = localStorage.getItem("play.lottery");
  if (PLAY_LOTTERIES.some((item) => item.code === saved)) return saved;
  const current = currentLottery();
  return PLAY_LOTTERIES.some((item) => item.code === current) ? current : "fc3d";
}
const code = ref(savedPlayCode());
const board = ref(null);
const picks = ref([]);
const lines = ref([]);
const multiple = ref(1);
const slipOpen = ref(false);
const confirming = ref(false);
const records = ref([]);
const lastResult = ref(null);
const error = ref("");
const multipleError = ref("");
const saving = ref(false);
const syncing = ref(false);
const drawing = ref(false);
const syncNote = ref("");
const placedNote = ref("");
const recentOpen = ref(false);
const reveal = ref(null);
let spinTimer = 0;

const bets = computed(() => picks.value.reduce((total, bag) => total * (bag.length || 0), 1));
const stake = computed(() => bets.value * 2);
const slipBets = computed(() => lines.value.reduce((total, line) => total + line.selection.reduce((count, bag) => count * bag.length, 1), 0));
const multipleValid = computed(() => Number.isInteger(Number(multiple.value)) && Number(multiple.value) >= 1 && Number(multiple.value) <= 99);
const slipStake = computed(() => multipleValid.value ? slipBets.value * 2 * Number(multiple.value) : 0);
const shortfall = computed(() => Math.max(0, slipStake.value - (board.value?.balance || 0)));
const hasCurrentSelection = computed(() => picks.value.some((bag) => bag.length > 0));
const missingPosition = computed(() => hasCurrentSelection.value ? picks.value.findIndex((bag) => !bag.length) : -1);
const draftReady = computed(() => hasCurrentSelection.value && missingPosition.value < 0 && bets.value > 0);
const previewBets = computed(() => slipBets.value + (confirming.value || !draftReady.value ? 0 : bets.value));
const previewStake = computed(() => multipleValid.value ? previewBets.value * 2 * Number(multiple.value) : 0);
const previewShortfall = computed(() => Math.max(0, previewStake.value - (board.value?.balance || 0)));
const MAX_LINES = 50;
const GROUPS = [
  { id: "big", label: "大", digits: [5, 6, 7, 8, 9] },
  { id: "small", label: "小", digits: [0, 1, 2, 3, 4] },
  { id: "odd", label: "单", digits: [1, 3, 5, 7, 9] },
  { id: "even", label: "双", digits: [0, 2, 4, 6, 8] },
];

function emptyPicks(digits) {
  picks.value = Array.from({ length: digits }, () => []);
}

async function load() {
  localStorage.setItem("play.lottery", code.value);
  if (code.value !== "self3d") localStorage.setItem("lottery.code", code.value);
  lines.value = [];
  slipOpen.value = false;
  confirming.value = false;
  multiple.value = 1;
  error.value = "";
  syncNote.value = "";
  placedNote.value = "";
  try {
    board.value = await request(`/api/play?lottery=${code.value}`);
    emptyPicks(board.value.lottery.digits);
    await loadRecords();
  } catch (err) {
    error.value = err.message || "读取失败";
  }
}

async function loadRecords() {
  try {
    const data = await request("/api/orders");
    records.value = data.orders.filter((order) => order.lotteryCode === code.value).slice(0, 8);
  } catch {
    records.value = [];
  }
}

async function refreshBalance() {
  const data = await request(`/api/play?lottery=${code.value}`);
  if (!board.value) return;
  board.value.balance = data.balance;
  board.value.upcoming = data.upcoming;
  board.value.latest = data.latest;
  board.value.recent = data.recent;
  board.value.pendingCount = data.pendingCount;
  board.value.nextIssue = data.nextIssue;
}

function toggle(index, digit) {
  error.value = "";
  const bag = picks.value[index];
  picks.value[index] = bag.includes(digit) ? bag.filter((item) => item !== digit) : [...bag, digit].sort((a, b) => a - b);
}

function groupOn(bag, digits) {
  return digits.every((digit) => bag.includes(digit));
}

function applyGroup(index, digits) {
  error.value = "";
  const bag = picks.value[index];
  picks.value[index] = groupOn(bag, digits)
    ? bag.filter((digit) => !digits.includes(digit))
    : [...new Set([...bag, ...digits])].sort((a, b) => a - b);
}

function randomize() {
  error.value = "";
  picks.value = picks.value.map(() => [Math.floor(Math.random() * 10)]);
}

function clearPicks() {
  if (!board.value) return;
  error.value = "";
  emptyPicks(board.value.lottery.digits);
}

function randomLine() {
  return { selection: Array.from({ length: board.value.lottery.digits }, () => [Math.floor(Math.random() * 10)]) };
}

function addRandom(count) {
  error.value = "";
  if (lines.value.length + count > MAX_LINES) {
    error.value = `号码明细最多添加 ${MAX_LINES} 组，请先删掉一些号码。`;
    return;
  }
  lines.value.push(...Array.from({ length: count }, randomLine));
  slipOpen.value = true;
}

function stageCurrent() {
  confirming.value = false;
  if (!board.value) return false;
  if (hasCurrentSelection.value) {
    if (missingPosition.value >= 0) {
      error.value = `请先选择${board.value.lottery.positions?.[missingPosition.value] || `第 ${missingPosition.value + 1} 位`}号码。`;
      return false;
    }
    if (lines.value.length >= MAX_LINES) {
      error.value = `号码明细最多添加 ${MAX_LINES} 组，请先删掉一些号码。`;
      return false;
    }
    lines.value.push({ selection: picks.value.map((bag) => [...bag]) });
    emptyPicks(board.value.lottery.digits);
  }
  if (!lines.value.length) {
    error.value = "请先选择号码。";
    return false;
  }
  if (!board.value.local && !board.value.latest) {
    error.value = "当前没有可用的开奖结果，暂时无法下单。";
    return false;
  }
  error.value = "";
  return true;
}

async function askConfirm() {
  if (!stageCurrent()) return;
  try {
    await refreshBalance();
  } catch (err) {
    error.value = err.message || "读取余额失败";
    return;
  }
  if (!board.value?.balance || shortfall.value > 0) {
    error.value = !board.value?.balance ? "余额不足，暂时无法下单。" : `余额不足，还差 ${shortfall.value} 元。`;
    return;
  }
  confirming.value = true;
}

async function openSlip() {
  await askConfirm();
}

function removeLine(index) {
  error.value = "";
  confirming.value = false;
  lines.value.splice(index, 1);
}

function clearLines() {
  error.value = "";
  confirming.value = false;
  lines.value = [];
}

function statusText(order) {
  if (order.status === "pending") return "待开奖";
  if (order.status === "hit") return "中了";
  if (order.status === "cancelled") return "已撤销";
  return "未中";
}

async function cancelRecord(order) {
  if (!window.confirm(`撤销这注 ${order.stake} 元？截止前会退回余额。`)) return;
  error.value = "";
  try {
    const data = await request(`/api/orders/${order.id}/cancel`, { method: "POST" });
    if (board.value) board.value.balance = data.balance;
    await loadRecords();
  } catch (err) {
    error.value = err.message || "撤销失败";
  }
}

function wait(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function stopSpin() {
  if (!spinTimer) return;
  clearInterval(spinTimer);
  spinTimer = 0;
}

function startSpin(count) {
  stopSpin();
  reveal.value = {
    phase: "spin",
    shown: Array.from({ length: count }, () => Math.floor(Math.random() * 10)),
    hit: false,
    prize: 0,
    issue: "",
  };
  spinTimer = setInterval(() => {
    if (reveal.value?.phase !== "spin") return;
    reveal.value.shown = reveal.value.shown.map(() => Math.floor(Math.random() * 10));
  }, 70);
}

function closeReveal() {
  stopSpin();
  reveal.value = null;
}

async function animateDraw() {
  const count = board.value?.lottery?.digits || 3;
  startSpin(count);
  const started = Date.now();
  const data = await request("/api/play/draw", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ lottery: code.value }),
  });
  const remain = 1200 - (Date.now() - started);
  if (remain > 0) await wait(remain);
  stopSpin();
  const prize = data.orders.reduce((sum, order) => sum + (order.status === "hit" ? order.prize : 0), 0);
  reveal.value = {
    phase: "result",
    shown: data.draw.digits,
    hit: data.orders.some((order) => order.status === "hit"),
    prize,
    issue: data.draw.issue,
  };
  await refreshBalance();
}

async function drawNow() {
  if (drawing.value || !board.value?.local) return;
  drawing.value = true;
  error.value = "";
  try {
    await animateDraw();
  } catch (err) {
    closeReveal();
    error.value = err.message || "开奖失败";
  } finally {
    drawing.value = false;
  }
}

async function syncDraws() {
  if (syncing.value) return;
  syncing.value = true;
  error.value = "";
  syncNote.value = "";
  try {
    const data = await request("/api/play/sync", { method: "POST" });
    syncNote.value = data.results.map((item) => `${item.name}：${item.message}`).join(" ");
    await refreshBalance();
  } catch (err) {
    error.value = err.message || "同步失败";
  } finally {
    syncing.value = false;
  }
}

function changeMultiple(step) {
  const current = Number(multiple.value) || 1;
  multiple.value = Math.min(99, Math.max(1, current + step));
  multipleError.value = "";
  error.value = "";
}

function commitMultiple() {
  error.value = "";
  const value = Number(multiple.value);
  if (!Number.isInteger(value) || value < 1 || value > 99) {
    multipleError.value = "倍数请填写 1 到 99 的整数。";
    return;
  }
  multiple.value = value;
  multipleError.value = "";
}

function clearMultipleError() {
  multipleError.value = "";
}

function editLine(index) {
  const line = lines.value[index];
  if (!line || !board.value) return;
  picks.value = line.selection.map((bag) => [...bag]);
  lines.value.splice(index, 1);
  confirming.value = false;
  slipOpen.value = false;
}

async function submit() {
  if (!confirming.value) {
    await askConfirm();
    return;
  }
  error.value = "";
  if (saving.value) return;
  if (!lines.value.length) {
    error.value = "请先添加至少一注号码。";
    return;
  }
  if (!multipleValid.value) {
    multipleError.value = "倍数请填写 1 到 99 的整数。";
    return;
  }
  const invalidLine = lines.value.findIndex((line) => line.selection.length !== board.value.lottery.digits || line.selection.some((bag) => !bag.length));
  if (invalidLine >= 0) {
    error.value = `第 ${invalidLine + 1} 注号码不完整，请修改后再提交。`;
    return;
  }
  try {
    await refreshBalance();
  } catch (err) {
    error.value = err.message || "余额读取失败，请稍后重试。";
    return;
  }
  if (!board.value?.balance || shortfall.value > 0) {
    error.value = !board.value?.balance ? "余额不足，暂时无法下单。" : `余额不足，还差 ${shortfall.value} 元。`;
    return;
  }
  saving.value = true;
  let placedOk = false;
  try {
    const placed = await request("/api/orders", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        lottery: code.value,
        multiple: multiple.value,
        lines: lines.value.map((line) => line.selection),
      }),
    });
    placedOk = true;
    const local = board.value?.local;
    const count = placed.orders?.length || lines.value.length;
    lines.value = [];
    slipOpen.value = false;
    confirming.value = false;
    multiple.value = 1;
    emptyPicks(board.value.lottery.digits);
    lastResult.value = { count, orders: placed.orders || [], local: Boolean(local) };
    placedNote.value = local ? `已提交 ${count} 注，正在开奖` : `已提交 ${count} 注，开奖后自动兑奖`;
    await loadRecords();
    if (local) {
      await animateDraw();
      await loadRecords();
      const settled = new Map(records.value.map((order) => [order.id, order]));
      lastResult.value = {
        ...lastResult.value,
        orders: lastResult.value.orders.map((order) => settled.get(order.id) || order),
      };
      placedNote.value = "";
    } else {
      await refreshBalance();
    }
  } catch (err) {
    closeReveal();
    error.value = placedOk ? (err.message || "开奖失败") : (err.message || "下单失败");
    try {
      await refreshBalance();
    } catch {
      // 余额刷新失败时仍留下单错误。
    }
  } finally {
    saving.value = false;
  }
}

watch(code, () => {
  closeReveal();
  load();
});
onMounted(load);
onUnmounted(stopSpin);
</script>

<template>
  <p v-if="error" class="banner" role="alert">{{ error }}</p>
  <p v-else-if="placedNote && !reveal" class="play-toast" role="status">{{ placedNote }}</p>
  <div v-if="board" class="play-board">
    <aside class="play-side dash-card">
      <h2>彩种</h2>
      <div class="play-choices">
        <button v-for="item in PLAY_LOTTERIES" :key="item.code" type="button" :class="{ on: item.code === code }" @click="code = item.code">{{ item.name }}</button>
      </div>
      <h2>玩法</h2>
      <div class="play-choices">
        <button type="button" class="on">直选</button>
      </div>
      <p class="quiet">每位可选 1 个或多个号。注数是各位个数相乘，每注 2 元，再乘倍数。</p>
      <div class="play-side-meta">
        <span>可用余额</span>
        <strong>{{ board.balance }}<small>元</small></strong>
      </div>
      <div v-if="board.latest" class="play-side-draw">
        <span>最新开奖 · {{ board.latest.issue }}</span>
        <b>{{ board.latest.digits.join(" ") }}</b>
      </div>
      <p v-if="board.local" class="quiet">自开3D只属于当前账号。选号后提交，再在本页开奖。</p>
      <p v-else-if="board.upcoming" class="quiet">第 {{ board.upcoming.issue }} 期 · {{ board.upcoming.label }} {{ board.upcoming.time }} 截止</p>
      <button v-if="board.local" class="btn gold small" type="button" :disabled="drawing || !board.pendingCount" @click="drawNow">{{ drawing ? "开奖中…" : `开奖（${board.pendingCount} 笔未开）` }}</button>
      <button v-else class="btn ghost small" type="button" :disabled="syncing" @click="syncDraws">{{ syncing ? "正在同步…" : "同步开奖" }}</button>
      <p v-if="syncNote" class="quiet">{{ syncNote }}</p>
    </aside>

    <section class="play-sheet">
      <div class="play-head">
        <span>{{ board.lottery.name }} · 直选</span>
        <span class="quiet" v-if="draftReady">当前 {{ bets }} 注 · {{ stake }} 元</span>
        <span class="quiet" v-else-if="missingPosition >= 0">请补选{{ board.lottery.positions?.[missingPosition] || `第 ${missingPosition + 1} 位` }}</span>
      </div>
      <div class="play-tools">
        <button class="btn ghost small" type="button" @click="randomize">机选</button>
        <button class="btn ghost small" type="button" @click="clearPicks">清空</button>
        <button class="btn ghost small" type="button" @click="clearPicks(); randomize()">重新选择</button>
      </div>
      <section v-for="(bag, index) in picks" :key="index" class="play-position">
        <h3>{{ board.lottery.positions?.[index] || `第${index + 1}位` }}</h3>
        <div class="traits">
          <button v-for="group in GROUPS" :key="group.id" type="button" :class="{ on: groupOn(bag, group.digits) }" @click="applyGroup(index, group.digits)">{{ group.label }}</button>
        </div>
        <div class="pad">
          <button v-for="digit in 10" :key="digit" type="button" class="num" :class="{ on: bag.includes(digit - 1) }" @click="toggle(index, digit - 1)">{{ digit - 1 }}</button>
        </div>
      </section>
      <p v-if="bets > 1" class="quiet">这一注是 {{ bets }} 注、{{ stake }} 元。复式按注数扣款，命中只返一注奖金。</p>
    </section>

    <aside class="ticket-pane dash-card">
      <header class="slip-head">
        <strong>模拟投注单</strong>
        <button type="button" @click="clearLines">清空</button>
      </header>
      <div class="slip-actions">
        <button type="button" @click="addRandom(1)">机选 1 注</button>
        <button type="button" @click="addRandom(5)">机选 5 注</button>
        <button type="button" @click="stageCurrent">加入当前选号</button>
      </div>
      <div class="slip-body">
        <article v-if="hasCurrentSelection && !confirming" class="draft-line">
          <b>正在选</b>
          <p>
            <template v-for="(bag, index) in picks" :key="index">
              <span v-if="index"> · </span>{{ board.lottery.positions?.[index] || `第${index + 1}位` }} {{ bag.join("") || "—" }}
            </template>
          </p>
          <p class="quiet">{{ draftReady ? `${bets} 注 · ${stake} 元，确认时会并入投注单` : "号码还没选完" }}</p>
        </article>
        <p v-if="!lines.length && !hasCurrentSelection" class="quiet">选号后，注数和金额会显示在这里。</p>
        <div v-for="(line, lineIndex) in lines" :key="lineIndex" class="slip-line">
          <button type="button" :aria-label="`移除第 ${lineIndex + 1} 组号码`" @click="removeLine(lineIndex)">×</button>
          <button type="button" class="slip-edit" @click="editLine(lineIndex)">
            <template v-for="(bag, index) in line.selection" :key="index">
              <span v-if="index"> | </span>{{ board.lottery.positions?.[index] || `第${index + 1}位` }} <b>{{ bag.join("") }}</b>
            </template>
          </button>
        </div>
      </div>
      <footer class="slip-bar" :class="{ confirming }">
        <div class="mult">
          <span>倍数</span>
          <button type="button" @click="changeMultiple(-1)">−</button>
          <input v-model="multiple" inputmode="numeric" aria-label="倍数" @input="clearMultipleError(); confirming = false" @change="commitMultiple">
          <button type="button" @click="changeMultiple(1)">+</button>
        </div>
        <div class="confirm-summary">
          <p><b>{{ board.lottery.name }} · 直选</b></p>
          <p v-if="board.upcoming">第 {{ board.upcoming.issue }} 期 · {{ board.upcoming.time }} 截止</p>
          <p v-else-if="board.local">第 {{ board.nextIssue }} 期 · 提交后可立即开奖</p>
          <p>{{ previewBets }} 注 × {{ multipleValid ? multiple : "—" }} 倍 = <strong>{{ previewStake }} 元</strong></p>
          <p v-if="multipleValid">{{ previewShortfall ? `余额不足，还差 ${previewShortfall} 元` : `确认后余额 ${Math.max(0, board.balance - previewStake)} 元` }}</p>
        </div>
        <p v-if="multipleError" class="slip-validation" role="alert">{{ multipleError }}</p>
        <div class="slip-submit">
          <button v-if="confirming" type="button" @click="confirming = false">返回修改</button>
          <button type="button" :disabled="saving || !previewBets" @click="submit">{{ saving ? "提交中…" : confirming ? "确认提交" : "提交模拟" }}</button>
        </div>
      </footer>
      <section v-if="lastResult" class="play-result">
        <b>{{ lastResult.orders.some((order) => order.status === "pending") ? "已提交，等待开奖" : "已开奖" }} {{ lastResult.count }} 注</b>
        <p v-for="order in lastResult.orders" :key="order.id" class="quiet">第 {{ order.targetIssue || order.basedIssue }} 期 · {{ order.stake }} 元 · {{ statusText(order) }}</p>
      </section>
      <section class="play-records">
        <h3>最近记录</h3>
        <p v-if="!records.length" class="quiet">这个彩种还没有模拟记录。</p>
        <article v-for="order in records" :key="order.id" class="record-row">
          <span><b>{{ order.selection.map((bag) => bag.join("")).join(" ") }}</b><small>第 {{ order.targetIssue || order.basedIssue }} 期 · {{ order.stake }} 元</small></span>
          <em :class="order.status">{{ statusText(order) }}</em>
          <button v-if="order.cancellable" class="text-btn" type="button" @click="cancelRecord(order)">撤销</button>
        </article>
      </section>
    </aside>
  </div>

  <section v-if="reveal" class="draw-show" role="dialog" aria-modal="true" :aria-label="reveal.phase === 'spin' ? '正在开奖' : (reveal.hit ? '中奖' : '未中')">
    <div class="draw-card" :class="reveal.phase === 'result' ? (reveal.hit ? 'hit' : 'miss') : 'spin'">
      <p class="draw-kicker">第{{ reveal.issue || board?.nextIssue }}期</p>
      <h2 class="draw-title">{{ reveal.phase === "spin" ? "正在开奖" : (reveal.hit ? "中奖" : "未中") }}</h2>
      <div class="draw-balls">
        <b v-for="(digit, index) in reveal.shown" :key="index">{{ digit }}</b>
      </div>
      <p v-if="reveal.phase === 'result'" class="draw-prize">{{ reveal.hit ? `奖金 ${reveal.prize} 元` : "没有中奖" }}</p>
      <button v-if="reveal.phase === 'result'" class="btn gold" type="button" @click="closeReveal">继续选号</button>
    </div>
  </section>
</template>
