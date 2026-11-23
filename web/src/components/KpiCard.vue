<script setup>
defineProps({
  label: { type: String, required: true },
  value: { type: [String, Number], default: "—" },
  hint: { type: String, default: "" },
});
</script>

<template>
  <article class="kpi-card">
    <span>{{ label }}</span>
    <strong>{{ value }}</strong>
    <small v-if="hint">{{ hint }}</small>
  </article>
</template>
