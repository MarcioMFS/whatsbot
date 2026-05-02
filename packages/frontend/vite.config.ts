import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

export default defineConfig({
  plugins: [react()],
  server: {
    port: 3011,
    host: '0.0.0.0',
    allowedHosts: ['whatsbot.mfslabs.com.br'],
    proxy: {
      '/api': { target: 'http://localhost:3013', changeOrigin: true },
      '/webhooks': { target: 'http://localhost:3013', changeOrigin: true },
    },
  },
})
