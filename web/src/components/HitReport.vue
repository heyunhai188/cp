<script setup>
import { computed } from "vue";
import { use } from "echarts/core";
import { CanvasRenderer } from "echarts/renderers";
import { LineChart } from "echarts/charts";
import { DataZoomComponent, GridComponent, LegendComponent, MarkAreaComponent, MarkPointComponent, TooltipComponent } from "echarts/components";
import VChart from "vue-echarts";
import { NCard, NDataTable } from "naive-ui";
import { activeThemeId } from "../theme.js";
import Balls from "./Balls.vue";

use([CanvasRenderer, LineChart, GridComponent, TooltipComponent, LegendComponent, DataZoomComponent, MarkPointComponent, MarkAreaComponent]);

const props = defineProps({
  points: { type: Array, required: true },
  mask: { type: String, default: "" },
  longest: { type: Object, default: () => ({ length: 0 }) },
  expected: { type: Number, default: 0 },
  trials: { type: Number, default: 0 },
});

const columns = [
  { title: "日期", key: "date" },
  { title: "期号", key: "issue" },
  { title: "开奖号", key: "number" },
  { title: "距上次", key: "gap" },
];

const hits = computed(() => {
  const rows = [];
  let previous = -1;
  props.points.forEach((point, index) => {
    if (props.mask[index] !== "1") return;
    rows.push({
      key: point.issue,
      index,
      date: point.date,
      issue: point.issue,
      number: point.number,
      digits: point.number.split(""),
      gap: previous < 0 ? "首次" : `${index - previous} 期`,
    });
    previous = index;
  });
  return rows;
});

const latest = computed(() => {
  const row = hits.value.at(-1);
  if (!row) return null;
  const since = props.points.length - 1 - row.index;
  return { ...row, since };
});

const recent = computed(() => hits.value.slice(-8).reverse());

const option = computed(() => {
  activeThemeId.value;
  const brand = getComputedStyle(document.documentElement).getPropertyValue("--brand").trim() || "#8d3aad";
  const muted = getComputedStyle(document.documentElement).getPropertyValue("--muted").trim() || "#8e8e93";
  let actual = 0;
  const actualLine = [];
  const rate = props.trials ? props.expected / props.trials : 0;
  const theoryLine = props.points.map((_, index) => Number(((index + 1) * rate).toFixed(2)));
  props.points.forEach((_, index) => {
    if (props.mask[index] === "1") actual += 1;
    actualLine.push(actual);
  });
  const last = latest.value;
  const drought = props.longest?.length
    ? [[
      { xAxis: props.points[props.longest.start]?.issue },
      { xAxis: props.points[props.longest.end]?.issue },
    ]]
    : [];
  return {
    color: [brand, "#93c5fd"],
    tooltip: {
      trigger: "axis",
      formatter(params) {
        const index = params[0]?.dataIndex ?? 0;
        const point = props.points[index];
        if (!point) return "";
        const hit = props.mask[index] === "1" ? "命中" : "未中";
        return `${point.date}<br/>${point.issue} ${point.number}<br/>${hit}<br/>累计命中 ${actualLine[index]}`;
      },
    },
    legend: { top: 0, textStyle: { color: muted } },
    grid: { left: 36, right: 12, top: 32, bottom: 48 },
    dataZoom: [
      { type: "inside" },
      { type: "slider", height: 16, bottom: 8 },
    ],
    xAxis: {
      type: "category",
      data: props.points.map((point) => point.issue),
      axisLabel: { show: false },
    },
    yAxis: { type: "value", minInterval: 1, splitLine: { lineStyle: { color: "rgba(0,0,0,0.06)" } } },
    series: [
      {
        name: "实际累计",
        type: "line",
        showSymbol: false,
        data: actualLine,
        markPoint: last ? {
          symbol: "circle",
          symbolSize: 10,
          label: { show: false },
          data: [{ coord: [last.issue, actualLine[last.index]] }],
        } : undefined,
        markArea: drought.length ? {
          itemStyle: { color: "rgba(37, 99, 235, 0.12)" },
          data: drought,
        } : undefined,
      },
      { name: "理论累计", type: "line", showSymbol: false, lineStyle: { type: "dashed" }, data: theoryLine },
    ],
  };
});
</script>

<template>
  <n-card v-if="latest" class="hit-latest" size="small" :bordered="false">
    <p class="eyebrow">最近一次命中</p>
    <Balls :digits="latest.digits" />
    <p>{{ latest.date }} · 第 {{ latest.issue }} 期 · {{ latest.number }}</p>
    <p class="quiet">{{ latest.since === 0 ? "最近一期命中。" : `之后已连续未中 ${latest.since} 期。` }}</p>
  </n-card>
  <p v-else class="quiet">这段回测没有命中。</p>
  <n-card class="hit-chart-card" size="small" :bordered="false">
    <v-chart class="hit-chart" :option="option" autoresize />
  </n-card>
  <n-data-table v-if="recent.length" class="hit-table" size="small" :columns="columns" :data="recent" :pagination="false" />
</template>
