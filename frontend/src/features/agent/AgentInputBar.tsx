import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { api } from '../../api/client'
import type { Connection, DockerContext, SSHHost } from '../../api/types'
import { mergeMentions } from './agentMention'
import { useI18n } from '../../i18n'
import { AgentMentionPicker } from './AgentMentionPicker'
import { useAgentStore } from '../../stores/agentStore'
import {
  findActiveMentionQuery,
  insertMentionToken,
  type AgentMention,
  type AgentMentionMenuItem,
} from './agentMention'

interface Props {
  busy: boolean
  threadId: string
  autoMentions: AgentMention[]
  threadMentions: AgentMention[]
  onSend: (text: string, mentions: AgentMention[]) => void
  onStop: () => void
}

/** AgentInputBar 对话输入区（@ 提及 SSH / 数据库 / Docker）。 */
export function AgentInputBar({ busy, threadId, autoMentions, threadMentions, onSend, onStop }: Props) {
  const { t } = useI18n()
  const [input, setInput] = useState('')
  const [mentions, setMentions] = useState<AgentMention[]>([])
  const [menuOpen, setMenuOpen] = useState(false)
  const [menuIndex, setMenuIndex] = useState(0)
  const [mentionStart, setMentionStart] = useState(-1)
  const [query, setQuery] = useState('')
  const [hosts, setHosts] = useState<SSHHost[]>([])
  const [connections, setConnections] = useState<Connection[]>([])
  const [dockerContexts, setDockerContexts] = useState<DockerContext[]>([])
  const [resourcesLoaded, setResourcesLoaded] = useState(false)
  const textareaRef = useRef<HTMLTextAreaElement>(null)
  const draftTick = useAgentStore((s) => s.draftTick)

  useEffect(() => {
    if (draftTick === 0) return
    const { draftInput, draftMentions } = useAgentStore.getState()
    setInput(draftInput)
    setMentions(draftMentions)
    setMenuOpen(false)
    requestAnimationFrame(() => textareaRef.current?.focus())
  }, [draftTick])

  const loadResources = useCallback(async () => {
    if (resourcesLoaded) return
    try {
      const [h, c, d] = await Promise.all([
        api.listSSHHosts(),
        api.listConnections(),
        api.listDockerContexts(),
      ])
      setHosts(h)
      setConnections(c)
      setDockerContexts(d)
      setResourcesLoaded(true)
    } catch {
      setHosts([])
      setConnections([])
      setDockerContexts([])
      setResourcesLoaded(true)
    }
  }, [resourcesLoaded])

  const effectiveMentions = useMemo(
    () => mergeMentions(mentions, threadMentions, autoMentions),
    [mentions, threadMentions, autoMentions],
  )

  const runbookMention = effectiveMentions.find((m) => m.kind === 'ssh' || m.kind === 'docker')
  const canRunbook = Boolean(runbookMention)

  const menuItems = useMemo((): AgentMentionMenuItem[] => {
    const q = query.trim().toLowerCase()
    const match = (label: string, sub?: string) => {
      if (!q) return true
      const hay = `${label} ${sub ?? ''}`.toLowerCase()
      return hay.includes(q)
    }
    const sshItems: AgentMentionMenuItem[] = hosts
      .filter((h) => match(h.name || h.host, `${h.user}@${h.host}:${h.port}`))
      .map((h) => ({
        kind: 'ssh' as const,
        id: h.id,
        label: h.name?.trim() || h.host,
        sublabel: `${h.user}@${h.host}:${h.port}`,
      }))
    const dbItems: AgentMentionMenuItem[] = connections
      .filter((c) => match(c.name, `${c.dbType} ${c.host}:${c.port}/${c.database}`))
      .map((c) => ({
        kind: 'database' as const,
        id: c.id,
        label: c.name?.trim() || c.host,
        sublabel: `${c.dbType} · ${c.host}:${c.port}`,
      }))
    const dockerItems: AgentMentionMenuItem[] = dockerContexts
      .filter((ctx) => match(ctx.name, ctx.endpoint))
      .map((ctx) => ({
        kind: 'docker' as const,
        id: ctx.id,
        label: ctx.name,
        sublabel: ctx.kind === 'local' ? 'local' : ctx.endpoint,
      }))
    return [...sshItems, ...dbItems, ...dockerItems].slice(0, 28)
  }, [hosts, connections, dockerContexts, query])

  const syncMentionMenu = useCallback(
    (text: string, cursor: number) => {
      const active = findActiveMentionQuery(text, cursor)
      if (!active) {
        setMenuOpen(false)
        setMentionStart(-1)
        setQuery('')
        return
      }
      void loadResources()
      const sameAt = menuOpen && active.start === mentionStart
      const queryChanged = active.query !== query
      setMentionStart(active.start)
      setQuery(active.query)
      setMenuOpen(true)
      // 仅在新 @ 或筛选变化时重置高亮；避免上下键后 onKeyUp 把选中项打回第一项
      if (!sameAt || queryChanged) {
        setMenuIndex(0)
      }
    },
    [loadResources, menuOpen, mentionStart, query],
  )

  const pickItem = useCallback(
    (item: AgentMentionMenuItem) => {
      const el = textareaRef.current
      const cursor = el?.selectionStart ?? input.length
      const start = mentionStart >= 0 ? mentionStart : cursor
      const { text, cursor: nextCursor } = insertMentionToken(input, start, cursor, item.label)
      setInput(text)
      setMentions((prev) => {
        if (prev.some((m) => m.kind === item.kind && m.id === item.id)) return prev
        return [...prev, { kind: item.kind, id: item.id, label: item.label, sublabel: item.sublabel }]
      })
      setMenuOpen(false)
      setMentionStart(-1)
      setQuery('')
      requestAnimationFrame(() => {
        if (!textareaRef.current) return
        textareaRef.current.focus()
        textareaRef.current.selectionStart = nextCursor
        textareaRef.current.selectionEnd = nextCursor
      })
    },
    [input, mentionStart],
  )

  const removeMention = (id: string, kind: AgentMention['kind']) => {
    setMentions((prev) => prev.filter((m) => !(m.id === id && m.kind === kind)))
  }

  const addMention = (item: AgentMentionMenuItem) => {
    setMentions((prev) => {
      if (prev.some((m) => m.kind === item.kind && m.id === item.id)) return prev
      return [...prev, { kind: item.kind, id: item.id, label: item.label, sublabel: item.sublabel }]
    })
  }

  const pendingAuto = useMemo(() => {
    return autoMentions.filter(
      (a) => !mentions.some((m) => m.kind === a.kind && m.id === a.id),
    )
  }, [autoMentions, mentions])

  const send = () => {
    const text = input.trim()
    if (!text || busy) return
    onSend(text, mergeMentions(mentions, threadMentions))
    setInput('')
    setMentions([])
    setMenuOpen(false)
  }

  useEffect(() => {
    if (menuItems.length === 0) return
    if (menuIndex >= menuItems.length) {
      setMenuIndex(menuItems.length - 1)
    }
  }, [menuItems.length, menuIndex])

  return (
    <footer className="agent-input-bar">
      {threadMentions.length > 0 && (
        <div className="agent-mention-chips agent-mention-chips-thread">
          <span className="agent-thread-mentions-label">{t('agent.threadMentions')}</span>
          {threadMentions.map((m) => (
            <span key={`t-${m.kind}-${m.id}`} className={`agent-mention-chip agent-mention-chip-${m.kind}`}>
              <span className="agent-mention-chip-kind">
                {m.kind === 'ssh'
                  ? 'SSH'
                  : m.kind === 'docker'
                    ? 'DK'
                    : m.kind === 'log'
                      ? 'LOG'
                      : m.kind === 'http'
                        ? 'API'
                        : 'DB'}
              </span>
              <span className="agent-mention-chip-label">{m.label}</span>
            </span>
          ))}
        </div>
      )}
      {pendingAuto.length > 0 && (
        <p className="agent-auto-hint">
          {t('agent.attachOnSend')}:{' '}
          {pendingAuto.map((m) => (
            <span key={`${m.kind}-${m.id}`} className="agent-auto-hint-item">
              {m.kind === 'ssh' ? 'SSH' : m.kind === 'docker' ? 'DK' : 'DB'} {m.label}
            </span>
          ))}
        </p>
      )}
      {mentions.length > 0 && (
        <div className="agent-mention-chips">
          {mentions.map((m) => (
            <span key={`${m.kind}-${m.id}`} className={`agent-mention-chip agent-mention-chip-${m.kind}`}>
              <span className="agent-mention-chip-kind">
                {m.kind === 'ssh'
                  ? 'SSH'
                  : m.kind === 'docker'
                    ? 'DK'
                    : m.kind === 'log'
                      ? 'LOG'
                      : m.kind === 'http'
                        ? 'API'
                        : 'DB'}
              </span>
              <span className="agent-mention-chip-label">{m.label}</span>
              <button
                type="button"
                className="agent-mention-chip-remove"
                aria-label={t('agent.mentionRemove')}
                onClick={() => removeMention(m.id, m.kind)}
              >
                ×
              </button>
            </span>
          ))}
        </div>
      )}
      <div className="agent-input-wrap">
        <AgentMentionPicker
          open={menuOpen}
          items={menuItems}
          activeIndex={menuIndex}
          onPick={pickItem}
          onHoverIndex={setMenuIndex}
        />
        <textarea
          ref={textareaRef}
          className="wn-input agent-input"
          value={input}
          onChange={(e) => {
            setInput(e.target.value)
            syncMentionMenu(e.target.value, e.target.selectionStart ?? e.target.value.length)
          }}
          onClick={(e) =>
            syncMentionMenu(
              (e.target as HTMLTextAreaElement).value,
              (e.target as HTMLTextAreaElement).selectionStart ?? 0,
            )
          }
          placeholder={t('agent.inputPlaceholder')}
          rows={3}
          onKeyDown={(e) => {
            if (menuOpen && menuItems.length > 0) {
              if (e.key === 'ArrowDown') {
                e.preventDefault()
                setMenuIndex((i) => (i + 1) % menuItems.length)
                return
              }
              if (e.key === 'ArrowUp') {
                e.preventDefault()
                setMenuIndex((i) => (i - 1 + menuItems.length) % menuItems.length)
                return
              }
              if (e.key === 'Tab' || e.key === 'Enter') {
                e.preventDefault()
                pickItem(menuItems[menuIndex] ?? menuItems[0])
                return
              }
              if (e.key === 'Escape') {
                e.preventDefault()
                setMenuOpen(false)
                return
              }
            }
            if (e.key === 'Enter' && !e.shiftKey) {
              e.preventDefault()
              send()
            }
          }}
        />
      </div>
      <div className="agent-input-actions">
        {autoMentions[0] && (
          <button
            type="button"
            className="wn-btn wn-btn-xs wn-btn-ghost"
            disabled={busy || mentions.some((m) => m.id === autoMentions[0].id && m.kind === autoMentions[0].kind)}
            onClick={() => addMention(autoMentions[0])}
          >
            {t('agent.attachCurrent')}
          </button>
        )}
        {canRunbook && (
          <button
            type="button"
            className="wn-btn wn-btn-xs wn-btn-ghost"
            disabled={busy}
            onClick={() => {
              const prompt =
                runbookMention?.kind === 'docker'
                  ? t('agent.runbookPromptDocker')
                  : t('agent.runbookPrompt')
              onSend(prompt, mergeMentions(mentions, threadMentions))
              setInput('')
              setMenuOpen(false)
            }}
          >
            {t('agent.runbook')}
          </button>
        )}
        <div className="agent-input-actions-main">
          {busy && threadId && (
            <button type="button" className="wn-btn wn-btn-sm wn-btn-ghost" onClick={onStop}>
              {t('agent.stop')}
            </button>
          )}
          <button
            type="button"
            className="wn-btn wn-btn-sm wn-btn-primary"
            disabled={busy || !input.trim()}
            onClick={send}
          >
            {t('agent.send')}
          </button>
        </div>
      </div>
    </footer>
  )
}
