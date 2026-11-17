<script setup>
import { computed, onMounted, ref, watch } from "vue";
import { useRouter } from "vue-router";
import { request } from "../api.js";
import { LOTTERIES, currentLottery } from "../lottery.js";

const router = useRouter();
const code = ref(currentLottery());
const board = ref(null);
const picks = ref([]);
const lines = ref([]);
const multiple = ref(1);
const slipOpen = ref(false);
const error = ref("");
const multipleError = ref("");
const saving = ref(false);
const syncing = ref(false);
const syncNote = ref("");

const bets = computed(() => picks.value.reduce((total, bag) => total * (bag.length || 0), 1));
const stake = computed(() => bets.value * 2);
const slipBets = computed(() => lines.value.reduce((total, line) => total + line.selection.reduce((count, bag) => count * bag.length, 1), 0));
const multipleValid = computed(() => Number.isInteger(Number(multiple.value)) && Number(multiple.value) >= 1 && Number(multiple.value) <= 99);
const slipStake = computed(() => multipleValid.value ? slipBets.value * 2 * Number(multiple.value) : 0);
const shortfall = computed(() => Math.max(0, slipStake.value - (board.value?.balance || 0)));
const hasCurrentSelection = computed(() => picks.value.some((bag) => bag.length > 0));
const missingPosition = computed(() => hasCurrentSelection.value ? picks.value.findIndex((bag) => !bag.length) : -1);
const MAX_LINES = 50;

function emptyPicks(digits) {
  picks.value = Array.from({ length: digits }, () => []);
}

async function load() {
  localStorage.setItem("lottery.code", code.value);
  lines.value = [];
  slipOpen.value = false;
  multiple.value = 1;
  error.value = "";
  try {
    board.value = await request(`/api/play?lottery=${code.value}`);
    emptyPicks(board.value.lottery.digits);
  } catch (err) {
    error.value = err.message || "读取失败";
  }
}

async function refreshBalance() {
  const data = await request(`/api/play?lottery=${code.value}`);
  if (!board.value) return;
  board.value.balance = data.balance;
  board.value.upcoming = data.upcoming;
  board.value.latest = data.latest;
}

function toggle(index, digit) {
  error.value = "";
  const bag = picks.value[index];
  picks.value[index] = bag.includes(digit) ? bag.filter((item) => item !== digit) : [...bag, digit].sort((a, b) => a - b);
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

async function openSlip() {
  if (!board.value?.balance) {
    error.value = "余额不足，暂时无法继续模拟下单。";
    slipOpen.value = false;
    return;
  }
  if (hasCurrentSelection.value) {
    const emptyIndex = missingPosition.value;
    if (emptyIndex >= 0) {
      error.value = `请先选择第 ${emptyIndex + 1} 位号码。`;
      slipOpen.value = false;
      return;
    }
  } else if (!lines.value.length) {
    error.value = "请先选择号码，再点击选好了。";
    slipOpen.value = false;
    return;
  }
  if (!board.value.latest) {
    error.value = "当前没有可用的开奖结果，暂时无法下单。";
    slipOpen.value = false;
    return;
  }
  if (hasCurrentSelection.value) {
    if (lines.value.length >= MAX_LINES) {
      error.value = `号码明细最多添加 ${MAX_LINES} 组，请先删掉一些号码。`;
      slipOpen.value = false;
      return;
    }
    lines.value.push({ selection: picks.value.map((bag) => [...bag]) });
    emptyPicks(board.value.lottery.digits);
  }
  if (!lines.value.length) return;
  error.value = "";
  try {
    await refreshBalance();
  } catch (err) {
    error.value = err.message || "读取余额失败";
  }
  slipOpen.value = true;
}

function removeLine(index) {
  error.value = "";
  lines.value.splice(index, 1);
}

function clearLines() {
  error.value = "";
  lines.value = [];
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
  slipOpen.value = false;
}

async function submit() {
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
  try {
    await request("/api/orders", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        lottery: code.value,
        multiple: multiple.value,
        lines: lines.value.map((line) => line.selection),
      }),
    });
    router.push("/orders");
  } catch (err) {
    error.value = err.message || "下单失败";
    saving.value = false;
    try {
      await refreshBalance();
    } catch {
      // 余额刷新失败时仍留下单错误。
    }
  }
}

watch(code, load);
onMounted(load);
</script>

<template>
  <p v-if="error && !slipOpen" class="banner bet-error" role="alert">{{ error }}</p>
  <div class="play-top">
    <div class="play-lotteries">
      <button v-for="item in LOTTERIES" :key="item.code" type="button" :class="{ on: item.code === code }" @click="code = item.code">{{ item.name }}</button>
    </div>
  </div>
  <section v-if="board" class="play-sheet">
    <div class="play-head">
      <span class="play-mode">直选</span>
      <span>
        <button v-if="lines.length" class="text-btn" type="button" @click="slipOpen = true">明细 {{ lines.length }}</button>
        <RouterLink to="/orders">订单</RouterLink>
      </span>
    </div>
    <div v-if="board.latest" class="draw-line">
      <span class="draw-tag">开奖</span>
      <span>第{{ board.latest.issue }}期</span>
      <b v-for="(digit, index) in board.latest.digits" :key="index">{{ digit }}</b>
    </div>
    <p v-else class="quiet">还没有开奖，先同步后再模拟。</p>
    <div class="play-summary">
      <div v-if="board.upcoming" class="play-target"><span>本次模拟期号</span><strong>第{{ board.upcoming.issue }}期</strong><b>{{ board.upcoming.label }} {{ board.upcoming.time }} 截止</b></div>
      <div class="play-balance"><span>可用模拟金额</span><strong>{{ board.balance }}<small>元</small></strong></div>
    </div>
    <p v-if="bets > 1" class="banner">这一注是 {{ bets }} 注、{{ stake }} 元。中奖只按 1 注奖金算。</p>
    <details class="fold play-rules"><summary>模拟规则与开奖同步</summary><p>每注按 2 元乘倍数扣除。当前账号的单注奖金是福彩3D {{ board.prizes?.fc3d ?? "—" }} 元、排列三 {{ board.prizes?.pl3 ?? "—" }} 元、排列五 {{ board.prizes?.pl5 ?? "—" }} 元，中奖后再乘倍数。复式组合按注数扣款，命中时只返一注奖金。没单独配置时默认是 1040、1040、100000。模拟结果不代表真实派奖。</p><p>订单可在该彩种截止时间前撤销，撤销后退回模拟金额。开奖同步后会自动核对订单，不必自己再点一次。</p><p class="play-sync"><button class="text-btn" type="button" :disabled="syncing" @click="syncDraws">{{ syncing ? "正在同步…" : "现在同步开奖" }}</button><span v-if="syncNote">{{ syncNote }}</span></p></details>
    <div class="play-head">
      <span>每位至少选择 1 个号码</span>
      <button class="random" type="button" @click="randomize">机选</button>
    </div>
    <section v-for="(bag, index) in picks" :key="index">
      <h3>第{{ index + 1 }}位</h3>
      <div class="pad">
        <button v-for="digit in 10" :key="digit" type="button" class="num" :class="{ on: bag.includes(digit - 1) }" @click="toggle(index, digit - 1)">{{ digit - 1 }}</button>
      </div>
    </section>
  </section>
  <div class="bet-bar">
    <button class="clear" type="button" @click="clearPicks">清空</button>
    <span class="sum"><template v-if="hasCurrentSelection && missingPosition >= 0">请补选第 {{ missingPosition + 1 }} 位</template><template v-else-if="lines.length">已选 {{ slipBets }} 注待确认</template><template v-else-if="hasCurrentSelection">已选 {{ bets }} 注，共 {{ stake }} 元</template><template v-else>请先选择号码</template></span>
    <button class="ok" type="button" :disabled="!board || saving" @click="openSlip">选好了</button>
  </div>

  <section v-if="slipOpen" class="slip">
    <header class="slip-head">
      <strong>明细</strong>
      <button type="button" @click="clearLines">清空所有</button>
      <button type="button" class="slip-x" @click="slipOpen = false">×</button>
    </header>
    <div class="slip-actions">
      <button type="button" @click="addRandom(1)">+机选1注</button>
      <button type="button" @click="addRandom(5)">+机选5注</button>
      <button type="button" @click="slipOpen = false">+继续选号</button>
    </div>
    <div class="slip-body">
      <article class="ticket">
        <h3>直选</h3>
        <p v-if="!lines.length" class="quiet">还没有号码。可以机选，或返回继续选号。</p>
        <div v-for="(line, lineIndex) in lines" :key="lineIndex" class="slip-line">
          <button type="button" :aria-label="`移除第 ${lineIndex + 1} 组号码`" @click="removeLine(lineIndex)">×</button>
          <button type="button" class="slip-edit" @click="editLine(lineIndex)">
            <template v-for="(bag, index) in line.selection" :key="index">
              <span v-if="index"> | </span>第{{ index + 1 }}位 <b>{{ bag.join("") }}</b>
            </template>
          </button>
        </div>
      </article>
    </div>
    <footer class="slip-bar">
      <div class="mult">
        <span>倍数</span>
        <button type="button" @click="changeMultiple(-1)">−</button>
        <input v-model="multiple" inputmode="numeric" aria-label="倍数" @input="clearMultipleError" @change="commitMultiple">
        <button type="button" @click="changeMultiple(1)">+</button>
      </div>
      <div class="slip-submit">
        <span>共 {{ slipBets }} 注 · {{ slipStake }} 元</span>
        <button type="button" :disabled="saving" @click="submit">{{ saving ? "提交中…" : "确认模拟下单" }}</button>
      </div>
      <p v-if="board?.upcoming">第{{ board.upcoming.issue }}期 · {{ board.upcoming.label }} {{ board.upcoming.time }} 截止</p>
      <p v-if="multipleError" class="slip-validation" role="alert">{{ multipleError }}</p>
      <p v-if="error" class="slip-validation" role="alert">{{ error }}</p>
      <p v-if="multipleValid">{{ !board?.balance ? "余额不足，暂时无法下单" : shortfall ? `余额不足，还差 ${shortfall} 元` : `确认后将扣除 ${slipStake} 元，剩余 ${board.balance - slipStake} 元` }}</p>
    </footer>
  </section>
</template>
