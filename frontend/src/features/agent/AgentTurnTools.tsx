import { useEffect, useMemo, useState } from 'react'
import { useI18n } from '../../i18n'
import type { AgentToolStep } from '../../stores/agentStore'
import { previewToolArgs } from './agentToolPreview'

interface Props {
  tools: AgentToolStep[]
  /** 当前回合是否仍在跑工具（用于环境组） */
  live?: boolean
}

const ENV_TOOLS = new Set(['cursor_bridge', 'mcp'])

function normalizeStatus(status: AgentToolStep['status']): AgentToolStep['status'] {
  if (status === 'need_confirm') return 'ok'
  return status
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
    case 'need_choice':
      return t('agent.traceStepNeedChoice')
    default:
      return status || ''
  }
}

function isEnvTool(name: string): boolean {
  return ENV_TOOLS.has(name) || name.startsWith('mcp')
}

function StatusGlyph({ status }: { status: AgentToolStep['status'] }) {
  if (status === 'running') {
    return <span className="agent-turn-tool-spinner" aria-hidden />
  }
  if (status === 'ok') {
    return (
      <span className="agent-turn-tool-glyph agent-turn-tool-glyph-ok" aria-hidden>
        ✓
      </span>
    )
  }
  if (status === 'error' || status === 'denied') {
    return (
      <span className="agent-turn-tool-glyph agent-turn-tool-glyph-err" aria-hidden>
        !
      </span>
    )
  }
  if (status === 'need_choice') {
    return (
      <span className="agent-turn-tool-glyph agent-turn-tool-glyph-choice" aria-hidden>
        ?
      </span>
    )
  }
  return <span className="agent-turn-tool-glyph" aria-hidden />
}

function ToolRow({
  step,
  open,
  onToggle,
  t,
}: {
  step: AgentToolStep
  open: boolean
  onToggle: () => void
  t: (k: string) => string
}) {
  const status = normalizeStatus(step.status)
  const hint = previewToolArgs(step.argsPreview)
  const summary = step.summary
  const shotImages = step.images?.filter((img) => img.data) ?? []
  const teach = step.teach
  const suggested = step.suggestedSkill
  const hasTeach = Boolean(teach?.summary?.trim() || (teach?.nextSteps && teach.nextSteps.length))
  const hasDetail =
    Boolean(step.argsPreview?.trim()) ||
    Boolean(summary?.trim()) ||
    shotImages.length > 0 ||
    hasTeach ||
    Boolean(suggested?.name)
  const showBody = open && hasDetail

  return (
    <div className={`agent-turn-tool agent-turn-tool-${status}${open ? ' is-open' : ''}`}>
      <button
        type="button"
        className="agent-turn-tool-head"
        onClick={() => {
          if (hasDetail) onToggle()
        }}
        aria-expanded={hasDetail ? open : undefined}
        aria-disabled={!hasDetail || undefined}
        disabled={!hasDetail}
      >
        {hasDetail ? (
          <span className={`tree-chevron${open ? ' is-open' : ''}`} aria-hidden />
        ) : (
          <StatusGlyph status={status} />
        )}
        {hasDetail ? <StatusGlyph status={status} /> : null}
        <span className="agent-turn-tool-name">{step.tool}</span>
        {hint ? (
          <span className="agent-turn-tool-hint" title={hint}>
            {hint}
          </span>
        ) : null}
        <span className="agent-turn-tool-status">{statusLabel(status, t)}</span>
      </button>
      {showBody && (
        <div className="agent-turn-tool-body">
          {step.argsPreview?.trim() ? (
            <pre className="agent-turn-tool-pre">{step.argsPreview}</pre>
          ) : null}
          {summary && summary !== step.argsPreview ? (
            <pre className="agent-turn-tool-pre">{summary}</pre>
          ) : null}
          {hasTeach ? (
            <div className="agent-turn-teach">
              {teach?.summary ? <p className="agent-turn-teach-summary">{teach.summary}</p> : null}
              {teach?.nextSteps && teach.nextSteps.length > 0 ? (
                <ol className="agent-turn-teach-steps">
                  {teach.nextSteps.map((s) => (
                    <li key={s}>{s}</li>
                  ))}
                </ol>
              ) : null}
            </div>
          ) : null}
          {suggested?.name ? (
            <p className="agent-turn-skill-hint">
              {t('agent.teachSuggestedSkill')}: {suggested.name}
              {suggested.offerPrompt ? ` — ${suggested.offerPrompt}` : ''}
            </p>
          ) : null}
          {shotImages.length > 0 ? (
            <div className="agent-msg-images agent-tool-shot-images">
              {shotImages.map((img, i) => (
                <span key={`${img.mime}-${i}`} className="agent-image-draft">
                  <img src={img.data.startsWith('data:') ? img.data : `data:${img.mime};base64,${img.data}`} alt="" />
                </span>
              ))}
            </div>
          ) : null}
        </div>
      )}
    </div>
  )
}

/** AgentTurnTools：按调用先后列出；不限高，随对话区自然滚动。 */
export function AgentTurnTools({ tools, live }: Props) {
  const { t } = useI18n()
  const [openMap, setOpenMap] = useState<Record<string, boolean>>({})
  const [envOpen, setEnvOpen] = useState(false)

  const { main, env, envRunning } = useMemo(() => {
    const mainSteps: AgentToolStep[] = []
    const envSteps: AgentToolStep[] = []
    let envRun = false
    for (const step of tools) {
      const st = normalizeStatus(step.status)
      if (isEnvTool(step.tool)) {
        envSteps.push(step)
        if (st === 'running') envRun = true
        continue
      }
      mainSteps.push(step)
    }
    return { main: mainSteps, env: envSteps, envRunning: envRun }
  }, [tools])

  useEffect(() => {
    if (live && envRunning && main.length === 0) {
      setEnvOpen(false)
    }
  }, [live, envRunning, main.length])

  if (!tools.length) return null

  const toggle = (id: string) => {
    setOpenMap((m) => ({ ...m, [id]: !m[id] }))
  }

  const isOpen = (step: AgentToolStep) => {
    if (openMap[step.id] !== undefined) return openMap[step.id]
    const st = normalizeStatus(step.status)
    if (st === 'running' || st === 'error' || st === 'denied' || st === 'need_choice') return true
    return Boolean(step.teach?.summary || step.suggestedSkill?.name)
  }

  const renderList = (list: AgentToolStep[]) =>
    list.map((step) => (
      <ToolRow
        key={step.id}
        step={step}
        open={isOpen(step)}
        onToggle={() => toggle(step.id)}
        t={t}
      />
    ))

  return (
    <div className="agent-turn-tools">
      {renderList(main)}
      {env.length > 0 && (
        <div className={`agent-turn-tool-group${envOpen ? ' is-open' : ''}`}>
          <button
            type="button"
            className="agent-turn-tool-head agent-turn-tool-group-head"
            onClick={() => setEnvOpen((v) => !v)}
            aria-expanded={envOpen}
          >
            <span className={`tree-chevron${envOpen ? ' is-open' : ''}`} aria-hidden />
            <span className="agent-turn-tool-name">{t('agent.toolGroupEnv')}</span>
            <span className="agent-turn-tool-status">{env.length}</span>
          </button>
          {envOpen ? <div className="agent-turn-tool-group-body">{renderList(env)}</div> : null}
        </div>
      )}
    </div>
  )
}
