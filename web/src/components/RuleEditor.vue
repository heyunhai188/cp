<script setup>
import { computed, onMounted, onUnmounted, reactive, watch } from "vue";
import { request } from "../api.js";
import { createForm, toDefinition, toggleMulti, toggleOne } from "../ruleForm.js";

const props = defineProps({
  lottery: { type: Object, required: true },
  rule: { type: Object, default: null },
});
const emit = defineEmits(["close", "saved"]);

const form = reactive(createForm(props.lottery, props.rule));
const preview = reactive({ summary: "还没有条件", empty: true, error: "" });
const saving = reactive({ on: false });
const counts = computed(() => Array.from({ length: props.lottery.digits + 1 }, (_, index) => index));
const digits = [0, 1, 2, 3, 4, 5, 6, 7, 8, 9];

let timer = 0;
let abort = null;

function schedule() {
  clearTimeout(timer);
  timer = setTimeout(runPreview, 160);
}

async function runPreview() {
  abort?.abort();
  const controller = new AbortController();
  abort = controller;
  try {
    const data = await request("/api/rules/preview", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        definition: toDefinition(form),
        name: form.name,
        lottery: props.lottery.code,
      }),
      signal: controller.signal,
    });
    preview.summary = data.summary;
    preview.empty = Boolean(data.empty || data.error);
    preview.error = data.error || "";
  } catch (error) {
    if (error.name === "AbortError") return;
  }
}

async function save() {
  if (preview.empty || saving.on) return;
  saving.on = true;
  try {
    const id = props.rule?.id;
    await request(id ? `/api/rules/${id}` : "/api/rules", {
      method: id ? "PUT" : "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        name: form.name,
        definition: toDefinition(form),
        lottery: props.lottery.code,
      }),
    });
    emit("saved");
  } catch (error) {
    preview.error = error.message;
    saving.on = false;
  }
}

function onKey(event) {
  if (event.key === "Escape") emit("close");
}

watch(form, schedule, { deep: true });
onMounted(() => window.addEventListener("keydown", onKey));
onUnmounted(() => {
  clearTimeout(timer);
  abort?.abort();
  window.removeEventListener("keydown", onKey);
});
</script>

<template>
  <div class="overlay">
    <div class="scrim" @click="emit('close')"></div>
    <section class="modal-panel" role="dialog" aria-modal="true" aria-labelledby="editor-title">
      <div class="modal-head">
        <h2 id="editor-title">{{ rule ? "编辑规则" : "新建规则" }}</h2>
        <button class="text-btn" type="button" @click="emit('close')">关闭</button>
      </div>
      <label class="field-label" for="rule-name">名称，留空就用条件说明</label>
      <input id="rule-name" v-model="form.name" type="text" maxlength="40" autocomplete="off" />
      <p class="preview">{{ preview.summary }}</p>
      <section class="block">
        <h3>位置</h3>
        <div class="positions">
          <section v-for="(position, index) in form.positions" :key="index" class="pos">
            <h3>{{ lottery.positions[index] }}</h3>
            <p class="field-label">单双</p>
            <div class="chip-row">
              <button type="button" class="chip" :class="{ on: position.parity === 'odd' }" @click="position.parity = toggleOne(position.parity, 'odd')">单</button>
              <button type="button" class="chip" :class="{ on: position.parity === 'even' }" @click="position.parity = toggleOne(position.parity, 'even')">双</button>
            </div>
            <p class="field-label">大小</p>
            <div class="chip-row">
              <button type="button" class="chip" :class="{ on: position.size === 'big' }" @click="position.size = toggleOne(position.size, 'big')">大</button>
              <button type="button" class="chip" :class="{ on: position.size === 'small' }" @click="position.size = toggleOne(position.size, 'small')">小</button>
            </div>
            <p class="field-label">质合</p>
            <div class="chip-row">
              <button type="button" class="chip" :class="{ on: position.prime === 'prime' }" @click="position.prime = toggleOne(position.prime, 'prime')">质</button>
              <button type="button" class="chip" :class="{ on: position.prime === 'composite' }" @click="position.prime = toggleOne(position.prime, 'composite')">合</button>
            </div>
            <p class="field-label">012路</p>
            <div class="chip-row">
              <button v-for="road in ['0', '1', '2']" :key="road" type="button" class="chip" :class="{ on: position.road === road }" @click="position.road = toggleOne(position.road, road)">{{ road }}</button>
            </div>
            <p class="field-label">指定数字</p>
            <div class="chip-row">
              <button v-for="digit in digits" :key="digit" type="button" class="chip" :class="{ on: position.digits.includes(String(digit)) }" @click="position.digits = toggleMulti(position.digits, digit)">{{ digit }}</button>
            </div>
          </section>
        </div>
        <p class="hint">小是 0–4，大是 5–9。质数按 1、2、3、5、7。路是号码除以 3 的余数。同一位置里的条件要同时满足。</p>
      </section>
      <section class="block">
        <h3>和值与跨度</h3>
        <div class="pair">
          <label>和值最小<input v-model="form.sumMin" type="number" min="0" :max="lottery.sumMax" placeholder="0" /></label>
          <label>和值最大<input v-model="form.sumMax" type="number" min="0" :max="lottery.sumMax" :placeholder="String(lottery.sumMax)" /></label>
        </div>
        <p class="field-label">和值单双</p>
        <div class="chip-row">
          <button type="button" class="chip" :class="{ on: form.sumParity === 'odd' }" @click="form.sumParity = toggleOne(form.sumParity, 'odd')">单</button>
          <button type="button" class="chip" :class="{ on: form.sumParity === 'even' }" @click="form.sumParity = toggleOne(form.sumParity, 'even')">双</button>
        </div>
        <p class="field-label">和值大小</p>
        <div class="chip-row">
          <button type="button" class="chip" :class="{ on: form.sumSize === 'big' }" @click="form.sumSize = toggleOne(form.sumSize, 'big')">大</button>
          <button type="button" class="chip" :class="{ on: form.sumSize === 'small' }" @click="form.sumSize = toggleOne(form.sumSize, 'small')">小</button>
        </div>
        <div class="pair">
          <label>跨度最小<input v-model="form.spanMin" type="number" min="0" max="9" placeholder="0" /></label>
          <label>跨度最大<input v-model="form.spanMax" type="number" min="0" max="9" placeholder="9" /></label>
        </div>
        <p class="field-label">跨度单双</p>
        <div class="chip-row">
          <button type="button" class="chip" :class="{ on: form.spanParity === 'odd' }" @click="form.spanParity = toggleOne(form.spanParity, 'odd')">单</button>
          <button type="button" class="chip" :class="{ on: form.spanParity === 'even' }" @click="form.spanParity = toggleOne(form.spanParity, 'even')">双</button>
        </div>
        <p class="hint">和值小是 0–{{ lottery.sumBigMin - 1 }}，大是 {{ lottery.sumBigMin }}–{{ lottery.sumMax }}。跨度是这几位里的最大数减最小数。</p>
      </section>
      <section v-if="lottery.shapes" class="block">
        <h3>形态与个数</h3>
        <div class="chip-row">
          <button type="button" class="chip" :class="{ on: form.shape === '' }" @click="form.shape = ''">不限</button>
          <button type="button" class="chip" :class="{ on: form.shape === 'leopard' }" @click="form.shape = toggleOne(form.shape, 'leopard')">豹子</button>
          <button type="button" class="chip" :class="{ on: form.shape === 'group3' }" @click="form.shape = toggleOne(form.shape, 'group3')">组三</button>
          <button type="button" class="chip" :class="{ on: form.shape === 'group6' }" @click="form.shape = toggleOne(form.shape, 'group6')">组六</button>
          <button type="button" class="chip" :class="{ on: form.shape === 'straight' }" @click="form.shape = toggleOne(form.shape, 'straight')">顺子</button>
        </div>
        <div class="pair">
          <label>奇数个数
            <select v-model="form.oddCount">
              <option value="">不限</option>
              <option v-for="count in counts" :key="count" :value="String(count)">{{ count }} 个</option>
            </select>
          </label>
          <label>大数个数
            <select v-model="form.bigCount">
              <option value="">不限</option>
              <option v-for="count in counts" :key="`big-${count}`" :value="String(count)">{{ count }} 个</option>
            </select>
          </label>
        </div>
        <p class="hint">豹子是三位相同，组三是只有两位相同，组六是三位都不同。顺子按从小到大连续，另外算上 890，不算 901。组六里不想要连号时，把下面的连号选成「无」。</p>
      </section>
      <section v-else class="block">
        <h3>个数</h3>
        <div class="pair">
          <label>奇数个数
            <select v-model="form.oddCount">
              <option value="">不限</option>
              <option v-for="count in counts" :key="count" :value="String(count)">{{ count }} 个</option>
            </select>
          </label>
          <label>大数个数
            <select v-model="form.bigCount">
              <option value="">不限</option>
              <option v-for="count in counts" :key="`big-${count}`" :value="String(count)">{{ count }} 个</option>
            </select>
          </label>
        </div>
        <p class="hint">豹子、组三、组六、顺子只用于三位号码。排列五用位置、个数和连号来配。</p>
      </section>
      <section class="block">
        <h3>包含、排除、连号</h3>
        <p class="field-label">必须包含</p>
        <div class="chip-row">
          <button v-for="digit in digits" :key="`in-${digit}`" type="button" class="chip" :class="{ on: form.contains.includes(String(digit)) }" @click="form.contains = toggleMulti(form.contains, digit)">{{ digit }}</button>
        </div>
        <p class="field-label">不能包含</p>
        <div class="chip-row">
          <button v-for="digit in digits" :key="`out-${digit}`" type="button" class="chip" :class="{ on: form.excludes.includes(String(digit)) }" @click="form.excludes = toggleMulti(form.excludes, digit)">{{ digit }}</button>
        </div>
        <p class="field-label">连号</p>
        <div class="chip-row">
          <button type="button" class="chip" :class="{ on: form.consecutive === '' }" @click="form.consecutive = ''">不限</button>
          <button type="button" class="chip" :class="{ on: form.consecutive === 'yes' }" @click="form.consecutive = toggleOne(form.consecutive, 'yes')">有</button>
          <button type="button" class="chip" :class="{ on: form.consecutive === 'no' }" @click="form.consecutive = toggleOne(form.consecutive, 'no')">无</button>
        </div>
        <p class="hint">有连号指任意两个数字相差 1。0 和 9 不算连号。所有选中的条件要同时满足才算命中。</p>
      </section>
      <p class="form-error">{{ preview.error }}</p>
      <div class="modal-foot">
        <button class="btn ghost" type="button" @click="emit('close')">取消</button>
        <button class="btn gold" type="button" :disabled="preview.empty || saving.on" @click="save">保存</button>
      </div>
    </section>
  </div>
</template>
