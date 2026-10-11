import { createApp } from 'vue'
import { createPinia } from 'pinia'
import { createVuetify } from 'vuetify'
import * as components from 'vuetify/components'
import * as directives from 'vuetify/directives'
import { aliases, mdi } from 'vuetify/iconsets/mdi'
import 'vuetify/styles'
import '@mdi/font/css/materialdesignicons.css'
import './styles.css'
import App from './App.vue'
import router from './router'

const vuetify = createVuetify({
  components,
  directives,
  icons: { defaultSet: 'mdi', aliases, sets: { mdi } },
  theme: {
    defaultTheme: 'pulse',
    themes: {
      pulse: {
        dark: false,
        colors: {
          primary: '#2563eb',
          'on-primary': '#ffffff',
          secondary: '#64748b',
          background: '#f7f9fc',
          surface: '#ffffff',
          error: '#dc3545',
          success: '#16965f',
        },
      },
    },
  },
})

createApp(App).use(createPinia()).use(router).use(vuetify).mount('#app')
