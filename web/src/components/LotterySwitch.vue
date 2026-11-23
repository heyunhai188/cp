<script setup>
defineProps({
  items: { type: Array, required: true },
  modelValue: { type: String, required: true },
});
defineEmits(["update:modelValue"]);
</script>

<template>
  <div class="lottery-switch" role="group" aria-label="彩种">
    <button
      v-for="item in items"
      :key="item.code"
      type="button"
      class="btn ghost small"
      :class="{ on: item.code === modelValue }"
      :aria-pressed="item.code === modelValue"
      @click="$emit('update:modelValue', item.code)"
    >{{ item.name }}</button>
  </div>
</template>
