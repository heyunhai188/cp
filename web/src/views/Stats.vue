<script setup>
import { computed, onMounted, onUnmounted, ref } from "vue";
import { request } from "../api.js";
import { session } from "../session.js";
import { currentLottery, currentRange } from "../lottery.js";
import { clampN, formatElapsed, formatWhen, omissionLabel, percent } from "../format.js";
import Balls from "../components/Balls.vue";
import EmptyState from "../components/EmptyState.vue";
import KpiCard from "../components/KpiCard.vue";
import LotterySwitch from "../components/LotterySwitch.vue";
import MiniBalls from "../components/MiniBalls.vue";
import RuleEditor from "../components/RuleEditor.vue";

const presets = [30, 50, 100, 200, 500];
const lottery = ref(currentLottery());
const n = ref(currentRange());
const rangeText = ref(String(n.value));
const overview = ref(null);
const peers = ref([]);
const error = ref("");
const busy = ref(false);
const status = ref("");
const editor = ref(null);
const detail = ref({ open: false, id: null, loading: false, data: null, error: "" });

let rangeTimer = 0;
let loadAbort = null;
let detailToken = 0;

const sums = computed(() => {
  const rows = [...(overview.value?.recent || [])].reverse();
  const max = Math.max(1, ...rows.map((draw) => Number(draw.sum) || 0));
  return rows.map((draw) => ({
    issue: draw.issue,
    sum: draw.sum,
    height: `${Math.max(12, ((Number(draw.sum) || 0) / max) * 100)}%`,
  }));
});

const frequencies = computed(() => {
  const recent = overview.value?.recent || [];
  const positions = overview.value?.lottery?.positions || [];
  return positions.map((name, index) => {
    const counts = Array.from({ length: 10 }, () => 0);
    for (const draw of recent) {
      const digit = Number(draw.digits?.[index]);
      if (digit >= 0 && digit <= 9) counts[digit] += 1;
    }
    const max = Math.max(1, ...counts);
    return {
      name,
      bars: counts.map((count, digit) => ({ digit, count, width: `${(count / max) * 100}%` })),
    };
  });
});

const windowNote = computed(() => {
  const data = overview.value;
  if (!data) return "";
  if (data.drawCount && data.window < n.value) return `库里目前 ${data.drawCount} 期，这次按 ${data.window} 期统计。`;
  return `出现次数按近 ${data.window || n.value} 期，遗漏从最新一期往前看全部在库数据。`;
});

function sourceLabel(data) {
  return data.lottery.source === "sporttery" ? "中国体彩" : "中国福彩";
}

function syncLabel(data) {
  return data?.lastSync ? `${formatWhen(data.lastSync.at)} ${data.lastSync.message}` : "还没有同步过";
}

async function load() {
  loadAbort?.abort();
  const controller = new AbortController();
  loadAbort = controller;
  try {
    const data = await request(`/api/overview?n=${n.value}&lottery=${encodeURIComponent(lottery.value)}`, {
      signal: controller.signal,
    });
    if (loadAbort !== controller) return;
    overview.value = data;
    error.value = "";
    status.value = syncLabel(data);
    loadPeers();
    if (detail.value.open) openDetail(detail.value.id);
  } catch (err) {
    if (err.name === "AbortError") return;
    error.value = err.message || "读取失败";
  }
}

async function loadPeers() {
  const rows = await Promise.all(["fc3d", "pl3", "pl5"].map(async (code) => {
    try {
      const data = await request(`/api/overview?n=10&lottery=${encodeURIComponent(code)}`);
      return data.latest ? { code, name: data.lottery.name, latest: data.latest } : null;
    } catch {
      return null;
    }
  }));
  peers.value = rows.filter(Boolean);
}

function rememberRange() {
  localStorage.setItem(`range.${lottery.value}`, String(n.value));
}

function switchLottery(code) {
  if (code === lottery.value) return;
  rememberRange();
  lottery.value = code;
  n.value = currentRange(code);
  rangeText.value = String(n.value);
  localStorage.setItem("lottery.code", code);
  closeDetail();
  editor.value = null;
  load();
}

function setN(value) {
  n.value = value === "all" ? Math.max(1, overview.value?.drawCount || 500) : clampN(value);
  rangeText.value = String(n.value);
  rememberRange();
  load();
}

function onRangeInput() {
  clearTimeout(rangeTimer);
  rangeTimer = setTimeout(() => {
    const value = Number(rangeText.value);
    if (!Number.isInteger(value) || value < 1) return;
    n.value = Math.min(5000, value);
    rememberRange();
    load();
  }, 280);
}

async function runSync(mode) {
  if (busy.value || !session.user?.canOperate) return;
  busy.value = true;
  status.value = mode === "backfill" ? "正在向前补历史…" : "正在向官网拉取…";
  try {
    await request("/api/sync", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ mode, lottery: lottery.value }),
    });
    error.value = "";
    await load();
  } catch (err) {
    error.value = err.message || "同步失败";
    status.value = error.value;
  } finally {
    busy.value = false;
  }
}

function closeDetail() {
  detailToken += 1;
  detail.value = { open: false, id: null, loading: false, data: null, error: "" };
}

async function openDetail(id) {
  const token = ++detailToken;
  detail.value = { open: true, id, loading: true, data: null, error: "" };
  editor.value = null;
  try {
    const data = await request(`/api/rules/${id}/hits?n=${n.value}`);
    if (token !== detailToken) return;
    detail.value = { open: true, id, loading: false, data, error: "" };
  } catch (err) {
    if (token !== detailToken) return;
    detail.value = { open: true, id, loading: false, data: null, error: err.message || "详情读取失败" };
  }
}

function openCreate() {
  if (!overview.value) return;
  closeDetail();
  editor.value = { rule: null };
}

function openEdit(rule) {
  closeDetail();
  editor.value = { rule };
}

async function removeRule(rule) {
  if (!confirm(`删除规则「${rule.name}」？`)) return;
  try {
    await request(`/api/rules/${rule.id}`, { method: "DELETE" });
    if (String(detail.value.id) === String(rule.id)) closeDetail();
    await load();
  } catch (err) {
    error.value = err.message || "删除失败";
  }
}

function onSaved() {
  editor.value = null;
  load();
}

function onKey(event) {
  if (event.key !== "Escape") return;
  if (editor.value) editor.value = null;
  else if (detail.value.open) closeDetail();
}

onMounted(() => {
  window.addEventListener("keydown", onKey);
  load();
});
onUnmounted(() => {
  loadAbort?.abort();
  clearTimeout(rangeTimer);
  window.removeEventListener("keydown", onKey);
});
</script>

<template>
  <p v-if="error" class="banner">{{ error }}</p>
  <EmptyState v-if="!overview" :title="error ? '读取失败' : '正在读取'" :action="error ? '重试' : ''" @retry="error = ''; load()">
    {{ error || "正在读取本地开奖…" }}
  </EmptyState>
  <template v-else>
    <div class="page-tools">
      <LotterySwitch :items="overview.lotteries" :model-value="overview.lottery.code" @update:model-value="switchLottery" />
      <div class="page-tools-actions">
        <RouterLink class="btn ghost small" to="/query">开奖查询</RouterLink>
        <RouterLink class="btn ghost small" to="/predict">号码预测</RouterLink>
        <RouterLink v-if="session.user?.canPlay" class="btn gold small" to="/play">模拟投注</RouterLink>
      </div>
    </div>
    <div class="board">
      <section class="dash-card hero-dark">
        <p class="eyebrow">{{ sourceLabel(overview) }} · 最新开奖</p>
        <h1>{{ overview.lottery.name }}</h1>
        <div class="latest-row">
          <Balls :digits="overview.latest?.digits || ['·', '·', '·']" :dim="!overview.latest" />
          <span
            v-if="overview.forecastMark"
            class="forecast-mark"
            :class="overview.forecastMark"
            :aria-label="overview.forecastMark === 'hit' ? '这期预测中了' : '这期预测未中'"
          >{{ overview.forecastMark === "hit" ? "中" : "未中" }}</span>
        </div>
        <p class="latest-meta">{{ overview.latest ? `第 ${overview.latest.issue} 期 · ${overview.latest.drawDate} ${overview.latest.week}` : "还没有开奖数据" }}</p>
        <p class="latest-sub">{{ overview.latest ? `${overview.latest.parity} · ${overview.latest.size} · 和值 ${overview.latest.sum} · 跨度 ${overview.latest.span}` : "先同步近 500 期" }}</p>
      </section>
      <article class="dash-card">
        <header><b>近 {{ sums.length }} 期和值</b><span>按时间从早到晚</span></header>
        <div v-if="sums.length" class="col-chart" aria-label="近10期和值">
          <i v-for="item in sums" :key="item.issue" :style="{ height: item.height }" :title="`第 ${item.issue} 期 和值 ${item.sum}`"><em>{{ item.sum }}</em></i>
        </div>
        <p v-else class="quiet">同步后显示走势。</p>
      </article>
      <article class="dash-card">
        <header><b>三个彩种</b><span>点击切换</span></header>
        <button
          v-for="item in peers"
          :key="item.code"
          type="button"
          class="peer-row"
          :class="{ on: item.code === overview.lottery.code }"
          @click="switchLottery(item.code)"
        >
          <span class="avatar">{{ item.name.slice(0, 1) }}</span>
          <span class="peer-meta"><b>{{ item.name }}</b><small>第 {{ item.latest.issue }} 期 · {{ item.latest.drawDate }}</small></span>
          <MiniBalls :digits="item.latest.digits" />
        </button>
        <p v-if="!peers.length" class="quiet">其他彩种摘要暂时没有读到。</p>
      </article>
      <article class="dash-card board-kpis">
        <div class="kpi-row">
          <KpiCard label="本地期数" :value="overview.drawCount" />
          <KpiCard label="官网期数" :value="overview.remoteTotal || '—'" />
          <KpiCard label="统计窗口" :value="overview.window" hint="期" />
          <KpiCard label="规则" :value="overview.rules.length" />
        </div>
      </article>
    </div>
    <section class="dash-card board-wide">
      <div class="section-head">
        <div>
          <h2>近 {{ overview.recent.length }} 期</h2>
          <p class="quiet">号码按位置展示。频次只统计这 {{ overview.recent.length }} 期，不是预测。</p>
        </div>
      </div>
      <div v-if="overview.recent.length" class="table-wrap">
        <table class="data-table">
          <thead>
            <tr><th>期号</th><th>日期</th><th>号码</th><th>单双</th><th>和值</th><th>跨度</th></tr>
          </thead>
          <tbody>
            <tr v-for="draw in overview.recent" :key="draw.issue">
              <td>{{ draw.issue }}</td>
              <td>{{ draw.drawDate }}</td>
              <td><MiniBalls :digits="draw.digits" /></td>
              <td>{{ draw.parity }}</td>
              <td>{{ draw.sum }}</td>
              <td>{{ draw.span }}</td>
            </tr>
          </tbody>
        </table>
      </div>
      <p v-else class="quiet">同步后显示在这里。</p>
      <div v-if="frequencies.length" class="freq-grid" style="margin-top: 12px">
        <article v-for="position in frequencies" :key="position.name" class="freq-card">
          <h3>{{ position.name }} · 近 {{ overview.recent.length }} 期出现次数</h3>
          <div v-for="bar in position.bars" :key="bar.digit" class="freq-row">
            <span>{{ bar.digit }}</span>
            <span class="freq-track"><i :style="{ width: bar.width }"></i></span>
            <span>{{ bar.count }}</span>
          </div>
        </article>
      </div>
    </section>
    <section class="dash-card board-wide">
      <h2>数据同步</h2>
      <p class="quiet">{{ windowNote }} 统计用了 {{ formatElapsed(overview.elapsedMs) }}。{{ status }}</p>
      <div class="range-row">
        <span>近</span>
        <input v-model="rangeText" inputmode="numeric" aria-label="统计期数" @input="onRangeInput" />
        <span>期</span>
      </div>
      <div class="presets">
        <button v-for="value in presets" :key="value" class="btn ghost small" type="button" @click="setN(value)">{{ value }}</button>
        <button class="btn ghost small" type="button" @click="setN('all')">全部</button>
      </div>
      <div v-if="session.user?.canOperate" class="actions">
        <button class="btn gold" type="button" :disabled="busy" @click="runSync('auto')">{{ overview.drawCount ? "同步最新" : "获取近 500 期" }}</button>
        <button class="btn ghost" type="button" :disabled="busy || !overview.drawCount" @click="runSync('backfill')">向前补 500 期</button>
      </div>
      <p v-else class="quiet">同步由可操作的账号执行。</p>
    </section>
    <section class="board-wide">
      <div class="section-head">
        <div>
          <h2>规则统计</h2>
          <p class="quiet">次数只看当前窗口。遗漏从最新一期往前看全部在库数据。</p>
        </div>
        <button v-if="session.user?.canOperate" class="btn gold small" type="button" @click="openCreate">新建规则</button>
      </div>
      <div class="cards">
        <article v-for="rule in overview.rules" :key="rule.id" class="card" :class="{ active: String(detail.id) === String(rule.id) }">
          <div class="card-head">
            <h3>{{ rule.name }}</h3>
            <div v-if="session.user?.canOperate">
              <button class="text-btn" type="button" @click="openEdit(rule)">编辑</button>
              <button class="text-btn" type="button" @click="removeRule(rule)">删除</button>
            </div>
          </div>
          <p class="summary">{{ rule.summary }}</p>
          <div class="metric"><span class="hits">{{ rule.hits }}</span><span class="quiet">/ {{ overview.window }} 期 · {{ percent(rule.ratio) }}</span></div>
          <div v-if="rule.strip?.length" class="strip" aria-hidden="true">
            <i v-for="(flag, index) in rule.strip" :key="index" :class="{ on: flag }" :title="`${rule.stripIssues?.[index] || ''} ${flag ? '命中' : '未中'}`"></i>
          </div>
          <div v-if="rule.strip?.length" class="strip-label"><span>较早</span><span>最新</span></div>
          <div class="card-foot">
            <span class="pill" :class="omissionLabel(rule.omission).kind">{{ omissionLabel(rule.omission).text }}</span>
            <button class="btn gold small" type="button" @click="openDetail(rule.id)">详情</button>
          </div>
        </article>
      </div>
    </section>
  </template>

  <RuleEditor
    v-if="editor && overview"
    :lottery="overview.lottery"
    :rule="editor.rule"
    @close="editor = null"
    @saved="onSaved"
  />

  <div v-if="detail.open" class="overlay">
    <div class="scrim" @click="closeDetail"></div>
    <section class="drawer-panel" role="dialog" aria-modal="true" aria-label="规则详情">
      <div class="drawer-head">
        <div>
          <h2>{{ detail.data?.name || "详情" }}</h2>
          <p v-if="detail.data" class="quiet">{{ detail.data.summary }}</p>
        </div>
        <button class="text-btn" type="button" @click="closeDetail">关闭</button>
      </div>
      <p v-if="detail.loading">正在列出命中的期…</p>
      <p v-else-if="detail.error">{{ detail.error }}</p>
      <template v-else-if="detail.data">
        <p>
          近 {{ detail.data.window }} 期命中 {{ detail.data.hits }} 次，占 {{ percent(detail.data.ratio) }}。
          <span class="pill" :class="omissionLabel(detail.data.omission).kind">{{ omissionLabel(detail.data.omission).text }}</span>
        </p>
        <div class="drawer-body">
          <table>
            <thead>
              <tr><th>期号</th><th>日期</th><th>号码</th><th>单双</th><th>大小</th><th>和值</th><th>跨度</th></tr>
            </thead>
            <tbody>
              <tr v-if="!detail.data.rows.length"><td colspan="7">这近 {{ detail.data.window }} 期没有开出。</td></tr>
              <tr v-for="row in detail.data.rows" :key="row.issue">
                <td>{{ row.issue }}</td>
                <td>{{ row.drawDate }} {{ row.week }}</td>
                <td><MiniBalls :digits="row.digits" /></td>
                <td>{{ row.parity }}</td>
                <td>{{ row.size }}</td>
                <td>{{ row.sum }}</td>
                <td>{{ row.span }}</td>
              </tr>
            </tbody>
          </table>
        </div>
      </template>
    </section>
  </div>
</template>
