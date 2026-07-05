import {createPinia} from 'pinia'
import {createApp} from 'vue'
import App from './App.vue'
import './style.css'
import { api } from './api/backend'
import { setInitialSettings } from './settingsBootstrap'
import { applyUIFontSize } from './utils/appearance'
import { applyTheme } from './utils/theme'

async function bootstrap() {
  document.documentElement.dataset.theme = 'dark'
  try {
    const settings = await api.settings()
    setInitialSettings(settings)
    applyTheme(settings.themeMode)
    applyUIFontSize(settings.uiFontSize)
  } catch {
    applyTheme('dark')
    applyUIFontSize('large')
  }

  const app = createApp(App)
  app.config.errorHandler = () => {
    void api.logFrontendError('vue').catch(() => console.error('Unable to write Vue error to the application log'))
  }
  window.addEventListener('unhandledrejection', () => {
    void api.logFrontendError('promise').catch(() => console.error('Unable to write promise error to the application log'))
  })
  app.use(createPinia()).mount('#app')
}

void bootstrap()
