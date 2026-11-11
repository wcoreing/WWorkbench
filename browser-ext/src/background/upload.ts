import { fail, ok, type CmdResult } from '../shared/types'
import { sendWithRefRetry } from './retry'
import { ensureContent, focusTab, wantActivateWindow } from './tabs'

type CdpTarget = { tabId: number }

async function withDebugger<T>(tabId: number, fn: (target: CdpTarget) => Promise<T>): Promise<T> {
  const target = { tabId }
  let attachedHere = false
  try {
    await chrome.debugger.attach(target, '1.3')
    attachedHere = true
  } catch (e) {
    const msg = String((e as Error)?.message || e)
    if (!/Already attached/i.test(msg)) throw e
  }
  try {
    return await fn(target)
  } finally {
    if (attachedHere) {
      try {
        await chrome.debugger.detach(target)
      } catch {
        /* ignore */
      }
    }
  }
}

/**
 * 向 file input 设置本机文件路径（CDP DOM.setFileInputFiles）。
 * files 必须是 Chrome 可访问的绝对路径。
 */
export async function handleUpload(tid: number, args: Record<string, unknown> = {}): Promise<CmdResult> {
  const filesRaw = args?.files ?? args?.paths ?? args?.file
  const files = Array.isArray(filesRaw)
    ? filesRaw.map((x) => String(x).trim()).filter(Boolean)
    : String(filesRaw || '')
        .split(/\n|,/)
        .map((s) => s.trim())
        .filter(Boolean)
  if (!files.length) return fail('请提供 files（本机绝对路径数组）', 'invalid_arg')

  await focusTab(tid, wantActivateWindow(args))
  await ensureContent(tid)

  const located = await sendWithRefRetry(tid, 'resolve_file_input', args)
  if (!located?.ok) {
    return fail(located?.error || '未找到文件输入框', located?.code || 'not_found')
  }

  try {
    const result = await withDebugger(tid, async (target) => {
      const expr = located.data?.ref
        ? `document.querySelector('[data-ww-ref="${String(located.data.ref).replace(/"/g, '\\"')}"]')`
        : `document.querySelector('input[type=file][data-ww-upload="1"], input[type=file]')`
      const evalRes = (await chrome.debugger.sendCommand(target, 'Runtime.evaluate', {
        expression: expr,
        objectGroup: 'ww-upload',
        includeCommandLineAPI: false,
      })) as { result?: { objectId?: string }; exceptionDetails?: unknown }
      const objectId = evalRes?.result?.objectId
      if (!objectId) throw new Error('CDP 无法拿到 file input objectId')

      const nodeRes = (await chrome.debugger.sendCommand(target, 'DOM.requestNode', {
        objectId,
      })) as { nodeId?: number }
      const nodeId = nodeRes?.nodeId
      if (!nodeId) throw new Error('CDP 无法拿到 nodeId')

      await chrome.debugger.sendCommand(target, 'DOM.setFileInputFiles', {
        files,
        nodeId,
      })
      try {
        await chrome.debugger.sendCommand(target, 'Runtime.releaseObjectGroup', {
          objectGroup: 'ww-upload',
        })
      } catch {
        /* ignore */
      }
      return { nodeId, fileCount: files.length }
    })

    return ok({
      ...located.data,
      files,
      fileCount: files.length,
      ...result,
      mode: 'cdp',
    })
  } catch (e) {
    return fail('上传失败: ' + String((e as Error)?.message || e), 'upload_failed')
  }
}
