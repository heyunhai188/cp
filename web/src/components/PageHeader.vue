<script setup>
defineProps({
  eyebrow: { type: String, default: "" },
  title: { type: String, default: "" },
  lede: { type: String, default: "" },
});
</script>

<template>
  <header class="page-hero">
    <p v-if="eyebrow" class="eyebrow">{{ eyebrow }}</p>
    <h1 v-if="title">{{ title }}</h1>
    <p v-if="lede" class="lede">{{ lede }}</p>
    <slot />
  </header>
</template>
