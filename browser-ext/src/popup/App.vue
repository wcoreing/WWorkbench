<script setup lang="ts">
import { computed, onMounted, ref } from 'vue'
import { EXT_VERSION } from '../shared/version'

type StatusData = {
  extensionConnected?: boolean
  attachedTabId?: number | null
  version?: string
  capabilities?: string[]
  recording?: boolean
  recordingSession?: string
}

const loading = ref(true)
const busy = ref(false)
const error = ref('')
const status = ref<StatusData | null>(null)

const recording = computed(() => !!status.value?.recording)

function sendPopup<T = any>(kind: string, payload: Record<string, unknown> = {}) {
  return new Promise<T>((resolve, reject) => {
    chrome.runtime.sendMessage({ channel: 'ww-popup', kind, ...payload }, (res) => {
      if (chrome.runtime.lastError) {
        reject(new Error(chrome.runtime.lastError.message))
        return
      }
      resolve(res as T)
    })
  })
}

async function refresh() {
  loading.value = true
  error.value = ''
  try {
    const res = await sendPopup<{ ok: boolean; data?: StatusData; error?: string }>('status')
    if (!res?.ok) throw new Error(res?.error || '状态读取失败')
    status.value = res.data || null
  } catch (e) {
    error.value = String((e as Error)?.message || e)
  } finally {
    loading.value = false
  }
}

async function wake() {
  await sendPopup('wake')
  await refresh()
}

async function toggleRecord() {
  busy.value = true
  error.value = ''
  try {
    if (recording.value) {
      const res = await sendPopup<{ ok: boolean; error?: string }>('record_stop')
      if (!res?.ok) throw new Error(res?.error || '停止失败')
    } else {
      const res = await sendPopup<{ ok: boolean; error?: string }>('record_start')
      if (!res?.ok) throw new Error(res?.error || '开始失败')
    }
    await refresh()
  } catch (e) {
    error.value = String((e as Error)?.message || e)
  } finally {
    busy.value = false
  }
}

function reloadExt() {
  chrome.runtime.sendMessage({ channel: 'ww-popup', kind: 'reload' })
}

function openExtensions() {
  chrome.tabs.create({ url: 'chrome://extensions' })
}

onMounted(() => {
  void refresh()
})
</script>

<template>
  <h1>WWorkbench Browser Stage</h1>
  <p class="sub">本机桥扩展 · 源码 Vue/TS 构建 · 弹层 {{ EXT_VERSION }}</p>

  <div class="card">
    <div v-if="loading">读取状态…</div>
    <template v-else>
      <div class="row">
        <span>Service Worker</span>
        <span class="pill" :class="status ? 'on' : 'off'">{{ status ? '已响应' : '无响应' }}</span>
      </div>
      <div class="row">
        <span>运行版本</span>
        <b>{{ status?.version || '—' }}</b>
      </div>
      <div class="row">
        <span>附着标签</span>
        <b>{{ status?.attachedTabId ?? '未附着' }}</b>
      </div>
      <div class="row">
        <span>录制</span>
        <span class="pill" :class="recording ? 'rec' : 'off'">{{ recording ? '进行中' : '未开始' }}</span>
      </div>
      <div v-if="status?.capabilities?.length" class="caps">
        {{ status.capabilities.join(' · ') }}
      </div>
      <div v-if="error" class="warn">{{ error }}</div>
      <div v-if="status?.version && status.version !== EXT_VERSION" class="warn">
        弹层构建版本 {{ EXT_VERSION }} 与 SW {{ status.version }} 不一致，请点「热重载扩展」。
      </div>
    </template>
  </div>

  <div class="actions">
    <button type="button" class="primary" :disabled="loading || busy" @click="toggleRecord">
      {{ recording ? '停止录制' : '开始录制' }}
    </button>
    <button type="button" :disabled="loading" @click="refresh">刷新状态</button>
    <button type="button" class="ghost" @click="wake">唤醒桥接</button>
    <button type="button" class="ghost" @click="reloadExt">热重载扩展</button>
    <button type="button" class="ghost" @click="openExtensions">打开扩展页</button>
  </div>
  <p class="hint">开始后，在当前网页的点击、填写、跳转会写入工作台 Skill 会话列表。</p>
</template>
