import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

export default defineConfig({
  plugins: [react()],
  server: {
    strictPort: true,
  },
  optimizeDeps: {
    include: ['@monaco-editor/react'],
  },
})
