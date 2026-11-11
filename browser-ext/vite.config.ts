import { defineConfig } from 'vite'
import vue from '@vitejs/plugin-vue'
import { resolve } from 'node:path'

/** 仅构建 Vue popup；background/content/offscreen 由 esbuild 打包。 */
export default defineConfig({
  plugins: [vue()],
  root: resolve(__dirname, 'src/popup'),
  base: './',
  build: {
    outDir: resolve(__dirname, 'dist/popup'),
    emptyOutDir: true,
    rollupOptions: {
      input: resolve(__dirname, 'src/popup/index.html'),
    },
  },
})
