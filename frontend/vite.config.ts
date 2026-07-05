import { configDefaults, defineConfig } from 'vitest/config'
import vue from '@vitejs/plugin-vue'

export default defineConfig({
  plugins: [vue()],
  test: {
    exclude: [...configDefaults.exclude, 'e2e/**', '**/e2e/**'],
  },
  build: {
    // The monitor route is lazy-loaded and its ECharts bundle is about 517 kB
    // minified (about 175 kB gzip), so keep the warning threshold just above it.
    chunkSizeWarningLimit: 550,
  },
})
