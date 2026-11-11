/** 自定义下拉（Ant/Element/ARIA）+ 原生 select 改道。 */
import { customSelectRoot, findDropdownOption, isCustomSelectTrigger, resolveSelectTrigger } from '../adapters/select-dropdown'
import { resolveContext } from '../frames'
import { boxOf, dispatchPointer, flash, prepareTarget } from '../target'
import { SNAPSHOT_HINT } from './meta'
import { fillNativeSelect } from './text'

export { isCustomSelectTrigger, customSelectRoot, findDropdownOption }

export function doSelectOption(args) {
  const want = args?.value ?? args?.option ?? args?.label ?? ''
  if (want === '' || want == null) return { ok: false, error: '请提供 value/option（选项文案或值）' }
  const ctx = resolveContext(args || {})
  const { doc, frame } = ctx

  if (args?.phase === 'pick') {
    const hit = findDropdownOption(document, want) || findDropdownOption(doc, want)
    if (!hit) {
      return {
        ok: false,
        error: '未找到下拉选项: ' + String(want).slice(0, 40),
        code: 'no_option',
        data: { hint: SNAPSHOT_HINT },
      }
    }
    const el = hit.el.closest?.('.ant-select-item-option, .el-select-dropdown__item, [role="option"]') || hit.el
    flash(el)
    try {
      el.scrollIntoView({ block: 'nearest' })
    } catch {
      /* ignore */
    }
    el.click?.()
    dispatchPointer(el, window)
    const box = boxOf(el, null)
    return {
      ok: true,
      data: {
        phase: 'pick',
        mode: 'custom_select',
        label: hit.text.slice(0, 80),
        value: String(hit.val || hit.text).slice(0, 80),
        frame,
        x: box.x,
        y: box.y,
        width: box.width,
        height: box.height,
      },
    }
  }

  const got = prepareTarget(args)
  if (!got) return { ok: false, error: '未找到下拉触发器', data: { hint: SNAPSHOT_HINT } }
  let { el } = got
  if (el.tagName === 'SELECT') {
    return fillNativeSelect(el, want, frame)
  }
  el = resolveSelectTrigger(el)
  flash(el)
  el.focus?.()
  try {
    el.click()
  } catch {
    /* ignore */
  }
  dispatchPointer(el, got.win)
  const box = boxOf(el, got.frameEl)
  return {
    ok: true,
    data: {
      phase: 'open',
      mode: 'custom_select',
      frame,
      x: box.x,
      y: box.y,
      needPick: true,
      option: String(want).slice(0, 80),
    },
  }
}
