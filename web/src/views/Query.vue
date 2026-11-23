<script setup>
import { onMounted, ref } from "vue";
import { request } from "../api.js";
import { currentLottery } from "../lottery.js";
import MiniBalls from "../components/MiniBalls.vue";

const filters = ref({
  lottery: "",
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
const filtersOpen = ref(false);
const expandedRow = ref("");

const NAMES = { fc3d: "福彩3D", pl3: "排列三", pl5: "排列五", self3d: "自开3D" };
const stored = currentLottery();
const savedFilters = (() => {
  try { return JSON.parse(localStorage.getItem("draws.filters") || "null"); } catch { return null; }
})();
if (savedFilters && typeof savedFilters === "object") {
  for (const key of Object.keys(filters.value)) filters.value[key] = String(savedFilters[key] || "");
} else if (["fc3d", "pl3", "pl5"].includes(stored)) filters.value.lottery = stored;

function saveFilters() {
  localStorage.setItem("draws.filters", JSON.stringify(filters.value));
  localStorage.setItem("draws.recentLimit", String(recentLimit.value));
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

function clearFilters() {
  filters.value = { lottery: "", issue: "", dateFrom: "", dateTo: "", number: "" };
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

onMounted(load);
</script>

<template>
  <p v-if="error" class="banner">{{ error }}</p>
  <header class="page-hero">
    <p class="lede">{{ counts || "正在读取…" }}</p>
    <p class="query-current">当前：{{ filters.lottery ? (NAMES[filters.lottery] || filters.lottery) : "全部彩种" }}<span v-if="filters.issue"> · 期号含 {{ filters.issue }}</span><span v-if="filters.number"> · 号码含 {{ filters.number }}</span><span v-if="filters.dateFrom || filters.dateTo"> · {{ filters.dateFrom || "不限开始" }} 至 {{ filters.dateTo || "不限结束" }}</span></p>
    <button class="btn ghost" type="button" @click="filtersOpen = !filtersOpen">{{ filtersOpen ? "收起筛选" : "筛选" }}</button>
  </header>
  <form v-show="filtersOpen" class="panel query-filters" @submit.prevent="search">
    <label>彩种
      <select v-model="filters.lottery">
        <option value="">全部</option>
        <option value="fc3d">福彩3D</option>
        <option value="pl3">排列三</option>
        <option value="pl5">排列五</option>
        <option value="self3d">自开3D</option>
      </select>
    </label>
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
