import { useEffect, useState } from 'react'
import { api } from '../../api/client'
import type { Note } from '../../api/types'
import { subscribeWorkbenchChanged } from '../../workbench/workbenchRadar'

/** useDerivedPageHtml 读取派生 HTML。打包写盘后跟着刷新。 */
export function useDerivedPageHtml(active: boolean, noteId: string): string {
  const [html, setHtml] = useState('')
  useEffect(() => {
    const id = noteId.trim()
    if (!active || !id) return
    let cancelled = false
    const load = () => {
      api
        .getNote(id)
        .then((raw) => {
          if (!cancelled) setHtml(String((raw as Note).content || ''))
        })
        .catch(() => {
          if (!cancelled) setHtml('')
        })
    }
    load()
    const off = subscribeWorkbenchChanged((evt) => {
      if (evt.domain !== 'notebook.note' && evt.domain !== 'notebook.path') return
      if (!evt.ids.includes(id)) return
      load()
    })
    return () => {
      cancelled = true
      off()
    }
  }, [active, noteId])
  return html
}
