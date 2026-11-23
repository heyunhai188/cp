<script setup>
defineProps({
  digits: { type: Array, default: () => [] },
  size: { type: String, default: "md" },
  dim: Boolean,
});
</script>

<template>
  <span class="balls" :class="[size, { wide: digits.length > 3, dim }]">
    <span v-for="(digit, index) in digits" :key="index" class="ball">{{ digit }}</span>
  </span>
</template>
