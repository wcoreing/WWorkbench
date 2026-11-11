/**
 * 填表路由：通用路径 + widgets/*；框架细节在 adapters/*。
 * 日期/下拉的 open→settle→pick 由 background 编排；失败后应 snapshot 再点 ref。
 */
import { prepareTarget } from './target'
import { detectWidget } from './widgets/detect'
import { dateEditorRoot, doDatePicker, parseDateValue } from './widgets/date'
import { SNAPSHOT_HINT } from './widgets/meta'
import { doSelectOption, isCustomSelectTrigger } from './widgets/select'
import {
  fillNativeSelect,
  fillNativeValue,
  fillRichText,
  isRichEditable,
  resolveEditableTarget,
} from './widgets/text'

export {
  isRichEditable,
  fillRichText,
  isCustomSelectTrigger,
  doSelectOption,
  parseDateValue,
  dateEditorRoot,
  doDatePicker,
  SNAPSHOT_HINT,
}

export function doFill(args) {
  const dateVal = parseDateValue(args?.value)
  // 日期面板编排：pick/state/nav 不依赖原 ref（面板挂在 body）
  if (args?.phase === 'pick' || args?.phase === 'panel_state' || args?.phase === 'nav_month') {
    return doDatePicker(args)
  }
  if (args?.phase === 'open' && dateVal) return doDatePicker(args)

  const got = prepareTarget(args)
  if (!got) return { ok: false, error: '未找到元素', data: { hint: SNAPSHOT_HINT } }
  let { el, win, doc, frame } = got

  const kind = detectWidget(el, args?.value)
  if (kind === 'date') return doDatePicker(args)

  if (kind === 'select') {
    return {
      ok: false,
      error: 'custom_select',
      code: 'custom_select',
      data: {
        hint: SNAPSHOT_HINT,
        note: 'background 自动改道 select_option；仍失败则 snapshot 后点 option',
      },
    }
  }

  if (el.getAttribute('role') === 'combobox' || el.classList?.contains('ant-select-selector')) {
    el = el.querySelector('input') || el
  }

  const resolved = resolveEditableTarget(el, win, doc)
  el = resolved.el
  win = resolved.win
  doc = resolved.doc

  const value = args?.value ?? ''
  if (isRichEditable(el)) {
    const mode = fillRichText(el, value, win, doc)
    return {
      ok: true,
      data: {
        tag: el.tagName.toLowerCase(),
        mode,
        frame,
        value: String(value).slice(0, 60),
      },
    }
  }
  if (el.tagName === 'SELECT') return fillNativeSelect(el, value, frame)
  return fillNativeValue(el, value, frame)
}
