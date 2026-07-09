<script setup lang="ts">
const props = defineProps<{
  modelValue: number
  min: number
  max: number
  step: number
  stepperTestid: string
  inputTestid: string
  incrementTestid: string
  decrementTestid: string
  incrementLabel: string
  decrementLabel: string
}>()

const emit = defineEmits<{
  'update:modelValue': [value: number]
}>()

function rounded(value: number) {
  const decimals = Math.max(0, String(props.step).split('.')[1]?.length ?? 0)
  return Number(value.toFixed(decimals))
}

function clamped(value: number) {
  return rounded(Math.min(props.max, Math.max(props.min, value)))
}

function updateFromInput(event: Event) {
  emit('update:modelValue', clamped(Number((event.target as HTMLInputElement).value)))
}

function stepValue(direction: 1 | -1) {
  const current = Number(props.modelValue)
  emit('update:modelValue', clamped((Number.isFinite(current) ? current : props.min) + props.step * direction))
}
</script>

<template>
  <span class="terminal-profile-number-stepper" :data-testid="stepperTestid">
    <input
      :value="modelValue"
      class="terminal-profile-number-input"
      :data-testid="inputTestid"
      type="number"
      :min="min"
      :max="max"
      :step="step"
      @input="updateFromInput"
    />
    <span class="terminal-profile-number-stepper-buttons" aria-hidden="false">
      <button type="button" class="terminal-profile-number-stepper-button" :data-testid="incrementTestid" :aria-label="incrementLabel" @click="stepValue(1)">▲</button>
      <button type="button" class="terminal-profile-number-stepper-button" :data-testid="decrementTestid" :aria-label="decrementLabel" @click="stepValue(-1)">▼</button>
    </span>
  </span>
</template>
