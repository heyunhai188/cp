<script setup>
import { dateZhCN, NConfigProvider, zhCN } from "naive-ui";
import { naiveThemeOverrides } from "./naiveTheme.js";
</script>

<template>
  <n-config-provider :locale="zhCN" :date-locale="dateZhCN" :theme-overrides="naiveThemeOverrides">
    <RouterView />
  </n-config-provider>
</template>
