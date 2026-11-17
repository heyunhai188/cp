<script setup>
defineProps({
  digits: { type: Array, default: () => ["·", "·", "·"] },
  dim: Boolean,
});
</script>

<template>
  <div class="balls" :class="{ wide: digits.length > 3 }">
    <span v-for="(digit, index) in digits" :key="index" class="ball" :class="{ dim }">{{ digit }}</span>
  </div>
</template>
