<script setup>
import { onMounted, ref, watch } from "vue";
import { useRoute } from "vue-router";
import { request } from "../api.js";
import { LOTTERIES, currentLottery } from "../lottery.js";
import MiniBalls from "../components/MiniBalls.vue";

const route = useRoute();
const officialCodes = new Set(LOTTERIES.map((item) => item.code));
const filters = ref({
  lottery: "fc3d",
  issue: "",
  dateFrom: "",
  dateTo: "",
  number: "",
});
const savedLimit = localStorage.getItem("draws.recentLimit");
const recentLimit = ref(savedLimit === "0" ? 0 : Number(savedLimit) || 10);
const page = ref(1);
const counts = ref("");
const note = ref("");
const rows = ref([]);
const total = ref(0);
const pageSize = ref(20);
const error = ref("");
const expandedRow = ref("");

const stored = currentLottery();
const savedFilters = (() => {
  try { return JSON.parse(localStorage.getItem("draws.filters") || "null"); } catch { return null; }
})();
if (savedFilters && typeof savedFilters === "object") {
  for (const key of ["issue", "dateFrom", "dateTo", "number"]) filters.value[key] = String(savedFilters[key] || "");
}
function linkedLottery() {
  const code = String(route.query.lottery || "");
  return officialCodes.has(code) ? code : "";
}
function applyLinkedLottery() {
  const code = linkedLottery();
  if (!code) return false;
  filters.value.lottery = code;
  filters.value.issue = "";
  filters.value.dateFrom = "";
  filters.value.dateTo = "";
  filters.value.number = "";
  page.value = 1;
  expandedRow.value = "";
  return true;
}
if (!applyLinkedLottery()) {
  filters.value.lottery = officialCodes.has(savedFilters?.lottery)
    ? savedFilters.lottery
    : (officialCodes.has(stored) ? stored : "fc3d");
}

function saveFilters() {
  localStorage.setItem("draws.filters", JSON.stringify(filters.value));
  localStorage.setItem("draws.recentLimit", String(recentLimit.value));
  localStorage.setItem("lottery.code", filters.value.lottery);
}

function queryString() {
  const params = new URLSearchParams();
  for (const [key, value] of Object.entries(filters.value)) {
    if (value) params.set(key, value);
  }
  params.set("page", String(page.value));
  params.set("pageSize", String(recentLimit.value || 20));
  return params.toString();
}

async function load() {
  try {
    const data = await request(`/api/draws?${queryString()}`);
    error.value = "";
    counts.value = data.counts.map((item) => `${item.name} ${item.count} 期`).join(" · ") || "还没有开奖";
    rows.value = data.rows;
    total.value = data.total;
    pageSize.value = data.pageSize;
    page.value = data.page;
    const pages = Math.max(1, Math.ceil(data.total / data.pageSize));
    note.value = data.total
      ? recentLimit.value
        ? `显示匹配结果中最新 ${data.rows.length} 期 · 共匹配 ${data.total} 期`
        : `共 ${data.total} 期，第 ${data.page} / ${pages} 页`
      : "没有符合条件的开奖。可以先到规则统计页同步。";
  } catch (err) {
    error.value = err.message || "查询失败";
  }
}

function search() {
  page.value = 1;
  saveFilters();
  load();
}

function switchLottery(code) {
  if (!officialCodes.has(code) || code === filters.value.lottery) return;
  filters.value.lottery = code;
  page.value = 1;
  expandedRow.value = "";
  saveFilters();
  load();
}

function clearFilters() {
  filters.value.issue = "";
  filters.value.dateFrom = "";
  filters.value.dateTo = "";
  filters.value.number = "";
  page.value = 1;
  saveFilters();
  load();
}

function chooseRecent(limit) {
  recentLimit.value = limit;
  page.value = 1;
  saveFilters();
  load();
}

function goto(next) {
  page.value = next;
  load();
}

onMounted(() => {
  saveFilters();
  load();
});

watch(() => route.query.lottery, () => {
  if (!applyLinkedLottery()) return;
  saveFilters();
  load();
});
</script>

<template>
  <p v-if="error" class="banner">{{ error }}</p>
  <header class="page-hero predict-lottery">
    <p class="lede">先选彩种。展开下面的条件后，可以按期号、日期或号码查询。</p>
    <div class="lottery-switch" role="group" aria-label="彩种">
      <button
        v-for="item in LOTTERIES"
        :key="item.code"
        type="button"
        class="btn ghost small"
        :class="{ on: item.code === filters.lottery }"
        :aria-pressed="item.code === filters.lottery"
        @click="switchLottery(item.code)"
      >{{ item.name }}</button>
    </div>
  </header>
  <p class="quiet">{{ counts || "正在读取…" }}</p>
  <details class="panel fold query-options">
    <summary>筛选条件</summary>
    <form class="query-filters" @submit.prevent="search">
      <label>期号
        <input v-model="filters.issue" inputmode="numeric" placeholder="如 26300" />
      </label>
      <label>开始日期
        <input v-model="filters.dateFrom" type="date" />
      </label>
      <label>结束日期
        <input v-model="filters.dateTo" type="date" />
      </label>
      <label>号码
        <input v-model="filters.number" inputmode="numeric" placeholder="如 398 或 3 9 8" />
      </label>
      <p class="quiet">398 表示号码里连续出现 398，不是这一期正好开出 398。</p>
      <div class="query-actions">
        <button class="btn gold" type="submit">查询</button>
        <button class="btn ghost" type="button" @click="clearFilters">清空</button>
      </div>
    </form>
  </details>
  <div class="query-range" role="group" aria-label="显示最近多少期">
    <button v-for="option in [{ label: '近10期', value: 10 }, { label: '近30期', value: 30 }, { label: '近100期', value: 100 }, { label: '分页浏览', value: 0 }]" :key="option.value" type="button" class="btn ghost small" :class="{ on: recentLimit === option.value }" @click="chooseRecent(option.value)">{{ option.label }}</button>
  </div>
  <p class="quiet">{{ note }}</p>
  <section class="query-results">
    <article v-for="row in rows" :key="`${row.lotteryCode}-${row.issue}`" class="panel query-result">
      <div class="query-result-main">
        <div><strong>{{ row.lotteryName }}</strong><span class="quiet"> · {{ row.issue }}</span><p class="quiet">{{ row.drawDate }} {{ row.week }}</p></div>
        <MiniBalls :digits="row.digits" />
        <button class="text-btn" type="button" :aria-expanded="expandedRow === `${row.lotteryCode}-${row.issue}`" @click="expandedRow = expandedRow === `${row.lotteryCode}-${row.issue}` ? '' : `${row.lotteryCode}-${row.issue}`">{{ expandedRow === `${row.lotteryCode}-${row.issue}` ? "收起" : "详情" }}</button>
      </div>
      <div v-if="expandedRow === `${row.lotteryCode}-${row.issue}`" class="query-result-detail">
        <span>单双 {{ row.parity }}</span><span>大小 {{ row.size }}</span><span>和值 {{ row.sum }}</span><span>跨度 {{ row.span }}</span>
      </div>
    </article>
    <p v-if="!rows.length" class="panel quiet">暂无符合条件的开奖。</p>
  </section>
  <div v-if="!recentLimit && total > pageSize" class="pager">
    <button class="btn ghost" type="button" :disabled="page <= 1" @click="goto(page - 1)">上一页</button>
    <button class="btn ghost" type="button" :disabled="page >= Math.ceil(total / pageSize)" @click="goto(page + 1)">下一页</button>
  </div>
</template>
