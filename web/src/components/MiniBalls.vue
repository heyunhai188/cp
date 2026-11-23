<script setup>
import NumberBall from "./NumberBall.vue";

defineProps({
  digits: { type: Array, default: () => [] },
});
</script>

<template>
  <NumberBall :digits="digits" size="sm" />
</template>
