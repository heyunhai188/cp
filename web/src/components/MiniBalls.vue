<script setup>
defineProps({
  digits: { type: Array, default: () => [] },
});
</script>

<template>
  <span class="minis"><i v-for="(digit, index) in digits" :key="index">{{ digit }}</i></span>
</template>
