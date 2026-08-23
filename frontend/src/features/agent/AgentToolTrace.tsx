import { useState } from 'react'
import { useI18n } from '../../i18n'
import type { AgentToolStep } from '../../stores/agentStore'

interface Props {
  steps: AgentToolStep[]
}

function statusLabel(status: AgentToolStep['status'], t: (k: string) => string): string {
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
      return status
  }
}

/** AgentToolTrace 展示本轮对话的工具调用时间线（须展示成败，勿一律「完成」）。 */
export function AgentToolTrace({ steps }: Props) {
  const { t } = useI18n()
  const [open, setOpen] = useState(true)

  if (steps.length === 0) return null

  const running = steps.some((s) => s.status === 'running')

  return (
    <div className={`agent-tool-trace${open ? ' is-open' : ''}`}>
      <button
        type="button"
        className="agent-tool-trace-toggle"
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
      >
        <span className="agent-tool-trace-title">
          {running ? t('agent.traceRunning') : t('agent.traceTitle')}
        </span>
        <span className="agent-tool-trace-count">{steps.length}</span>
        <span className="agent-tool-trace-chevron" aria-hidden>
          <span className={`tree-chevron${open ? ' is-open' : ''}`} />
        </span>
      </button>
      {open && (
        <ol className="agent-tool-trace-list">
          {steps.map((step) => (
            <li key={step.id} className={`agent-tool-trace-item agent-tool-trace-${step.status}`}>
              <span className="agent-tool-trace-name">{step.tool}</span>
              {(step.summary || step.argsPreview) && (
                <span className="agent-tool-trace-args" title={step.summary || step.argsPreview}>
                  {step.summary || step.argsPreview}
                </span>
              )}
              <span className="agent-tool-trace-status">{statusLabel(step.status, t)}</span>
            </li>
          ))}
        </ol>
      )}
    </div>
  )
}
