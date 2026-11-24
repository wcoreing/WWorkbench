import { api } from '../api/client'
import { parseNotebookAssetHref } from '../features/notebook/notebookAssetLinks'
import { notify } from '../notify'

type RuntimeBridge = {
  BrowserOpenURL?: (url: string) => void
}

function runtimeBridge(): RuntimeBridge | undefined {
  return (window as Window & { runtime?: RuntimeBridge }).runtime
}

function shouldHold(href: string): boolean {
  if (!href || href.startsWith('#') || href.startsWith('mailto:') || href.startsWith('javascript:')) {
    return false
  }
  if (parseNotebookAssetHref(href)) return true
  if (/^https?:\/\//i.test(href)) return true
  if (href.startsWith('/')) return true
  return false
}

async function openHeldLink(href: string): Promise<void> {
  const asset = parseNotebookAssetHref(href)
  if (asset) {
    await api.openNotebookAsset(asset.noteId, asset.file)
    return
  }
  if (/^https?:\/\//i.test(href)) {
    const open = runtimeBridge()?.BrowserOpenURL
    if (open) {
      open(href)
      return
    }
    window.open(href, '_blank', 'noopener')
  }
}

/** installInAppLinkGuard 拦住会把 WebView 导航离开应用的链接。附件交给系统应用打开。 */
export function installInAppLinkGuard(): () => void {
  const onClick = (e: MouseEvent) => {
    if (e.defaultPrevented || e.button !== 0) return
    if (e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return
    const el = e.target
    if (!(el instanceof Element)) return
    const anchor = el.closest('a')
    if (!(anchor instanceof HTMLAnchorElement)) return
    const href = anchor.getAttribute('href') || ''
    if (!shouldHold(href)) return
    e.preventDefault()
    void openHeldLink(href).catch((err: unknown) => {
      notify.error(err instanceof Error ? err.message : String(err))
    })
  }
  document.addEventListener('click', onClick, true)
  return () => document.removeEventListener('click', onClick, true)
}
