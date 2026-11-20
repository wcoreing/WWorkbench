import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

export default defineConfig({
  plugins: [react()],
  server: {
    // 绑 IPv4，避免和只占 [::1] 的邻项目撞车；端口被占时顺延。
    // Wails frontend:dev:serverUrl=auto 只认 stdout 里的 Local:，strictPort 退出时不会打印，dev 会超时。
    host: '127.0.0.1',
    port: 5174,
    strictPort: false,
  },
  optimizeDeps: {
    include: ['@monaco-editor/react'],
  },
  build: {
    rollupOptions: {
      output: {
        manualChunks(id) {
          if (!id.includes('node_modules')) return
          if (id.includes('monaco-editor') || id.includes('@monaco-editor')) return 'monaco'
          if (id.includes('@xterm')) return 'xterm'
          if (id.includes('echarts')) return 'echarts'
          if (id.includes('react-dom') || id.includes('/react/')) return 'react-vendor'
        },
      },
    },
  },
})
