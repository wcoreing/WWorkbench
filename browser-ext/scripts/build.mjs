#!/usr/bin/env node
/**
 * 构建浏览器扩展 → dist/，并同步到 Go embed 目录 internal/browser/ext/
 */
import * as esbuild from 'esbuild'
import { build as viteBuild } from 'vite'
import { cpSync, mkdirSync, readFileSync, rmSync, writeFileSync, existsSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
const __dirname = dirname(fileURLToPath(import.meta.url))
const root = resolve(__dirname, '..')
const dist = join(root, 'dist')
const embed = resolve(root, '../internal/browser/ext')
const watch = process.argv.includes('--watch')
const syncOnly = process.argv.includes('--sync-only')

function readExtVersion() {
  const src = readFileSync(join(root, 'src/shared/version.ts'), 'utf8')
  const m = src.match(/EXT_VERSION\s*=\s*'([^']+)'/)
  return m?.[1] || '0.0.0'
}

function writeManifest(version) {
  const manifest = {
    manifest_version: 3,
    name: 'WWorkbench Browser Stage',
    description: '把已登录的 Chromium 标签接到 WWorkbench 舞台（Vue/TS 模块化构建）',
    version,
    permissions: ['tabs', 'tabGroups', 'windows', 'storage', 'scripting', 'alarms', 'offscreen', 'debugger'],
    host_permissions: ['http://127.0.0.1:18765/*', 'ws://127.0.0.1:18765/*', '<all_urls>'],
    background: {
      service_worker: 'background.js',
    },
    action: {
      default_title: 'WWorkbench Browser Stage',
      default_popup: 'popup/index.html',
    },
  }
  writeFileSync(join(dist, 'manifest.json'), JSON.stringify(manifest, null, 2))
}

function syncEmbed(version) {
  mkdirSync(embed, { recursive: true })
  // 清空旧产物，避免残留
  for (const name of ['background.js', 'content.js', 'offscreen.js', 'offscreen.html', 'manifest.json', 'popup']) {
    const p = join(embed, name)
    if (existsSync(p)) rmSync(p, { recursive: true, force: true })
  }
  cpSync(dist, embed, { recursive: true })
  // 同步 Go seedVersion
  const seedPath = resolve(root, '../internal/browser/seed.go')
  let seed = readFileSync(seedPath, 'utf8')
  seed = seed.replace(/const seedVersion = "[^"]+"/, `const seedVersion = "${version}"`)
  writeFileSync(seedPath, seed)
  console.log(`[browser-ext] synced → internal/browser/ext (seed ${version})`)
}

async function bundleSw() {
  const common = {
    bundle: true,
    platform: 'browser',
    target: 'chrome110',
    format: 'iife',
    sourcemap: false,
    logLevel: 'info',
  }
  await esbuild.build({
    ...common,
    entryPoints: [join(root, 'src/background/main.ts')],
    outfile: join(dist, 'background.js'),
  })
  await esbuild.build({
    ...common,
    entryPoints: [join(root, 'src/content/main.ts')],
    outfile: join(dist, 'content.js'),
  })
  await esbuild.build({
    ...common,
    entryPoints: [join(root, 'src/offscreen/main.ts')],
    outfile: join(dist, 'offscreen.js'),
  })
  cpSync(join(root, 'src/offscreen/index.html'), join(dist, 'offscreen.html'))
}

async function bundlePopup() {
  await viteBuild({
    configFile: join(root, 'vite.config.ts'),
  })
}

async function run() {
  const version = readExtVersion()
  mkdirSync(dist, { recursive: true })
  if (!syncOnly) {
    console.log(`[browser-ext] building ${version}…`)
    await bundleSw()
    await bundlePopup()
    writeManifest(version)
  }
  syncEmbed(version)
  // 热更新用户目录（开发时）
  const userExt = join(process.env.HOME || '', '.wworkbench/browser-ext')
  if (existsSync(dirname(userExt))) {
    try {
      mkdirSync(userExt, { recursive: true })
      for (const name of ['background.js', 'content.js', 'offscreen.js', 'offscreen.html', 'manifest.json', 'popup']) {
        const p = join(userExt, name)
        if (existsSync(p)) rmSync(p, { recursive: true, force: true })
      }
      cpSync(dist, userExt, { recursive: true })
      writeFileSync(join(userExt, '.ww-browser-ext-version'), version)
      console.log(`[browser-ext] synced → ~/.wworkbench/browser-ext`)
    } catch (e) {
      console.warn('[browser-ext] skip user sync:', e.message)
    }
  }
  console.log('[browser-ext] done')
}

if (watch) {
  console.log('[browser-ext] watch not fully wired; use: npm run build')
}
await run()
