import { defineConfig, loadEnv } from 'vite'
import vue from '@vitejs/plugin-vue'

export default defineConfig(({ mode }) => ({
  plugins: [vue()],
  server: {
    proxy: {
      '/api': {
        target: loadEnv(mode, '.', '').VITE_API_TARGET || 'http://127.0.0.1:3000',
        changeOrigin: true,
        rewrite: path => path.replace(/^\/api(?=\/|$)/, '') || '/',
      },
      '/socket.io': { target: loadEnv(mode, '.', '').VITE_API_TARGET || 'http://127.0.0.1:3000', changeOrigin: true, ws: true },
    },
  },
}))
