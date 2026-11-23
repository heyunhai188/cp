<script setup>
import { NTab, NTabs } from "naive-ui";

defineProps({
  tabs: { type: Array, required: true },
  modelValue: { type: String, required: true },
});
defineEmits(["update:modelValue"]);
</script>

<template>
  <n-tabs class="section-tabs" type="segment" :value="modelValue" @update:value="$emit('update:modelValue', $event)">
    <n-tab v-for="tab in tabs" :key="tab.id" :name="tab.id">{{ tab.label }}</n-tab>
  </n-tabs>
</template>
