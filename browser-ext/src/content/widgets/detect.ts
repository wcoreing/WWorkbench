/** 控件类型探测：fill 路由用。 */
import { isAntDateEditor } from '../adapters/ant-date'
import { isElementDateEditor } from '../adapters/element-date'
import { isCustomSelectTrigger } from '../adapters/select-dropdown'
import { dateEditorRoot, parseDateValue } from './date'
import { isRichEditable } from './text'

/** @returns {'date'|'select'|'richtext'|'native_select'|'text'|'unknown'} */
export function detectWidget(el, value) {
  if (!el) return 'unknown'
  const dateVal = parseDateValue(value)
  if (dateVal && (dateEditorRoot(el) || el.type === 'date' || isElementDateEditor(el) || isAntDateEditor(el))) {
    return 'date'
  }
  if (el.tagName === 'SELECT') return 'native_select'
  if (isCustomSelectTrigger(el) && value != null && String(value) !== '') return 'select'
  if (isRichEditable(el)) return 'richtext'
  return 'text'
}
