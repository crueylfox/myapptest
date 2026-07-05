<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref, watch } from 'vue'

const props = withDefaults(defineProps<{
  series?: Array<Array<number | null>>
  timedSeries?: Array<Array<{ timestamp: string | number | Date; value: number | null }>>
  colors?: string[]
  max?: number
  flow?: boolean
  windowMs?: number
  now?: string | number | Date
  leftFade?: boolean
}>(), {
  series: () => [],
  timedSeries: () => [],
  colors: () => ['#65a7ff', '#2dd4bf'],
  max: undefined,
  flow: false,
  windowMs: undefined,
  now: undefined,
  leftFade: false,
})

interface SparkPoint {
  x: number
  y: number
}

const VISUAL_INTERPOLATION_MS = 560
const displaySeries = ref<Array<Array<number | null>>>(cloneSeries(props.series))
const currentNow = ref(resolveCurrentNow())
const fadeMaskId = `mini-sparkline-left-fade-${Math.random().toString(36).slice(2)}`
const fadeGradientId = `${fadeMaskId}-gradient`
let animationFrame: number | null = null
let animationTimer: number | null = null
let timelineFrame: number | null = null
let timelineTimer: number | null = null
let animationStart = 0

const paths = computed(() => {
  if (props.timedSeries.length && props.windowMs && props.windowMs > 0) {
    const timedLines = props.timedSeries.map((line) => line
      .map((point) => ({ timestamp: timeToMs(point.timestamp), value: point.value }))
      .filter((point) => point.timestamp !== null)
      .filter((point) => {
        const age = currentNow.value - point.timestamp!
        return age >= 0 && age <= props.windowMs!
      }))
    const timedValues = timedLines.flat().map((point) => point.value).filter((value): value is number =>
      value !== null && Number.isFinite(value))
    const maximum = props.max ?? Math.max(...timedValues, 1)
    return timedLines.map((line) => smoothPath(line.map((point) => {
      const age = currentNow.value - point.timestamp!
      const x = 100 - Math.min(Math.max(age / props.windowMs!, 0), 1) * 100
      const safe = point.value === null || !Number.isFinite(point.value) ? 0 : point.value
      const y = 24 - Math.min(Math.max(safe / maximum, 0), 1) * 21
      return { x, y }
    })))
  }

  const series = displaySeries.value.length ? displaySeries.value : props.series
  const values = [...props.series.flat(), ...series.flat()].filter((value): value is number =>
    value !== null && Number.isFinite(value))
  const maximum = props.max ?? Math.max(...values, 1)
  return series.map((line) => smoothPath(line.map((value, index) => {
    const x = line.length <= 1 ? 0 : index / (line.length - 1) * 100
    const safe = value === null || !Number.isFinite(value) ? 0 : value
    const y = 24 - Math.min(Math.max(safe / maximum, 0), 1) * 21
    return { x, y }
  })))
})

watch(() => props.series, (next) => {
  const target = cloneSeries(next)
  if (!props.flow) {
    displaySeries.value = target
    return
  }
  startVisualInterpolation(displaySeries.value, target)
}, { deep: true })

watch(() => [props.timedSeries, props.windowMs, props.now, props.flow] as const, () => {
  startTimelineClock()
}, { deep: true })

onMounted(() => {
  startTimelineClock()
})

onBeforeUnmount(() => {
  cancelVisualInterpolation()
  cancelTimelineClock()
})

function cloneSeries(series: Array<Array<number | null>>) {
  return series.map((line) => [...line])
}

function startVisualInterpolation(from: Array<Array<number | null>>, to: Array<Array<number | null>>) {
  cancelVisualInterpolation()
  const start = cloneSeries(from)
  const target = cloneSeries(to)
  animationStart = performanceNow()
  displaySeries.value = interpolateSeries(start, target, 0.001)
  scheduleVisualFrame(() => {
    stepVisualInterpolation(start, target)
  })
}

function stepVisualInterpolation(start: Array<Array<number | null>>, target: Array<Array<number | null>>) {
  const elapsed = performanceNow() - animationStart
  const progress = Math.min(1, elapsed / VISUAL_INTERPOLATION_MS)
  displaySeries.value = interpolateSeries(start, target, easeOut(progress))
  if (progress < 1) {
    scheduleVisualFrame(() => {
      stepVisualInterpolation(start, target)
    })
  }
}

function interpolateSeries(start: Array<Array<number | null>>, target: Array<Array<number | null>>, progress: number) {
  return target.map((line, lineIndex) => {
    const from = start[lineIndex] ?? []
    return line.map((value, valueIndex) => {
      if (value === null || !Number.isFinite(value)) return value
      const previous = from[valueIndex]
      if (previous === null || previous === undefined || !Number.isFinite(previous)) return value
      return previous + (value - previous) * progress
    })
  })
}

function easeOut(value: number) {
  return 1 - Math.pow(1 - value, 3)
}

function scheduleVisualFrame(callback: () => void) {
  if (typeof window !== 'undefined' && typeof window.requestAnimationFrame === 'function') {
    animationFrame = window.requestAnimationFrame(callback)
    return
  }
  if (typeof window !== 'undefined') {
    animationTimer = window.setTimeout(callback, 16)
  }
}

function startTimelineClock() {
  cancelTimelineClock()
  currentNow.value = resolveCurrentNow()
  if (!props.flow || !props.timedSeries.length || props.now !== undefined) return
  const baseNow = currentNow.value
  const start = performanceNow()
  const tick = () => {
    currentNow.value = baseNow + performanceNow() - start
    scheduleTimelineFrame(tick)
  }
  scheduleTimelineFrame(tick)
}

function scheduleTimelineFrame(callback: () => void) {
  if (typeof window !== 'undefined' && typeof window.requestAnimationFrame === 'function') {
    timelineFrame = window.requestAnimationFrame(callback)
    return
  }
  if (typeof window !== 'undefined') {
    timelineTimer = window.setTimeout(callback, 16)
  }
}

function cancelVisualInterpolation() {
  if (animationFrame !== null && typeof window !== 'undefined' && typeof window.cancelAnimationFrame === 'function') {
    window.cancelAnimationFrame(animationFrame)
  }
  if (animationTimer !== null && typeof window !== 'undefined') {
    window.clearTimeout(animationTimer)
  }
  animationFrame = null
  animationTimer = null
}

function cancelTimelineClock() {
  if (timelineFrame !== null && typeof window !== 'undefined' && typeof window.cancelAnimationFrame === 'function') {
    window.cancelAnimationFrame(timelineFrame)
  }
  if (timelineTimer !== null && typeof window !== 'undefined') {
    window.clearTimeout(timelineTimer)
  }
  timelineFrame = null
  timelineTimer = null
}

function resolveCurrentNow() {
  const explicit = timeToMs(props.now)
  if (explicit !== null) return explicit
  const timestamps = props.timedSeries
    .flat()
    .map((point) => timeToMs(point.timestamp))
    .filter((value): value is number => value !== null)
  return timestamps.length ? Math.max(...timestamps) : Date.now()
}

function timeToMs(value: string | number | Date | undefined) {
  if (value === undefined || value === null) return null
  const timestamp = value instanceof Date ? value.getTime() : typeof value === 'number' ? value : Date.parse(value)
  return Number.isFinite(timestamp) ? timestamp : null
}

function performanceNow() {
  return typeof performance !== 'undefined' && typeof performance.now === 'function'
    ? performance.now()
    : Date.now()
}

function smoothPath(points: SparkPoint[]) {
  if (!points.length) return ''
  if (points.length === 1) return `M ${formatPoint(points[0])}`
  const commands = [`M ${formatPoint(points[0])}`]
  for (let index = 0; index < points.length - 1; index += 1) {
    const current = points[index]
    const next = points[index + 1]
    const previous = points[index - 1] ?? current
    const afterNext = points[index + 2] ?? next
    const controlOne = {
      x: current.x + (next.x - previous.x) / 6,
      y: current.y + (next.y - previous.y) / 6,
    }
    const controlTwo = {
      x: next.x - (afterNext.x - current.x) / 6,
      y: next.y - (afterNext.y - current.y) / 6,
    }
    commands.push(`C ${formatPoint(controlOne)} ${formatPoint(controlTwo)} ${formatPoint(next)}`)
  }
  return commands.join(' ')
}

function formatPoint(point: SparkPoint) {
  return `${point.x.toFixed(2)},${point.y.toFixed(2)}`
}
</script>

<template>
  <svg
    class="mini-sparkline"
    :class="{ 'is-flowing': flow, 'is-visual-interpolated': flow }"
    data-visual-refresh="interpolated"
    viewBox="0 0 100 28"
    preserveAspectRatio="none"
    aria-hidden="true"
  >
    <defs v-if="leftFade">
      <linearGradient :id="fadeGradientId" x1="0" y1="0" x2="1" y2="0">
        <stop offset="0%" stop-color="black" />
        <stop offset="14%" stop-color="white" />
        <stop offset="100%" stop-color="white" />
      </linearGradient>
      <mask :id="fadeMaskId">
        <rect x="0" y="0" width="100" height="28" :fill="`url(#${fadeGradientId})`" />
      </mask>
    </defs>
    <g :mask="leftFade ? `url(#${fadeMaskId})` : undefined">
      <line x1="0" y1="25.5" x2="100" y2="25.5" />
      <path
        v-for="(line, index) in paths"
        :key="index"
        class="sparkline-path"
        :d="line"
        pathLength="100"
        :stroke="colors[index] ?? colors[0]"
        stroke-linecap="round"
        stroke-linejoin="round"
      />
    </g>
  </svg>
</template>
