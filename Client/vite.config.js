import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

export default defineConfig({
  plugins: [react()],
  server: {
    host: '0.0.0.0', // Bind to all interfaces for Render
    port: parseInt(process.env.PORT) || 5173, // Use Render's PORT env variable
    proxy: {
      '/api': {
        target: process.env.API_URL || 'http://localhost:5000',
        changeOrigin: true,
        secure: false, // Set to true if your API uses HTTPS
      },
    },
  },
  preview: {
    host: '0.0.0.0',
    port: parseInt(process.env.PORT) || 4173, // Parse as integer for consistency
  },
  build: {
    outDir: 'dist',
    sourcemap: false, // Disable source maps for production to reduce bundle size
  },
})