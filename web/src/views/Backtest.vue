<script setup>
import { computed, defineAsyncComponent, onMounted, ref, watch } from "vue";
const HitReport = defineAsyncComponent(() => import("../components/HitReport.vue"));
import { request } from "../api.js";
import { LOTTERIES } from "../lottery.js";
import { session } from "../session.js";
import {
  clampN,
  formatBets,
  formatCount,
  formatMoney,
  formatRate,
  longestText,
  readMultiple,
  readPrize,
} from "../format.js";

const props = defineProps({
  embedded: { type: Boolean, default: false },
  lotteryCode: { type: String, default: "" },
});
const METHOD_GROUPS = [
  { id: "compound", name: "复式", methods: [
  { id: "joint-compound", name: "综合复式" },
  { id: "hot-compound", name: "热号复式" },
  { id: "cold-compound", name: "冷号复式" },
  ] },
  { id: "direct", name: "直选", methods: [
    { id: "joint-direct", name: "综合直选" },
    { id: "hot-direct", name: "冷热直选" },
  ] },
];
const METHODS = METHOD_GROUPS.flatMap((group) => group.methods);
const presets = [30, 50, 100, 200, 500];

const canBacktestPl5 = computed(() => Boolean(session.user?.canManage));
const lotteries = computed(() => (canBacktestPl5.value ? LOTTERIES : LOTTERIES.filter((item) => item.code !== "pl5")));
const lottery = ref((props.embedded && props.lotteryCode) || localStorage.getItem("backtest.lottery") || "fc3d");
if (!props.embedded && lottery.value === "pl5" && !canBacktestPl5.value) lottery.value = "fc3d";
const n = ref(clampN(localStorage.getItem("backtest.n") || "100"));
const k = ref(localStorage.getItem("backtest.k") || "");
const methodId = ref(localStorage.getItem("backtest.method") || "joint-compound");
const prize = ref(localStorage.getItem(`backtest.prize.${lottery.value}`) || "");
const multiple = ref(localStorage.getItem(`backtest.multiple.${lottery.value}`) || "1");
const cache = ref({});
const note = ref("");
const error = ref("");
const running = ref(false);
let requestId = 0;

const paramsKey = computed(() => `${n.value}|${String(k.value).trim()}`);
const result = computed(() => {
  const entry = cache.value[lottery.value];
  if (!entry || entry.key !== paramsKey.value) return null;
  return entry.result;
});
const method = computed(() => (result.value?.methods || []).find((item) => item.id === methodId.value) || result.value?.methods?.[0] || null);
const testRange = computed(() => {
  const points = result.value?.points || [];
  if (!points.length) return "";
  const first = points[0];
  const last = points.at(-1);
  return `${first.date} 第${first.issue}期 — ${last.date} 第${last.issue}期`;
});
const comparison = computed(() => {
  if (!result.value?.trials || !method.value) return null;
  return {
    difference: method.value.hits - method.value.expected,
    expectedHits: method.value.expected,
    definition: method.value.id.includes("compound")
      ? "复式命中：当期开奖号码的每一位都在对应位置的预测集合内，至少覆盖一注组合。"
      : "直选命中：当期完整开奖号码与本期任一组预测号码完全一致。",
  };
});

const profit = computed(() => {
  const current = result.value;
  const picked = method.value;
  if (!current?.trials || !picked) return null;
  const multipleValue = readMultiple(multiple.value);
  if (String(prize.value).trim() === "") {
    return { kind: "help", text: "填写 1 倍中奖金额。每期投入 = 注数 × 2 元 × 倍数，单次中奖 = 1 倍金额 × 倍数，盈亏 = 命中收回 − 总投入。" };
  }
  const prizeValue = readPrize(prize.value);
  if (prizeValue === null || multipleValue === null) {
    return { kind: "help", text: "1 倍中奖金额要大于等于 0，倍数要是 1 到 9999 的整数。" };
  }
  const stakePerDraw = picked.meanBets * 2 * multipleValue;
  const prizePerHit = prizeValue * multipleValue;
  const spent = stakePerDraw * current.trials;
  const returned = prizePerHit * picked.hits;
  const net = returned - spent;
  const breakEvenPrize = picked.hits > 0 ? spent / (picked.hits * multipleValue) : null;
  return {
    kind: "numbers",
    stakePerDraw,
    prizePerHit,
    spent,
    returned,
    net,
    bets: picked.meanBets,
    multiple: multipleValue,
    prize: prizeValue,
    breakEvenPrize,
    hits: picked.hits,
    trials: current.trials,
  };
});

function bars() {
  const current = result.value;
  const picked = method.value;
  if (!current?.trials || !picked) return null;
  const actualRate = picked.hits / current.trials;
  const theoryRate = picked.expected / current.trials;
  const scale = Math.max(actualRate, theoryRate, 0.000001);
  return {
    actual: (100 * actualRate) / scale,
    theory: (100 * theoryRate) / scale,
    actualText: formatRate(picked.hits, current.trials),
    theoryText: formatRate(picked.expected, current.trials),
  };
}

function persist() {
  localStorage.setItem("backtest.lottery", lottery.value);
  localStorage.setItem("backtest.n", String(n.value));
  localStorage.setItem("backtest.k", String(k.value).trim());
  localStorage.setItem("backtest.method", methodId.value);
}

async function load() {
  if (lottery.value === "pl5" && !canBacktestPl5.value) {
    if (!props.embedded) lottery.value = "fc3d";
    error.value = "排列五回测只对超级管理员开放";
    note.value = "";
    return;
  }
  const id = ++requestId;
  n.value = clampN(n.value);
  k.value = String(k.value).trim();
  persist();
  const params = new URLSearchParams({ lottery: lottery.value, n: String(n.value) });
  if (k.value) params.set("k", k.value);
  running.value = true;
  note.value = lottery.value === "pl5"
    ? "正在回测排列五。排列五要逐期算完全部号码，大约十几秒。"
    : `正在回测${LOTTERIES.find((item) => item.code === lottery.value)?.name || ""}。`;
  try {
    const data = await request(`/api/backtest?${params}`);
    if (id !== requestId) return;
    error.value = "";
    cache.value = { ...cache.value, [lottery.value]: { key: `${n.value}|${k.value}`, result: data.result } };
    if (!data.result.trials) {
      note.value = `${data.result.lottery.name} 库里有 ${data.result.drawCount} 期。近 ${data.result.n} 期回测至少要 ${data.result.n + 1} 期。`;
    }
  } catch (err) {
    if (id !== requestId) return;
    error.value = err.message || "回测失败";
  } finally {
    if (id === requestId) running.value = false;
  }
}

function switchLottery(code) {
  if (!code || code === lottery.value) return;
  if (code === "pl5" && !canBacktestPl5.value) {
    lottery.value = code;
    error.value = "排列五回测只对超级管理员开放";
    note.value = "";
    return;
  }
  lottery.value = code;
  localStorage.setItem("backtest.lottery", code);
  prize.value = localStorage.getItem(`backtest.prize.${code}`) || "";
  multiple.value = localStorage.getItem(`backtest.multiple.${code}`) || "1";
  const cached = cache.value[code];
  if (cached && cached.key === paramsKey.value) return;
  load();
}

function chooseMethod(id) {
  methodId.value = id;
  localStorage.setItem("backtest.method", id);
}

function rememberMoney() {
  localStorage.setItem(`backtest.prize.${lottery.value}`, String(prize.value).trim());
  localStorage.setItem(`backtest.multiple.${lottery.value}`, String(multiple.value).trim());
}

function setN(value) {
  n.value = clampN(value);
  load();
}

watch(() => props.lotteryCode, (code) => {
  if (!props.embedded || !code) return;
  switchLottery(code);
});

onMounted(load);
</script>

<template>
  <p v-if="error" class="banner">{{ error }}</p>
  <header v-if="!props.embedded" class="page-hero">
    <p class="eyebrow">只用过去核对过去</p>
    <h1>向前回测</h1>
    <p class="lede">对比历史命中、随机理论次数和最长未中。回测结果不代表未来中奖概率。</p>
  </header>
  <section class="panel predict-controls">
    <div v-if="!props.embedded" class="lottery-switch">
      <button v-for="item in lotteries" :key="item.code" type="button" class="btn ghost small" :class="{ on: item.code === lottery }" @click="switchLottery(item.code)">{{ item.name }}</button>
    </div>
    <p v-if="!canBacktestPl5" class="quiet">排列五要逐期算完全部号码，回测只对超级管理员开放。</p>
    <section v-for="group in METHOD_GROUPS" :key="group.id" class="method-group">
      <h3><span>{{ group.id === 'compound' ? '▦' : '☷' }}</span>{{ group.name }}</h3>
      <div class="lottery-switch"><button v-for="item in group.methods" :key="item.id" type="button" class="btn ghost small" :class="{ on: item.id === methodId }" @click="chooseMethod(item.id)">{{ item.name }}</button></div>
    </section>
    <details class="fold backtest-options"><summary>回测范围与盈亏设置 · 近 {{ n }} 期</summary>
    <div class="range-row">
      <span>近</span>
      <input v-model.number="n" inputmode="numeric" aria-label="回测窗口期数" @change="load" />
      <span>期</span>
    </div>
    <div class="presets">
      <button v-for="value in presets" :key="value" class="btn ghost small" type="button" @click="setN(value)">{{ value }}</button>
    </div>
    <p class="quiet">默认 100 期，和预测用的是同一窗口。库里更早的开奖只增加可核对的期数，不改变每一期的选号范围。</p>
    <div class="range-row">
      <span>每位</span>
      <input v-model="k" inputmode="numeric" aria-label="每位取号个数" placeholder="默认" @change="load" />
      <span>个号</span>
    </div>
    <div class="range-row">
      <span>1倍中奖</span>
      <input v-model="prize" inputmode="decimal" aria-label="1倍中奖金额" placeholder="例如 1960" @input="rememberMoney" />
      <span>元</span>
    </div>
    <p class="quiet">这里填的是假设奖金，用来算回测盈亏。试玩结算用的是超级管理员给每个账号配置的单注奖金，没配置时福彩3D、排列三为 1040 元，排列五为 100000 元。</p>
    <div class="range-row">
      <span>投注</span>
      <input v-model="multiple" inputmode="numeric" aria-label="投注倍数" placeholder="1" @input="rememberMoney" />
      <span>倍</span>
    </div>
    <button class="btn gold" type="button" :disabled="running" @click="load">{{ running ? "计算中…" : "重新计算" }}</button>
    </details>
  </section>
  <p class="quiet">{{ result && method && result.trials ? `${result.lottery.name} · ${method.name}。每次预测使用开奖前近 ${result.n} 期，之后用实际开奖逐期核对；每位个数留空时默认取 4 个。` : note }}</p>

  <article v-if="result && (!result.trials || !method)" class="panel backtest-card">
    <h2>{{ result.lottery.name }}</h2>
    <p class="quiet">库里有 {{ result.drawCount }} 期。近 {{ result.n }} 期回测至少要 {{ result.n + 1 }} 期。</p>
  </article>

  <article v-else-if="result && method" class="panel backtest-card">
    <div class="section-head">
      <h2>{{ result.lottery.name }}</h2>
      <p class="quiet">依据近 {{ result.n }} 期 · 每位 {{ result.k }} 个 · 实际核对 {{ result.trials }} 期 · 平均每期 {{ formatBets(method.meanBets) }} 注</p>
    </div>
    <p v-if="testRange" class="backtest-period"><span>实际核对范围</span><strong>{{ testRange }}</strong></p>
    <div class="backtest-metrics">
      <div>
        <span>实际命中</span>
        <strong>{{ method.hits }}<small>/{{ result.trials }}</small></strong>
        <em>{{ formatRate(method.hits, result.trials) }}</em>
      </div>
      <div>
        <span>随机理论期望</span>
        <strong>{{ formatCount(method.expected) }}</strong>
        <em>{{ formatRate(method.expected, result.trials) }}</em>
      </div>
      <div>
        <span>最长未中</span>
        <strong>{{ method.longest.length }}<small>期</small></strong>
        <em>{{ longestText(method.longest) }}</em>
      </div>
    </div>
    <aside v-if="comparison" class="backtest-reading">
      <strong>如何读这组结果</strong>
      <p>{{ comparison.definition }}</p>
      <p>随机理论期望按每期实际注数 ÷ 全部可能号码数计算，表示同样注数随机选择时的平均命中次数；不是另一个预测算法，也不保证未来表现。</p>
      <p>本次实际命中{{ comparison.difference > 0 ? "高于" : comparison.difference < 0 ? "低于" : "与" }}随机理论期望{{ comparison.difference === 0 ? "相同" : ` ${formatCount(Math.abs(comparison.difference))} 次` }}。</p>
    </aside>
    <div v-if="bars()" class="backtest-bars" aria-hidden="true">
      <div class="backtest-bar-row"><span>实际</span><div class="backtest-track"><i class="actual" :style="{ width: `${bars().actual}%` }"></i></div><b>{{ bars().actualText }}</b></div>
      <div class="backtest-bar-row"><span>理论</span><div class="backtest-track"><i class="theory" :style="{ width: `${bars().theory}%` }"></i></div><b>{{ bars().theoryText }}</b></div>
    </div>
    <details v-if="result.points.length" class="fold backtest-detail" open><summary>命中分布与逐期详情</summary>
      <HitReport
        :points="result.points"
        :mask="method.mask"
        :longest="method.longest"
        :expected="method.expected"
        :trials="result.trials"
      />
    </details>
    <details v-if="profit" class="fold backtest-detail"><summary>盈亏测算{{ profit.kind === 'numbers' ? ` · ${profit.net > 0 ? '盈利' : profit.net < 0 ? '亏损' : '持平'} ${formatMoney(Math.abs(profit.net))} 元` : '' }}</summary>
    <p v-if="profit.kind === 'help'" class="quiet">{{ profit.text }}</p>
    <div v-else class="backtest-metrics backtest-profit">
      <div>
        <span>每期投入</span>
        <strong>{{ formatMoney(profit.stakePerDraw) }}</strong>
        <em>{{ formatBets(profit.bets) }} 注 × 2 元 × {{ profit.multiple }} 倍</em>
      </div>
      <div>
        <span>单次中奖</span>
        <strong>{{ formatMoney(profit.prizePerHit) }}</strong>
        <em>{{ formatMoney(profit.prize) }} × {{ profit.multiple }} 倍</em>
      </div>
      <div>
        <span>总投入</span>
        <strong>{{ formatMoney(profit.spent) }}</strong>
        <em>{{ formatMoney(profit.stakePerDraw) }} × {{ profit.trials }} 期</em>
      </div>
      <div>
        <span>命中收回</span>
        <strong>{{ formatMoney(profit.returned) }}</strong>
        <em>{{ formatMoney(profit.prizePerHit) }} × {{ profit.hits }} 次</em>
      </div>
      <div>
        <span>盈亏</span>
        <strong :class="profit.net < 0 ? 'loss' : 'gain'">{{ profit.net > 0 ? `赚 ${formatMoney(profit.net)}` : profit.net < 0 ? `亏 ${formatMoney(-profit.net)}` : "持平" }}</strong>
        <em>收回 − 投入</em>
      </div>
      <div>
        <span>按本次命中保本所需单倍奖金</span>
        <strong>{{ profit.breakEvenPrize === null ? "无法计算" : `${formatMoney(profit.breakEvenPrize)} 元` }}</strong>
        <em v-if="profit.breakEvenPrize !== null">不含倍数影响；回测未命中时无法反推</em>
        <em v-else>本次没有命中</em>
      </div>
    </div></details>
  </article>
</template>
