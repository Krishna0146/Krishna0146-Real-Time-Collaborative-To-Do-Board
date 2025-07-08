import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

export default defineConfig({
  plugins: [react()],
  server: {
    port: 5173,
    proxy: {
      '/api': {
        target: 'https://krishna0146-real-time-collaborative-to.onrender.com',
        changeOrigin: true,
      },
    },
  },
})