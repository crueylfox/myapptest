<script setup lang="ts">
withDefaults(defineProps<{
  name: string
  size?: number
  decorative?: boolean
  ariaLabel?: string
}>(), {
  size: 20,
  decorative: true,
  ariaLabel: '',
})
</script>

<template>
  <svg
    class="app-icon"
    :class="`app-icon--${name}`"
    xmlns="http://www.w3.org/2000/svg"
    viewBox="0 0 24 24"
    :width="size"
    :height="size"
    fill="none"
    stroke="currentColor"
    stroke-width="1.4"
    stroke-linecap="round"
    stroke-linejoin="round"
    vector-effect="non-scaling-stroke"
    :aria-hidden="decorative ? 'true' : undefined"
    :role="decorative ? undefined : 'img'"
    :aria-label="decorative ? undefined : ariaLabel"
  >
    <title v-if="!decorative && ariaLabel">{{ ariaLabel }}</title>
    <g v-if="name === 'server-plus'">
      <rect x="4" y="4" width="11" height="5" rx="1.5" />
      <rect x="4" y="12" width="11" height="5" rx="1.5" />
      <path d="M7 6.5h.01M7 14.5h.01M18 11v6M15 14h6" />
    </g>
    <g v-else-if="name === 'folder-plus'">
      <path d="M3.5 7.5h6l1.8 2h9.2v7.8a2.2 2.2 0 0 1-2.2 2.2H5.7a2.2 2.2 0 0 1-2.2-2.2z" />
      <path d="M14.5 14.5h5M17 12v5" />
    </g>
    <g v-else-if="name === 'link'">
      <path d="M9.8 14.2a3.4 3.4 0 0 1 0-4.8l2.1-2.1a3.4 3.4 0 0 1 4.8 4.8l-.7.7" />
      <path d="M14.2 9.8a3.4 3.4 0 0 1 0 4.8l-2.1 2.1a3.4 3.4 0 0 1-4.8-4.8l.7-.7" />
    </g>
    <g v-else-if="name === 'terminal-check'">
      <rect x="3.5" y="5" width="17" height="13" rx="2.2" />
      <path d="M7 9l2.5 2L7 13M11 14h3" />
      <path d="M14.5 9.5l1.8 1.8 3.2-3.4" />
    </g>
    <g v-else-if="name === 'terminal' || name === 'powershell'">
      <rect x="3.5" y="5" width="17" height="13" rx="2.2" />
      <path d="M7 9l2.7 2.5L7 14M12 14h4.5" />
      <path v-if="name === 'powershell'" d="M12 9h5" />
    </g>
    <g v-else-if="name === 'gear'">
      <path d="M12 8.3a3.7 3.7 0 1 1 0 7.4 3.7 3.7 0 0 1 0-7.4z" />
      <path d="M12 3.8v2M12 18.2v2M4.9 7.2l1.7 1M17.4 15.8l1.7 1M4.9 16.8l1.7-1M17.4 8.2l1.7-1M3.8 12h2M18.2 12h2" />
    </g>
    <g v-else-if="name === 'keyboard'">
      <rect x="3.5" y="6.5" width="17" height="11" rx="2" />
      <path d="M7 10h.01M10 10h.01M13 10h.01M16 10h.01M7 13.5h.01M10 13.5h4M17 13.5h.01" />
    </g>
    <g v-else-if="name === 'bell'">
      <path d="M6.5 16.5h11M8 16.5V11a4 4 0 0 1 8 0v5.5M10 19a2.2 2.2 0 0 0 4 0" />
      <path d="M9 5.5A5.3 5.3 0 0 1 12 4a5.3 5.3 0 0 1 3 1.5" />
    </g>
    <g v-else-if="name === 'backup'">
      <path d="M7 18.5a4.5 4.5 0 0 1-.4-8.9A5.8 5.8 0 0 1 17.7 11a3.8 3.8 0 0 1-.7 7.5" />
      <path d="M12 9.5v7M9.5 12l2.5-2.5 2.5 2.5M14.5 15.8 12 18.3l-2.5-2.5" />
    </g>
    <g v-else-if="name === 'key'">
      <circle cx="8.5" cy="12.5" r="3.2" />
      <path d="M11.4 12.5h8M16.2 12.5v2.4M19.4 12.5v2.4" />
    </g>
    <g v-else-if="name === 'refresh'">
      <path d="M18.5 8.2A7 7 0 0 0 6 7.6L4.5 9.2" />
      <path d="M4.5 5.6v3.6h3.6M5.5 15.8A7 7 0 0 0 18 16.4l1.5-1.6" />
      <path d="M19.5 18.4v-3.6h-3.6" />
    </g>
    <g v-else-if="name === 'layout-grid'">
      <rect x="4" y="4" width="6.5" height="6.5" rx="1.4" />
      <rect x="13.5" y="4" width="6.5" height="6.5" rx="1.4" />
      <rect x="4" y="13.5" width="6.5" height="6.5" rx="1.4" />
      <rect x="13.5" y="13.5" width="6.5" height="6.5" rx="1.4" />
    </g>
    <g v-else-if="name === 'menu'">
      <path d="M5 7h14M5 12h14M5 17h14" />
    </g>
    <g v-else-if="name === 'chevron-down'">
      <path d="M6 9l6 6 6-6" />
    </g>
    <g v-else-if="name === 'chevron-up'">
      <path d="M6 15l6-6 6 6" />
    </g>
    <g v-else-if="name === 'route'">
      <circle cx="6.5" cy="6.5" r="2" />
      <circle cx="17.5" cy="17.5" r="2" />
      <path d="M8.5 6.5h4.5a3 3 0 0 1 0 6H11a3 3 0 0 0 0 6h4.5" />
    </g>
    <g v-else-if="name === 'box'">
      <path d="M4.5 8.2 12 4.5l7.5 3.7v7.6L12 19.5l-7.5-3.7z" />
      <path d="M4.8 8.4 12 12l7.2-3.6M12 12v7.2" />
    </g>
    <g v-else-if="name === 'activity'">
      <path d="M4 12h3l2-5 4 10 2-5h5" />
    </g>
    <g v-else-if="name === 'service'">
      <rect x="4" y="5" width="16" height="5" rx="1.5" />
      <rect x="4" y="14" width="16" height="5" rx="1.5" />
      <path d="M7 7.5h.01M7 16.5h.01M16 7.5h1.8M16 16.5h1.8" />
    </g>
    <g v-else-if="name === 'network'">
      <circle cx="12" cy="12" r="8" />
      <path d="M4 12h16M12 4a13 13 0 0 1 0 16M12 4a13 13 0 0 0 0 16" />
    </g>
    <g v-else-if="name === 'gauge'">
      <path d="M5.2 17a7.8 7.8 0 1 1 13.6 0" />
      <path d="M12 13.2 16 9M7.5 16h9" />
    </g>
    <g v-else-if="name === 'logs'">
      <path d="M6 4.5h9l3 3v12H6z" />
      <path d="M15 4.5v3h3M8.5 11h7M8.5 14h7M8.5 17H13" />
    </g>
    <g v-else>
      <circle cx="12" cy="12" r="7.5" />
      <path d="M12 8v8M8 12h8" />
    </g>
  </svg>
</template>
