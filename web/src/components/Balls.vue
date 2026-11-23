<script setup>
import NumberBall from "./NumberBall.vue";

defineProps({
  digits: { type: Array, default: () => ["·", "·", "·"] },
  dim: Boolean,
});
</script>

<template>
  <NumberBall :digits="digits" :dim="dim" size="md" />
</template>
