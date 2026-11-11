/** Content script 入口：消息路由。 */
import { CONTENT_VER } from './version'
import { listFrames } from './frames'
import { buildSnapshot, doFind, doReadPage } from './snapshot'
import { resolveBox, doClick } from './click'
import { doFill } from './fill'
import { doSelectOption } from './widgets/select'
import { doProbe } from './probe'
import { doKeys } from './keys'
import { resolveFileInput } from './file'
import { doEvaluate } from './evaluate'
import { disableRecording, enableRecording, recordingStatus } from './record'

export const VER = CONTENT_VER

function install() {
  if (window.__wwBrowserStageVer === VER && window.__wwBrowserStageHandler) return
  if (window.__wwBrowserStageHandler) {
    try {
      chrome.runtime.onMessage.removeListener(window.__wwBrowserStageHandler)
    } catch {
      /* ignore */
    }
  }
  window.__wwBrowserStageVer = VER
  window.__wwBrowserStage = true

  function onMessage(msg: any, _sender: chrome.runtime.MessageSender, sendResponse: (r: any) => void) {
    if (!msg || msg.channel !== 'ww-browser') return false
    try {
      const map: Record<string, () => any> = {
        ping: () => ({ ok: true, data: { ver: VER, url: location.href } }),
        snapshot: () => ({ ok: true, data: buildSnapshot(msg.args || {}) }),
        read_page: () => doReadPage(msg.args || {}),
        resolve_box: () => resolveBox(msg.args || {}),
        resolve_file_input: () => resolveFileInput(msg.args || {}),
        click: () => doClick(msg.args || {}),
        fill: () => doFill(msg.args || {}),
        select_option: () => doSelectOption(msg.args || {}),
        find: () => doFind(msg.args || {}),
        probe: () => doProbe(msg.args || {}),
        keys: () => doKeys(msg.args || {}),
        evaluate: () => doEvaluate(msg.args || {}),
        frames: () => ({ ok: true, data: { frames: listFrames(), url: location.href } }),
        viewport: () => ({
          ok: true,
          data: {
            width: window.innerWidth,
            height: window.innerHeight,
            dpr: window.devicePixelRatio || 1,
            url: location.href,
          },
        }),
        record_enable: () => enableRecording(String(msg.args?.session || '')),
        record_disable: () => disableRecording(),
        record_status: () => ({ ok: true, data: recordingStatus() }),
      }
      const fn = map[msg.action]
      if (!fn) {
        sendResponse({ ok: false, error: '未知 content 动作: ' + msg.action })
        return true
      }
      sendResponse(fn())
    } catch (e: any) {
      sendResponse({ ok: false, error: String(e?.message || e) })
    }
    return true
  }

  window.__wwBrowserStageHandler = onMessage
  chrome.runtime.onMessage.addListener(onMessage)
}

install()
