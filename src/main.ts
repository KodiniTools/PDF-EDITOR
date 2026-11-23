import './assets/main.css'

import { createApp } from 'vue'
import { createPinia } from 'pinia'

import App from './App.vue'
import { installI18n } from './i18n'
import router from './router'

installI18n()

const app = createApp(App)

app.use(createPinia())
app.use(router)

app.mount('#app')

void import('virtual:kodini-nav').catch((error: unknown) => {
  console.error('KodiniTools-Navigation konnte nicht initialisiert werden.', error)
})

void import('virtual:kodini-footer').catch((error: unknown) => {
  console.error('KodiniTools-Footer konnte nicht initialisiert werden.', error)
})
