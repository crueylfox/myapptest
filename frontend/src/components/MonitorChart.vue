<script setup lang="ts">
import { nextTick, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import * as echarts from 'echarts/core'
import { LineChart } from 'echarts/charts'
import { GridComponent, LegendComponent, TooltipComponent } from 'echarts/components'
import { CanvasRenderer } from 'echarts/renderers'
import type { MonitorSnapshot } from '../types'

echarts.use([LineChart, GridComponent, LegendComponent, TooltipComponent, CanvasRenderer])

const props = defineProps<{
  title: string
  history: MonitorSnapshot[]
  fields: Array<{ key: keyof MonitorSnapshot; name: string; color: string }>
  unit: 'percent' | 'rate'
}>()
const root = ref<HTMLDivElement>()
let chart: ReturnType<typeof echarts.init> | null = null
let observer: ResizeObserver | null = null
let resizeFrame = 0
let destroyed = false

function axisRate(value: number) {
  if (value >= 1024 ** 3) return `${(value / 1024 ** 3).toFixed(1)} GB/s`
  if (value >= 1024 ** 2) return `${(value / 1024 ** 2).toFixed(1)} MB/s`
  if (value >= 1024) return `${(value / 1024).toFixed(1)} KB/s`
  return `${value.toFixed(0)} B/s`
}

function render() {
  if (!chart) return
  const dark = document.documentElement.dataset.theme !== 'light'
  const uiFontSize = Number.parseFloat(
    getComputedStyle(document.documentElement).getPropertyValue('--ui-font-size'),
  ) || 15
  chart.setOption({
    backgroundColor: 'transparent',
    animation: false,
    tooltip: { trigger: 'axis' },
    grid: { left: 58, right: 18, top: 42, bottom: 30 },
    legend: { top: 8, textStyle: { color: dark ? '#9ca9bb' : '#526074', fontSize: Math.max(11, uiFontSize - 2) } },
    xAxis: {
      type: 'category', boundaryGap: false,
      data: props.history.map((item) => new Date(item.timestamp).toLocaleTimeString([], { minute: '2-digit', second: '2-digit' })),
      axisLabel: { color: '#768399', interval: 9, fontSize: Math.max(10, uiFontSize - 3) }, axisLine: { lineStyle: { color: '#303b4c' } },
    },
    yAxis: {
      type: 'value', min: 0, max: props.unit === 'percent' ? 100 : undefined,
      axisLabel: { color: '#768399', fontSize: Math.max(10, uiFontSize - 3), formatter: (value: number) => props.unit === 'rate' ? axisRate(value) : `${value}%` },
      splitLine: { lineStyle: { color: dark ? '#202a38' : '#dde3eb' } },
    },
    series: props.fields.map((field) => ({
      name: field.name, type: 'line', smooth: 0.25, showSymbol: false, connectNulls: false,
      data: props.history.map((item) => item[field.key] as number | null),
      lineStyle: { width: 2, color: field.color },
      areaStyle: { opacity: 0.08, color: field.color },
    })),
  }, true)
}

async function scheduleResize() {
  if (resizeFrame) window.cancelAnimationFrame(resizeFrame)
  await nextTick()
  if (destroyed) return
  resizeFrame = window.requestAnimationFrame(() => {
    resizeFrame = 0
    if (!destroyed && root.value?.clientWidth && root.value.clientHeight) chart?.resize()
  })
}

function handleAppearanceChange() {
  render()
  void scheduleResize()
}

onMounted(() => {
  destroyed = false
  if (root.value) chart = echarts.init(root.value)
  render()
  observer = new ResizeObserver(() => void scheduleResize())
  if (root.value) observer.observe(root.value)
  window.addEventListener('serverpilot:appearance', handleAppearanceChange)
  void scheduleResize()
})
onBeforeUnmount(() => {
  destroyed = true
  window.removeEventListener('serverpilot:appearance', handleAppearanceChange)
  observer?.disconnect()
  observer = null
  if (resizeFrame) window.cancelAnimationFrame(resizeFrame)
  chart?.dispose()
  chart = null
})
watch(
  () => [props.history, props.fields, props.unit] as const,
  () => {
    render()
    void scheduleResize()
  },
  { deep: true },
)
</script>

<template>
  <section class="chart-panel">
    <header class="chart-header"><h3>{{ title }}</h3></header>
    <div class="chart-body"><div ref="root" class="chart"></div></div>
  </section>
</template>
