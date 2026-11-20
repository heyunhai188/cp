<script setup>
import { computed, onMounted, ref, watch } from "vue";
import { useRoute, useRouter } from "vue-router";
import { request } from "../api.js";
import { session } from "../session.js";
import { LOTTERIES, currentLottery, predictRange } from "../lottery.js";
import { clampN, formatStamp } from "../format.js";
import Balls from "../components/Balls.vue";
import ExpertBoard from "../components/ExpertBoard.vue";
import SectionTabs from "../components/SectionTabs.vue";
import Backtest from "./Backtest.vue";

const SECTIONS = [
  { id: "picks", label: "本期号码" },
  { id: "experts", label: "专家推荐" },
  { id: "archive", label: "存档核对" },
  { id: "backtest", label: "向前回测" },
];

const presets = [30, 50, 100, 200, 500];
const route = useRoute();
const router = useRouter();
function knownSection(value) {
  return SECTIONS.some((item) => item.id === value) ? value : "";
}
const section = ref(knownSection(route.query.tab) || knownSection(localStorage.getItem("predict.section")) || "picks");
const lottery = ref(currentLottery());
const n = ref(predictRange());
const rangeText = ref(String(n.value));
const k = ref(localStorage.getItem(`predict.k.${lottery.value}`) || "");
const data = ref(null);
const note = ref("");
const error = ref("");
const replacing = ref(false);
const checksN = ref(Number(localStorage.getItem(`predict.checksN.${lottery.value}`)) || 30);
const expertN = ref(localStorage.getItem("predict.expertN") || "100");
const savingExpert = ref(false);
const expandedCheck = ref("");

function compoundLine(group) {
  if (!group) return "";
  return group.positions.map((position) => `${position.name} ${position.digits.join("")}`).join(" / ");
}

function remember() {
  localStorage.setItem("lottery.code", lottery.value);
  localStorage.setItem(`predict.range.${lottery.value}`, String(n.value));
}

async function load() {
  const params = new URLSearchParams({ lottery: lottery.value, n: String(n.value), checksN: String(checksN.value), expertN: expertN.value });
  if (String(k.value).trim()) params.set("k", String(k.value).trim());
  try {
    const next = await request(`/api/predict?${params}`);
    error.value = "";
    data.value = next;
    k.value = String(next.k);
    localStorage.setItem(`predict.k.${lottery.value}`, String(next.k));
    if (!next.window) {
      note.value = "还没有开奖。先到规则统计页同步近 500 期。";
      return;
    }
    const latest = next.latest;
    note.value = `${next.lottery.name} 近 ${next.window} 期。最新 ${latest.issue} ${latest.digits.join("")}。每位取 ${next.k} 个号。`;
  } catch (err) {
    error.value = err.message || "预测失败";
  }
}

function switchLottery(code) {
  if (code === lottery.value) return;
  remember();
  lottery.value = code;
  n.value = predictRange(code);
  rangeText.value = String(n.value);
  k.value = localStorage.getItem(`predict.k.${code}`) || "";
  localStorage.setItem("lottery.code", code);
  load();
}

function setN(value) {
  n.value = clampN(value);
  rangeText.value = String(n.value);
  remember();
  load();
}

function commitRange() {
  n.value = clampN(rangeText.value);
  rangeText.value = String(n.value);
  remember();
  load();
}

const archiveView = () => {
  const current = data.value;
  const archive = current?.archive;
  const saved = archive?.payload;
  if (!current || !archive || !saved) return null;
  const liveKey = (current.joint?.directs || []).map((item) => item.digits.join("")).join("|");
  const savedKey = (saved.jointDirects || []).map((item) => item.digits.join("")).join("|");
  return {
    archive,
    saved,
    differs: archive.n !== current.n || archive.k !== current.k || liveKey !== savedKey,
  };
};
// 固定一次存档快照，避免模板重复调用时请求状态更新造成空值读取。
const currentArchive = computed(archiveView);

function drawnChecks() {
  return (data.value?.checks || []).filter((item) => item.status === "drawn");
}

function setChecksN(value) {
  checksN.value = Number(value) || 30;
  localStorage.setItem(`predict.checksN.${lottery.value}`, String(checksN.value));
  expandedCheck.value = "";
  load();
}

function setExpertN(value) {
  expertN.value = value;
  localStorage.setItem("predict.expertN", value);
  load();
}

async function saveExpert(payload) {
  if (!session.user?.canRecommend || savingExpert.value) return;
  savingExpert.value = true;
  try {
    await request("/api/expert-picks", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ lottery: lottery.value, ...payload }),
    });
    await load();
  } catch (err) {
    error.value = err.message || "推荐保存失败";
  } finally {
    savingExpert.value = false;
  }
}

function rate(pick) {
  const drawn = drawnChecks();
  const hits = drawn.filter(pick).length;
  return drawn.length ? `${hits}/${drawn.length}` : "还没有";
}

async function replaceForecast() {
  if (!session.user?.canOperate || replacing.value) return;
  replacing.value = true;
  try {
    await request("/api/forecasts", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        lottery: lottery.value,
        n: n.value,
        k: String(k.value).trim(),
      }),
    });
    await load();
  } catch (err) {
    error.value = err.message || "保存失败";
  } finally {
    replacing.value = false;
  }
}

onMounted(load);

watch(() => route.query.tab, (value) => {
  const next = knownSection(value);
  if (next) section.value = next;
});

function setSection(id) {
  section.value = id;
  localStorage.setItem("predict.section", id);
  const query = id === "picks" ? {} : { tab: id };
  if ((route.query.tab || "") !== (query.tab || "")) router.replace({ path: "/predict", query });
}
</script>

<template>
  <p v-if="error && section !== 'backtest'" class="banner">{{ error }}</p>
  <SectionTabs :tabs="SECTIONS" :model-value="section" @update:model-value="setSection" />
  <template v-if="section === 'picks'">
  <header class="page-hero">
    <p class="lede">近 {{ n }} 期加权排序 · 每位 {{ k || "默认" }} 个。历史排序仅供参考，不代表提高中奖概率。</p>
    <div class="lottery-switch">
      <button
        v-for="item in LOTTERIES"
        :key="item.code"
        type="button"
        class="btn ghost small"
        :class="{ on: item.code === lottery }"
        @click="switchLottery(item.code)"
      >{{ item.name }}</button>
    </div>
  </header>
  <section class="panel predict-controls">
    <details class="fold predict-options"><summary>设置 · 近 {{ n }} 期 · 每位 {{ k || "默认" }} 个</summary>
    <div class="range-row"><span>近</span><input v-model="rangeText" inputmode="numeric" aria-label="统计期数" @change="commitRange" /><span>期</span></div>
    <div class="presets">
      <button v-for="value in presets" :key="value" class="btn ghost small" type="button" @click="setN(value)">{{ value }}</button>
    </div>
    <p class="quiet">默认 100 期。只使用这个窗口，之后再同步的更早开奖不会改变预测号码。</p>
    <div class="range-row">
      <span>每位</span>
      <input v-model="k" inputmode="numeric" aria-label="每位取号个数" @change="load" />
      <span>个号，最多 5 个</span>
    </div>
    </details>
  </section>
  <p class="quiet">{{ note }}</p>
  <template v-if="data?.window">
    <section class="predict-block">
      <h2>复式推荐</h2>
      <article v-if="data.joint?.compound" class="panel compound-pick">
        <h2>综合复式 · {{ data.joint.compound.bets }} 注</h2>
        <p class="compound">{{ compoundLine(data.joint.compound) }}</p>
      </article>
      <div class="predict-compounds">
        <article v-if="data.hotCompound" class="panel"><h3>热号复式 · {{ data.hotCompound.bets }} 注</h3><p class="compound">{{ compoundLine(data.hotCompound) }}</p></article>
        <article v-if="data.coldCompound" class="panel"><h3>冷号复式 · {{ data.coldCompound.bets }} 注</h3><p class="compound">{{ compoundLine(data.coldCompound) }}</p></article>
      </div>
    </section>
    <section class="predict-block">
      <h2>直选结果</h2>
      <p class="hint">综合直选与冷热直选。号码为历史排序结果，不代表提高中奖概率。</p>
      <div class="predict-tickets">
        <article v-for="item in data.joint?.directs || []" :key="item.name + item.digits.join('')" class="panel predict-ticket"><h2>{{ item.name }}</h2><Balls :digits="item.digits" /><p class="quiet">{{ item.parity }} · 和值 {{ item.sum }} · 跨度 {{ item.span }}<template v-if="item.seen"> · 近窗出现过</template></p></article>
        <article v-for="item in data.directs || []" :key="`hot-${item.name}`" class="panel predict-ticket"><h2>冷热 · {{ item.name }}</h2><Balls :digits="item.digits" /><p class="quiet">{{ item.digits.join("") }}</p></article>
      </div>
    </section>
    <details class="panel fold predict-block">
      <summary>冷热对照与位置统计</summary>
      <h2>冷热对照</h2>
      <p class="hint">只按单个位置的冷热来组，不看整注形态。</p>
      <div class="predict-tickets">
        <article v-for="item in data.directs" :key="item.name" class="panel predict-ticket">
          <h2>{{ item.name }}</h2>
          <Balls :digits="item.digits" />
          <p class="quiet">{{ item.digits.join("") }}</p>
        </article>
      </div>
    </details>
    <details class="panel fold predict-block">
      <summary>每个位置的冷热频次</summary>
      <div class="predict-ranks">
        <section v-for="position in data.positions" :key="position.name" class="panel">
          <h2>{{ position.name }}</h2>
          <table>
            <thead>
              <tr><th>号码</th><th>近 {{ data.window }} 期</th><th>当前遗漏</th><th>热号</th><th>冷号</th></tr>
            </thead>
            <tbody>
              <tr v-for="item in position.digits" :key="item.digit">
                <td>{{ item.digit }}</td>
                <td>{{ item.count }}</td>
                <td>{{ item.omission === null ? "未出现" : item.omission }}</td>
                <td>{{ item.hotRank <= data.k ? "取" : "" }}</td>
                <td>{{ item.coldRank <= data.k ? "取" : "" }}</td>
              </tr>
            </tbody>
          </table>
        </section>
      </div>
    </details>
  </template>
  </template>

  <ExpertBoard
    v-else-if="section === 'experts'"
    :lottery="data?.lottery"
    :experts="data?.experts"
    :can-edit="Boolean(session.user?.canRecommend && data?.latest)"
    :saving="savingExpert"
    :window-value="expertN"
    @window="setExpertN"
    @save="saveExpert"
  />

  <template v-else-if="section === 'archive'">
    <section v-if="currentArchive" class="panel archive-card">
      <h2>本期存档 · {{ currentArchive.archive.basedIssue }} 期后</h2>
      <p>依据 {{ currentArchive.archive.basedIssue }} 预测下一期。近 {{ currentArchive.archive.n }} 期，每位 {{ currentArchive.archive.k }} 个号。保存于 {{ formatStamp(currentArchive.archive.createdAt) }}。开出下一期并同步后，这份就不能再改。</p>
      <p class="compound">综合直选 {{ (currentArchive.saved.jointDirects || []).map((item) => item.digits.join("")).join("、") }}</p>
      <p class="compound">{{ compoundLine(currentArchive.saved.jointCompound) }}</p>
      <p class="quiet">热号直选 {{ (currentArchive.saved.hotDirects || []).map((item) => `${item.name} ${item.digits.join("")}`).join("、") }}</p>
      <p v-if="currentArchive.differs && session.user?.canOperate" class="hint">当前页面和存档不一致。覆盖后，今晚核对按现在这份。</p>
      <button v-if="session.user?.canOperate" class="btn gold" type="button" :disabled="replacing" @click="replaceForecast">用当前预测覆盖</button>
    </section>
    <p v-else class="quiet">还没有本期存档。</p>
    <section v-if="drawnChecks().length" class="panel predict-block">
      <h2>开奖核对 · 综合直选 {{ rate((item) => item.grade.jointDirects.length) }} · 综合复式 {{ rate((item) => item.grade.jointCompound) }}</h2>
      <p class="hint">综合直选 {{ rate((item) => item.grade.jointDirects.length) }} · 综合复式 {{ rate((item) => item.grade.jointCompound) }} · 冷热直选 {{ rate((item) => item.grade.hotDirects.length) }} · 热号复式 {{ rate((item) => item.grade.hotCompound) }} · 冷号复式 {{ rate((item) => item.grade.coldCompound) }}</p>
      <label class="check-window">核对最近
        <select :value="checksN" @change="setChecksN($event.target.value)">
          <option v-for="count in [10, 30, 50, 100, 200, 500]" :key="count" :value="count">{{ count }} 期</option>
        </select>
        <span class="quiet">（最多 {{ drawnChecks().length }} 期有开奖记录）</span>
      </label>
      <p class="quiet">表格可以左右滑动。</p>
      <div class="panel query-table">
        <table>
          <thead>
            <tr><th>依据</th><th>开奖</th><th>号码</th><th>综合直选</th><th>综合复式</th><th>冷热直选</th><th>热号复式</th><th>冷号复式</th><th>详情</th></tr>
          </thead>
          <tbody>
            <template v-for="item in drawnChecks()" :key="item.basedIssue">
              <tr>
                <td>{{ item.basedIssue }}</td>
                <td>{{ item.resultIssue }} {{ item.resultDate }}</td>
                <td>{{ item.resultDigits.join("") }}</td>
                <td><b v-if="item.grade.jointDirects.length" class="hit">中 {{ item.grade.jointDirects.join("、") }}</b><template v-else>未中</template></td>
                <td><b v-if="item.grade.jointCompound" class="hit">中</b><template v-else>未中</template></td>
                <td><b v-if="item.grade.hotDirects.length" class="hit">中 {{ item.grade.hotDirects.join("、") }}</b><template v-else>未中</template></td>
                <td><b v-if="item.grade.hotCompound" class="hit">中</b><template v-else>未中</template></td>
                <td><b v-if="item.grade.coldCompound" class="hit">中</b><template v-else>未中</template></td>
                <td><button class="text-btn" type="button" @click="expandedCheck = expandedCheck === item.basedIssue ? '' : item.basedIssue">{{ expandedCheck === item.basedIssue ? "收起" : "号码" }}</button></td>
              </tr>
              <tr v-if="expandedCheck === item.basedIssue">
                <td colspan="9"><div class="forecast-snapshot">
                  <section><b>综合复式</b><p>{{ compoundLine(item.payload.jointCompound) || "无" }} · {{ item.payload.jointCompound?.bets || 0 }} 注</p></section>
                  <section><b>热号复式</b><p>{{ compoundLine(item.payload.hotCompound) || "无" }} · {{ item.payload.hotCompound?.bets || 0 }} 注</p></section>
                  <section><b>冷号复式</b><p>{{ compoundLine(item.payload.coldCompound) || "无" }} · {{ item.payload.coldCompound?.bets || 0 }} 注</p></section>
                  <section><b>综合直选（{{ item.payload.jointDirects?.length || 0 }} 组）</b><p>{{ (item.payload.jointDirects || []).map((pick) => `${pick.name} ${pick.digits.join("")}`).join("、") || "无" }}</p></section>
                <section><b>冷热直选</b><p>{{ (item.payload.hotDirects || []).map((pick) => `${pick.name} ${pick.digits.join("")}`).join("、") || "无" }}</p></section>
              </div></td>
              </tr>
            </template>
          </tbody>
        </table>
      </div>
    </section>
    <section v-else class="panel archive-card">
      <h2>开奖核对</h2>
      <p class="quiet">还没有可核对的存档。下一期开出并点同步之后，这里会列出综合、冷热各套规则中没中。</p>
    </section>
  </template>

  <Backtest v-else-if="section === 'backtest'" embedded />
</template>
