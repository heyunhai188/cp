<script setup>
import { computed, onMounted, onUnmounted, ref } from "vue";
import { request } from "../api.js";
import { session } from "../session.js";
import { currentLottery, currentRange } from "../lottery.js";
import { clampN, formatElapsed, formatWhen, omissionLabel, percent } from "../format.js";
import Balls from "../components/Balls.vue";
import MiniBalls from "../components/MiniBalls.vue";
import RuleEditor from "../components/RuleEditor.vue";

const presets = [30, 50, 100, 200, 500];
const lottery = ref(currentLottery());
const n = ref(currentRange());
const rangeText = ref(String(n.value));
const overview = ref(null);
const error = ref("");
const busy = ref(false);
const status = ref("");
const editor = ref(null);
const detail = ref({ open: false, id: null, loading: false, data: null, error: "" });

let rangeTimer = 0;
let loadAbort = null;
let detailToken = 0;

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
    if (detail.value.open) openDetail(detail.value.id);
  } catch (err) {
    if (err.name === "AbortError") return;
    error.value = err.message || "读取失败";
  }
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
  <section v-if="!overview" class="panel empty">
    <p>{{ error || "正在读取本地数据…" }}</p>
    <button v-if="error" class="btn gold" type="button" @click="error = ''; load()">重试</button>
  </section>
  <template v-else>
    <header class="ticket-hero">
      <div>
        <p class="eyebrow">{{ sourceLabel(overview) }} · 个人统计</p>
        <h1>{{ overview.lottery.name }}</h1>
        <div class="lottery-switch">
          <button
            v-for="item in overview.lotteries"
            :key="item.code"
            type="button"
            class="btn ghost small"
            :class="{ on: item.code === overview.lottery.code }"
            @click="switchLottery(item.code)"
          >{{ item.name }}</button>
          <RouterLink class="btn ghost small" :to="{ path: '/query', query: { lottery: overview.lottery.code } }">开奖查询</RouterLink>
        </div>
        <div class="latest">
          <div class="latest-row">
            <Balls :digits="overview.latest?.digits || ['·', '·', '·']" :dim="!overview.latest" />
            <span
              v-if="overview.forecastMark"
              class="forecast-mark"
              :class="overview.forecastMark"
              :aria-label="overview.forecastMark === 'hit' ? '这期预测中了' : '这期预测未中'"
            >{{ overview.forecastMark === "hit" ? "中" : "未中" }}</span>
          </div>
          <p class="latest-meta">{{ overview.latest ? `${overview.latest.issue} · ${overview.latest.drawDate} ${overview.latest.week}` : "还没有开奖数据" }}</p>
          <p class="latest-sub">{{ overview.latest ? `${overview.latest.parity} · ${overview.latest.size} · 和值 ${overview.latest.sum} · 跨度 ${overview.latest.span}` : "先同步近 500 期" }}</p>
        </div>
        <p class="quiet">本地 {{ overview.drawCount }} 期<span v-if="overview.remoteTotal">，官网 {{ overview.remoteTotal }} 期</span>。点规则详情可以看期号和号码。</p>
      </div>
    </header>
    <section>
      <div class="section-head">
        <div>
          <h2>规则</h2>
          <p class="quiet">{{ windowNote }} 统计用了 {{ formatElapsed(overview.elapsedMs) }}。</p>
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
    <details class="panel fold">
      <summary>数据 · 近 {{ n }} 期 · 本地 {{ overview.drawCount }} 期</summary>
      <div class="range-row">
        <span>近</span>
        <input v-model="rangeText" inputmode="numeric" aria-label="统计期数" @input="onRangeInput" />
        <span>期</span>
      </div>
      <div class="presets">
        <button v-for="value in presets" :key="value" class="btn ghost small" type="button" @click="setN(value)">{{ value }}</button>
        <button class="btn ghost small" type="button" @click="setN('all')">全部</button>
      </div>
      <h2>数据同步</h2>
      <div v-if="session.user?.canOperate" class="actions">
        <button class="btn gold" type="button" :disabled="busy" @click="runSync('auto')">{{ overview.drawCount ? "同步最新" : "获取近 500 期" }}</button>
        <button class="btn ghost" type="button" :disabled="busy || !overview.drawCount" @click="runSync('backfill')">向前补 500 期</button>
      </div>
      <p v-else class="quiet">同步由可操作的账号执行。</p>
      <p class="status quiet">{{ status }}</p>
      <h3>最近开奖（{{ overview.recent.length }} 期）</h3>
      <ul v-if="overview.recent.length" class="recent">
        <li v-for="draw in overview.recent" :key="draw.issue">
          <span><b>{{ draw.issue }}</b><br><span class="quiet">{{ draw.drawDate }}</span></span>
          <MiniBalls :digits="draw.digits" />
        </li>
      </ul>
      <p v-else class="quiet">同步后显示在这里。</p>
    </details>
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
