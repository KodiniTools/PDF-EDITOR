import './assets/main.css'

import { createApp } from 'vue'
import { createPinia } from 'pinia'

import App from './App.vue'
import router from './router'

const app = createApp(App)

app.use(createPinia())
app.use(router)

app.mount('#app')

void import('virtual:kodini-nav').catch((error: unknown) => {
  console.error('KodiniTools-Navigation konnte nicht initialisiert werden.', error)
})
