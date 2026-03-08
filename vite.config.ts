import { defineConfig } from 'vite'
import { readFileSync, existsSync } from 'fs'
import vue from '@vitejs/plugin-vue'
import tailwindcss from '@tailwindcss/vite'

// Read the server port written by the backend on startup (auto-port detection)
const serverPort = existsSync('.cockpit-port')
  ? parseInt(readFileSync('.cockpit-port', 'utf-8').trim(), 10)
  : 3000

export default defineConfig({
  plugins: [vue(), tailwindcss()],
  root: 'src/client',
  build: {
    outDir: '../../dist/client',
    emptyOutDir: true,
  },
  server: {
    port: 5173,
    proxy: {
      '/api': `http://localhost:${serverPort}`,
      '/ws': {
        target: `ws://localhost:${serverPort}`,
        ws: true,
      },
    },
  },
})
