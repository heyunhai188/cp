<script setup>
defineProps({
  title: { type: String, default: "暂无数据" },
  action: { type: String, default: "" },
});
defineEmits(["retry"]);
</script>

<template>
  <section class="empty-state panel">
    <strong>{{ title }}</strong>
    <p class="quiet"><slot /></p>
    <button v-if="action" class="btn ghost small" type="button" @click="$emit('retry')">{{ action }}</button>
  </section>
</template>
