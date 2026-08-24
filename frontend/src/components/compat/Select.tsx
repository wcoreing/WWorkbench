import { useEffect, useId, useLayoutEffect, useMemo, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { pressProps } from './press'
import { useOutsideDismiss } from './useOutsideDismiss'
import { subscribeDismissOverlays } from './dismissOverlays'
import '../ui.css'

export type SelectOption = {
  value: string
  label: string
  disabled?: boolean
}

export type SelectGroup = {
  label: string
  options: SelectOption[]
}

type Props = {
  id?: string
  className?: string
  value: string
  options: SelectOption[] | SelectGroup[]
  placeholder?: string
  disabled?: boolean
  title?: string
  onChange: (value: string) => void
}

type MenuPos = { top: number; left: number; width: number; maxHeight: number }

/** isGroupedOptions 判断是否为分组选项。 */
function isGroupedOptions(options: SelectOption[] | SelectGroup[]): options is SelectGroup[] {
  return options.length > 0 && 'options' in options[0]
}

/** flattenOptions 展开分组选项，便于查找当前标签。 */
function flattenOptions(options: SelectOption[] | SelectGroup[]): SelectOption[] {
  if (!isGroupedOptions(options)) return options
  return options.flatMap((g) => g.options)
}

/**
 * Select — Compat 下拉（非视觉框架）。
 * 自绘弹出 + useOutsideDismiss，避免原生 select 外点吞第一次点击。
 * 外观仍可用 className 套 wn-* 或其他 UI 框架样式。
 */
export function Select({
  id,
  className = '',
  value,
  options,
  placeholder,
  disabled = false,
  title,
  onChange,
}: Props) {
  const listId = useId()
  const triggerRef = useRef<HTMLButtonElement>(null)
  const menuRef = useRef<HTMLDivElement>(null)
  const [open, setOpen] = useState(false)
  const [pos, setPos] = useState<MenuPos | null>(null)

  const flat = useMemo(() => flattenOptions(options), [options])
  const current = flat.find((o) => o.value === value)
  const label = current?.label || placeholder || ''

  useOutsideDismiss(open, () => setOpen(false), [triggerRef, menuRef])

  useEffect(() => subscribeDismissOverlays(() => setOpen(false)), [])

  /** 触发器被隐藏（切走产品线）时收起，避免 portal 菜单挡在产品轨上。 */
  useEffect(() => {
    if (!open) return
    const el = triggerRef.current
    if (!el) return
    const closeIfHidden = () => {
      const r = el.getBoundingClientRect()
      if (r.width < 1 || r.height < 1) setOpen(false)
    }
    closeIfHidden()
    const ro = new ResizeObserver(closeIfHidden)
    ro.observe(el)
    return () => ro.disconnect()
  }, [open])

  useLayoutEffect(() => {
    if (!open) {
      setPos(null)
      return
    }
    const update = () => {
      const el = triggerRef.current
      if (!el) return
      const r = el.getBoundingClientRect()
      const gap = 4
      const spaceBelow = window.innerHeight - r.bottom - gap - 8
      const spaceAbove = r.top - gap - 8
      const preferBelow = spaceBelow >= 160 || spaceBelow >= spaceAbove
      const maxHeight = Math.max(120, Math.min(280, preferBelow ? spaceBelow : spaceAbove))
      // 菜单可比触发器更宽，避免长 SSH 标签被裁切；并夹到视口内。
      const longest = flat.reduce((m, o) => Math.max(m, (o.label || '').length), 0)
      const contentW = Math.ceil(longest * 7.6 + 36)
      const maxW = Math.max(160, window.innerWidth - 16)
      const width = Math.min(maxW, Math.max(r.width, 140, contentW))
      let left = r.left
      if (left + width > window.innerWidth - 8) {
        left = Math.max(8, window.innerWidth - 8 - width)
      }
      setPos({
        top: preferBelow ? r.bottom + gap : Math.max(8, r.top - gap - maxHeight),
        left,
        width,
        maxHeight,
      })
    }
    update()
    window.addEventListener('resize', update)
    window.addEventListener('scroll', update, true)
    return () => {
      window.removeEventListener('resize', update)
      window.removeEventListener('scroll', update, true)
    }
  }, [open, flat])

  const pick = (next: string) => {
    setOpen(false)
    if (next !== value) onChange(next)
  }

  const triggerClass = ['wn-select', 'wn-select-trigger', className].filter(Boolean).join(' ')

  return (
    <>
      <button
        ref={triggerRef}
        id={id}
        type="button"
        className={triggerClass}
        disabled={disabled}
        title={title}
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-controls={open ? listId : undefined}
        {...pressProps(() => setOpen((v) => !v), { disabled })}
      >
        <span className={`wn-select-label ${current ? '' : 'placeholder'}`}>{label}</span>
        <span className="wn-select-chevron" aria-hidden>
          ▾
        </span>
      </button>
      {open &&
        pos &&
        createPortal(
          <div
            ref={menuRef}
            id={listId}
            className="wn-select-menu"
            role="listbox"
            style={{
              top: pos.top,
              left: pos.left,
              width: pos.width,
              maxHeight: pos.maxHeight,
            }}
          >
            {isGroupedOptions(options)
              ? options.map((g) => (
                  <div key={g.label} className="wn-select-group" role="group" aria-label={g.label}>
                    <div className="wn-select-group-label">{g.label}</div>
                    {g.options.map((opt) => (
                      <SelectItem
                        key={opt.value}
                        option={opt}
                        selected={opt.value === value}
                        onPick={pick}
                      />
                    ))}
                  </div>
                ))
              : options.map((opt) => (
                  <SelectItem
                    key={opt.value}
                    option={opt}
                    selected={opt.value === value}
                    onPick={pick}
                  />
                ))}
          </div>,
          document.body,
        )}
    </>
  )
}

function SelectItem({
  option,
  selected,
  onPick,
}: {
  option: SelectOption
  selected: boolean
  onPick: (value: string) => void
}) {
  return (
    <button
      type="button"
      role="option"
      aria-selected={selected}
      className={`wn-select-option ${selected ? 'selected' : ''}`}
      disabled={option.disabled}
      {...pressProps(() => onPick(option.value), { disabled: option.disabled })}
    >
      {option.label}
    </button>
  )
}
