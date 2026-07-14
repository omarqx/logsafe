import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import path from 'node:path'

const dir = path.dirname(new URL(import.meta.url).pathname)

export default defineConfig({
  root: dir,
  plugins: [react()],
  server: {
    port: 5173,
    proxy: {
      '/api': 'http://127.0.0.1:4600',
      '/v1': 'http://127.0.0.1:4600',
    },
  },
  build: {
    outDir: path.resolve(dir, '../packages/server/public'),
    emptyOutDir: true,
  },
})
