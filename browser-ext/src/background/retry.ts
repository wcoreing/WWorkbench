import { sleep } from './state'
import { ensureContent, sendToTab } from './tabs'

const STALE_RE = /未找到|无法定位|not_found|stale|no.?ref|Receiving end|Could not establish|no_receiver/i

/** 内容脚本动作：失败且像 stale/ref 丢失时，强制 snapshot 再试一次。 */
export async function sendWithRefRetry(
  tabId: number,
  action: string,
  args: Record<string, unknown> = {},
) {
  await ensureContent(tabId)
  let res = await sendToTab(tabId, action, args)
  if (res?.ok) return res
  if (!STALE_RE.test(res?.error || res?.code || '')) return res

  await ensureContent(tabId, /Receiving end|Could not establish|no_receiver/i.test(res?.error || ''))
  await sendToTab(tabId, 'snapshot', {
    maxNodes: Number(args?.maxNodes) || 200,
    frame: args?.frame,
    format: 'json',
  })
  await sleep(40)
  res = await sendToTab(tabId, action, args)
  if (res) (res as any).retried = true
  return res
}
