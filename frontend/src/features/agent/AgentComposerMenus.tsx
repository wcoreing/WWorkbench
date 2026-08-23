import { useLayoutEffect, useRef, useState, type CSSProperties, type RefObject } from 'react'
import { createPortal } from 'react-dom'
import { useOutsideDismiss } from '../../components/compat/useOutsideDismiss'
import { useI18n } from '../../i18n'
import {
  AGENT_CHAT_MODES,
  composeModelOptions,
  type AgentChatMode,
} from './agentChatMode'

interface ModeProps {
  mode: AgentChatMode
  disabled?: boolean
  onChange: (mode: AgentChatMode) => void
}

/** 贴触发器上方弹出（Cursor 同款）：bottom 锚定，左对齐。 */
type MenuPos = { left: number; bottom: number; minWidth: number; maxHeight: number }

/** useAnchoredMenu 将下拉挂到 body；底边贴触发器顶边，左边对齐触发器。 */
function useAnchoredMenu(open: boolean, triggerRef: RefObject<HTMLElement | null>) {
  const [pos, setPos] = useState<MenuPos | null>(null)

  useLayoutEffect(() => {
    if (!open) {
      setPos(null)
      return
    }
    const update = () => {
      const el = triggerRef.current
      if (!el) return
      const r = el.getBoundingClientRect()
      const gap = 6
      const pad = 8
      const maxHeight = Math.max(120, Math.min(320, r.top - gap - pad))
      const minWidth = Math.max(r.width, 180)
      let left = r.left
      if (left + minWidth > window.innerWidth - pad) {
        left = Math.max(pad, window.innerWidth - pad - minWidth)
      }
      if (left < pad) left = pad
      setPos({
        left,
        bottom: Math.max(pad, window.innerHeight - r.top + gap),
        minWidth,
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
  }, [open, triggerRef])

  return pos
}

function menuStyle(pos: MenuPos): CSSProperties {
  return {
    left: pos.left,
    bottom: pos.bottom,
    top: 'auto',
    minWidth: pos.minWidth,
    maxHeight: pos.maxHeight,
    overflowY: 'auto',
  }
}

/** AgentModeMenu Cursor 风模式切换（Ask / Agent / Plan）。 */
export function AgentModeMenu({ mode, disabled, onChange }: ModeProps) {
  const { t } = useI18n()
  const [open, setOpen] = useState(false)
  const triggerRef = useRef<HTMLButtonElement>(null)
  const menuRef = useRef<HTMLDivElement>(null)
  useOutsideDismiss(open, () => setOpen(false), [triggerRef, menuRef])
  const pos = useAnchoredMenu(open, triggerRef)

  return (
    <div className="agent-composer-menu-wrap">
      <button
        ref={triggerRef}
        type="button"
        className="agent-composer-chip"
        disabled={disabled}
        aria-haspopup="listbox"
        aria-expanded={open}
        title={t(`agent.modeHint${mode[0].toUpperCase()}${mode.slice(1)}`)}
        onClick={() => setOpen((v) => !v)}
      >
        <span className="agent-composer-chip-label">{t(`agent.mode${mode[0].toUpperCase()}${mode.slice(1)}`)}</span>
        <span className="agent-composer-caret" aria-hidden>
          ▾
        </span>
      </button>
      {open &&
        pos &&
        createPortal(
          <div
            ref={menuRef}
            className="agent-composer-menu agent-composer-menu-portal"
            role="listbox"
            style={menuStyle(pos)}
          >
            {AGENT_CHAT_MODES.map((id) => (
              <button
                key={id}
                type="button"
                role="option"
                aria-selected={id === mode}
                className={`agent-composer-option${id === mode ? ' is-active' : ''}`}
                onMouseDown={(e) => {
                  e.preventDefault()
                  onChange(id)
                  setOpen(false)
                }}
              >
                <span className="agent-composer-option-title">{t(`agent.mode${id[0].toUpperCase()}${id.slice(1)}`)}</span>
                <span className="agent-composer-option-hint">{t(`agent.modeHint${id[0].toUpperCase()}${id.slice(1)}`)}</span>
              </button>
            ))}
          </div>,
          document.body,
        )}
    </div>
  )
}

interface ModelProps {
  modelName: string
  provider: string
  disabled?: boolean
  onChange: (model: string) => void
}

/** AgentModelMenu 当前服务商下的模型快选（可自定义）。 */
export function AgentModelMenu({ modelName, provider, disabled, onChange }: ModelProps) {
  const { t } = useI18n()
  const [open, setOpen] = useState(false)
  const [custom, setCustom] = useState('')
  const triggerRef = useRef<HTMLButtonElement>(null)
  const menuRef = useRef<HTMLDivElement>(null)
  useOutsideDismiss(open, () => setOpen(false), [triggerRef, menuRef])
  const pos = useAnchoredMenu(open, triggerRef)
  const options = composeModelOptions(modelName, provider)
  const label = modelName.trim() || t('agent.model')

  const pick = (id: string) => {
    const v = id.trim()
    if (!v) return
    onChange(v)
    setOpen(false)
    setCustom('')
  }

  return (
    <div className="agent-composer-menu-wrap">
      <button
        ref={triggerRef}
        type="button"
        className="agent-composer-chip"
        disabled={disabled}
        aria-haspopup="listbox"
        aria-expanded={open}
        title={label}
        onClick={() => setOpen((v) => !v)}
      >
        <span className="agent-composer-chip-label">{label}</span>
        <span className="agent-composer-caret" aria-hidden>
          ▾
        </span>
      </button>
      {open &&
        pos &&
        createPortal(
          <div
            ref={menuRef}
            className="agent-composer-menu agent-composer-menu-portal agent-composer-menu-model"
            role="listbox"
            style={menuStyle(pos)}
          >
            {options.map((id) => (
              <button
                key={id}
                type="button"
                role="option"
                aria-selected={id === modelName}
                className={`agent-composer-option${id === modelName ? ' is-active' : ''}`}
                onMouseDown={(e) => {
                  e.preventDefault()
                  pick(id)
                }}
              >
                <span className="agent-composer-option-title">{id}</span>
              </button>
            ))}
            <form
              className="agent-composer-custom"
              onSubmit={(e) => {
                e.preventDefault()
                pick(custom)
              }}
            >
              <input
                className="wn-input agent-composer-custom-input"
                value={custom}
                placeholder={t('agent.modelCustom')}
                onChange={(e) => setCustom(e.target.value)}
              />
              <button type="submit" className="wn-btn wn-btn-xs wn-btn-ghost" disabled={!custom.trim()}>
                {t('common.confirm')}
              </button>
            </form>
          </div>,
          document.body,
        )}
    </div>
  )
}
