import { useState } from 'react'
import { useI18n } from '../../i18n'
import type { AgentToolStep } from '../../stores/agentStore'

interface Props {
  tools: AgentToolStep[]
}

function statusLabel(status: AgentToolStep['status'] | '', t: (k: string) => string): string {
  switch (status) {
    case 'running':
      return t('agent.traceStepRunning')
    case 'ok':
      return t('agent.traceStepOk')
    case 'error':
      return t('agent.traceStepError')
    case 'denied':
      return t('agent.traceStepDenied')
    case 'need_confirm':
      return t('agent.traceStepNeedConfirm')
    case 'need_choice':
      return t('agent.traceStepNeedChoice')
    default:
      return status || ''
  }
}

function previewArgs(args?: string): string {
  const s = (args || '').trim()
  if (!s) return ''
  try {
    const j = JSON.parse(s) as Record<string, unknown>
    const keys = Object.keys(j)
    if (keys.length === 1 && typeof j[keys[0]] === 'string') {
      const v = String(j[keys[0]])
      return v.length > 48 ? `${v.slice(0, 48)}…` : v
    }
  } catch {
    /* plain */
  }
  return s.length > 48 ? `${s.slice(0, 48)}…` : s
}

/** AgentTurnTools Cursor/AgentDesk 风：挂在助手气泡下的可折叠工具条。 */
export function AgentTurnTools({ tools }: Props) {
  const { t } = useI18n()
  const [openMap, setOpenMap] = useState<Record<string, boolean>>({})

  if (!tools.length) return null

  const toggle = (id: string) => {
    setOpenMap((m) => ({ ...m, [id]: !m[id] }))
  }

  const isOpen = (step: AgentToolStep) => {
    if (openMap[step.id] !== undefined) return openMap[step.id]
    // 默认折叠；失败 / 待确认 / 执行中展开
    return step.status === 'error' || step.status === 'denied' || step.status === 'need_confirm' || step.status === 'need_choice' || step.status === 'running'
  }

  return (
    <div className="agent-turn-tools">
      {tools.map((step) => {
        const open = isOpen(step)
        const hint = step.summary || previewArgs(step.argsPreview)
        return (
          <div
            key={step.id}
            className={`agent-turn-tool agent-turn-tool-${step.status}${open ? ' is-open' : ''}`}
          >
            <button
              type="button"
              className="agent-turn-tool-head"
              onClick={() => toggle(step.id)}
              aria-expanded={open}
            >
              <span className={`tree-chevron${open ? ' is-open' : ''}`} aria-hidden />
              <span className="agent-turn-tool-name">{step.tool}</span>
              {hint ? (
                <span className="agent-turn-tool-hint" title={hint}>
                  {hint}
                </span>
              ) : null}
              <span className="agent-turn-tool-status">
                {statusLabel(step.status, t) || (step.status === 'running' ? '…' : '')}
              </span>
            </button>
            {open && (step.argsPreview || step.summary) && (
              <div className="agent-turn-tool-body">
                {step.argsPreview ? (
                  <pre className="agent-turn-tool-pre">{step.argsPreview}</pre>
                ) : null}
                {step.summary && step.summary !== step.argsPreview ? (
                  <pre className="agent-turn-tool-pre">{step.summary}</pre>
                ) : null}
              </div>
            )}
          </div>
        )
      })}
    </div>
  )
}
