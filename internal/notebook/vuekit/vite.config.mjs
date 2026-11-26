import { defineConfig } from 'vite'
import vue from '@vitejs/plugin-vue'
import { viteSingleFile } from 'vite-plugin-singlefile'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const kitDir = path.dirname(fileURLToPath(import.meta.url))
const viewRoot = process.env.WWB_VIEW_ROOT
const outDir = process.env.WWB_OUT_DIR

export default defineConfig({
  root: viewRoot,
  base: './',
  // 模板里的相对地址留给笔记附件，不当成 Vite 模块。视图自己的图用 import。
  plugins: [vue({ template: { transformAssetUrls: { tags: {} } } }), viteSingleFile()],
  resolve: {
    alias: {
      '@': path.join(viewRoot, 'src'),
      vue: path.join(kitDir, 'node_modules/vue'),
    },
    modules: [path.join(kitDir, 'node_modules')],
  },
  build: {
    outDir,
    emptyOutDir: true,
    cssCodeSplit: false,
    assetsInlineLimit: 100000000,
    modulePreload: false,
    rollupOptions: {
      output: {
        inlineDynamicImports: true,
      },
    },
  },
})
