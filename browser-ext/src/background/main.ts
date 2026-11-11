import { handleCommand } from './commands'
import { handleContentRecordStep, startRecording, stopRecording } from './record'
import { loadAttached } from './state'
import { ensureOffscreen } from './tabs'

void loadAttached()

chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  if (msg?.channel === 'ww-record' && msg.kind === 'step') {
    handleContentRecordStep(msg, sender.tab?.id)
    sendResponse({ ok: true })
    return false
  }
  if (msg?.channel === 'ww-popup') {
    if (msg.kind === 'status') {
      handleCommand({ action: 'status' })
        .then((res) => sendResponse(res))
        .catch((e) => sendResponse({ ok: false, error: String(e?.message || e) }))
      void ensureOffscreen()
      return true
    }
    if (msg.kind === 'record_start') {
      startRecording({ title: typeof msg.title === 'string' ? msg.title : '' })
        .then((res) => sendResponse(res))
        .catch((e) => sendResponse({ ok: false, error: String(e?.message || e) }))
      return true
    }
    if (msg.kind === 'record_stop') {
      stopRecording()
        .then((res) => sendResponse(res))
        .catch((e) => sendResponse({ ok: false, error: String(e?.message || e) }))
      return true
    }
    if (msg.kind === 'wake') {
      void ensureOffscreen()
      sendResponse({ ok: true })
      return true
    }
    if (msg.kind === 'reload') {
      chrome.runtime.reload()
      return false
    }
    return false
  }
  if (msg?.channel !== 'ww-bridge') return false
  if (msg.kind === 'command') {
    handleCommand(msg.msg || {})
      .then((res) => sendResponse(res))
      .catch((e) => sendResponse({ ok: false, error: String(e?.message || e) }))
    return true
  }
  return false
})

chrome.runtime.onInstalled.addListener(() => {
  void ensureOffscreen()
})
chrome.runtime.onStartup.addListener(() => {
  void ensureOffscreen()
})
void ensureOffscreen()

chrome.alarms.create('ww-offscreen-keepalive', { periodInMinutes: 1 })
chrome.alarms.onAlarm.addListener((a) => {
  if (a.name === 'ww-offscreen-keepalive') void ensureOffscreen()
})
