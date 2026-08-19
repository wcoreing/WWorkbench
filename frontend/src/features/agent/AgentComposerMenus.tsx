import { useRef, useState } from 'react'
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

/** AgentModeMenu Cursor 风模式切换（Ask / Agent / Plan）。 */
export function AgentModeMenu({ mode, disabled, onChange }: ModeProps) {
  const { t } = useI18n()
  const [open, setOpen] = useState(false)
  const rootRef = useRef<HTMLDivElement>(null)
  useOutsideDismiss(open, () => setOpen(false), [rootRef])

  return (
    <div className="agent-composer-menu-wrap" ref={rootRef}>
      <button
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
      {open && (
        <div className="agent-composer-menu" role="listbox">
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
        </div>
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
  const rootRef = useRef<HTMLDivElement>(null)
  useOutsideDismiss(open, () => setOpen(false), [rootRef])
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
    <div className="agent-composer-menu-wrap" ref={rootRef}>
      <button
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
      {open && (
        <div className="agent-composer-menu agent-composer-menu-model" role="listbox">
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
        </div>
      )}
    </div>
  )
}
