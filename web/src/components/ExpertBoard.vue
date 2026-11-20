<script setup>
import { computed, ref, watch } from "vue";

const props = defineProps({
  lottery: { type: Object, default: null },
  experts: { type: Object, default: null },
  canEdit: { type: Boolean, default: false },
  saving: { type: Boolean, default: false },
  windowValue: { type: String, default: "100" },
});
const emit = defineEmits(["save", "window"]);

const windows = [
  { value: "30", label: "近 30 期" },
  { value: "50", label: "近 50 期" },
  { value: "100", label: "近 100 期" },
  { value: "all", label: "全部" },
];
const directs = ref([]);
const compoundOn = ref(false);
const compound = ref([]);

const digits = computed(() => props.lottery?.digits || 0);
const positions = computed(() => props.lottery?.positions || []);

watch(() => [props.experts?.mine, props.lottery?.code], () => {
  const mine = props.experts?.mine;
  directs.value = (mine?.directs || []).map((line) => line.slice());
  compoundOn.value = Boolean(mine?.compound);
  compound.value = positions.value.map((_, index) => (mine?.compound?.positions?.[index]?.digits || []).slice());
}, { immediate: true });

function rateText(rate) {
  if (!rate?.graded) return "暂无";
  return `${rate.hits}/${rate.graded}（${(rate.ratio * 100).toFixed(1)}%）`;
}

function directText(list) {
  return (list || []).map((line) => line.join("")).join("、") || "无";
}

function compoundText(group) {
  if (!group?.positions?.length) return "无";
  return group.positions.map((position) => `${position.name} ${position.digits.join("")}`).join(" / ");
}

function addDirect() {
  if (directs.value.length >= 8) return;
  directs.value.push(Array(digits.value).fill(null));
}

function setDirect(line, index, digit) {
  directs.value[line][index] = digit;
}

function toggleCompound(index, digit) {
  const bag = compound.value[index] || [];
  compound.value[index] = bag.includes(digit) ? bag.filter((item) => item !== digit) : [...bag, digit].sort((left, right) => left - right);
}

function submit() {
  const ready = directs.value.filter((line) => line.every((digit) => digit !== null && digit !== undefined));
  if (ready.length !== directs.value.length) return;
  emit("save", {
    directs: ready,
    compound: compoundOn.value ? compound.value : null,
  });
}

const formReady = computed(() => {
  const linesReady = directs.value.every((line) => line.every((digit) => Number.isInteger(digit)));
  const compoundReady = !compoundOn.value || compound.value.every((bag) => bag.length > 0);
  return linesReady && compoundReady && (directs.value.length > 0 || compoundOn.value);
});
</script>

<template>
  <section class="panel expert-board">
    <div class="admin-section-head">
      <div>
        <h2>专家推荐</h2>
        <p class="quiet">本期号码按中奖率从高到低。中奖率默认看该专家最近 100 期已开奖的推荐，直选对上或复式包住都算中。没推荐的期不计入。</p>
      </div>
    </div>
    <div class="presets">
      <button v-for="item in windows" :key="item.value" class="btn ghost small" type="button" :class="{ on: windowValue === item.value }" @click="emit('window', item.value)">{{ item.label }}</button>
    </div>

    <article v-if="canEdit && lottery" class="expert-editor">
      <h3>我的本期推荐</h3>
      <p class="quiet">对应最新开奖的下一期。开出前可以修改，也可以清空表示这期不推荐。</p>
      <div v-for="(line, lineIndex) in directs" :key="lineIndex" class="expert-line">
        <div class="expert-line-head"><strong>直选 {{ lineIndex + 1 }}</strong><button class="text-btn" type="button" @click="directs.splice(lineIndex, 1)">移除</button></div>
        <div v-for="(position, index) in positions" :key="position" class="expert-position">
          <span>{{ position }}</span>
          <div class="expert-digits">
            <button v-for="digit in 10" :key="digit" type="button" class="num" :class="{ on: line[index] === digit - 1 }" @click="setDirect(lineIndex, index, digit - 1)">{{ digit - 1 }}</button>
          </div>
        </div>
      </div>
      <button class="btn ghost small" type="button" :disabled="directs.length >= 8" @click="addDirect">加一注直选</button>
      <label class="check"><input v-model="compoundOn" type="checkbox" /> 同时推荐一注复式</label>
      <div v-if="compoundOn">
        <div v-for="(position, index) in positions" :key="`compound-${position}`" class="expert-position">
          <span>{{ position }}</span>
          <div class="expert-digits">
            <button v-for="digit in 10" :key="digit" type="button" class="num" :class="{ on: compound[index]?.includes(digit - 1) }" @click="toggleCompound(index, digit - 1)">{{ digit - 1 }}</button>
          </div>
        </div>
        <p class="quiet">复式 {{ compound.reduce((total, bag) => total * (bag.length || 0), compound.length ? 1 : 0) || 0 }} 注</p>
      </div>
      <div class="expert-actions">
        <button class="btn gold" type="button" :disabled="saving || !formReady" @click="submit">{{ saving ? "保存中…" : "保存本期推荐" }}</button>
        <button class="btn ghost" type="button" :disabled="saving" @click="emit('save', { clear: true })">本期不推荐</button>
      </div>
    </article>

    <p v-if="!experts?.current?.length" class="quiet">这期还没有专家推荐。</p>
    <article v-for="item in experts?.current || []" :key="item.userId" class="expert-card">
      <header><strong>{{ item.username }}</strong><span>{{ rateText(item.rate) }}</span></header>
      <p>直选 {{ directText(item.directs) }}</p>
      <p class="quiet">复式 {{ compoundText(item.compound) }}</p>
    </article>

    <details class="fold">
      <summary>推荐记录 · {{ experts?.history?.length || 0 }} 期</summary>
      <p v-if="!experts?.history?.length" class="quiet">这个窗口里还没有已开奖的推荐。</p>
      <article v-for="(item, index) in experts?.history || []" :key="`${item.userId}-${item.resultIssue}-${index}`" class="expert-card">
        <header><strong>{{ item.username }}</strong><b :class="{ hit: item.hit }">{{ item.hit ? "中" : "未中" }}</b></header>
        <p>第 {{ item.resultIssue }} 期 {{ item.resultDigits.join("") }}</p>
        <p class="quiet">直选 {{ directText(item.directs) }} · 复式 {{ compoundText(item.compound) }}</p>
      </article>
    </details>
  </section>
</template>
