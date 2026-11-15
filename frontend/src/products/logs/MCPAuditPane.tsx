import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { api } from '../../api/client'
import type { MCPCallLog } from '../../api/types'
import { EmptyState } from '../../components/EmptyState'
import { IconRefresh } from '../../components/Icons'
import { Select, pressProps } from '../../components/compat'
import { useI18n } from '../../i18n'
import { useAppStore } from '../../stores/appStore'
import {
  subscribeWorkbenchChanged,
  takePendingWorkbenchChanged,
  type WorkbenchChangedEvent,
} from '../../workbench/workbenchRadar'
import {
  MCP_ALL_RESOURCE_KEY,
  MCP_ASSET_KINDS,
  MCP_NO_RESOURCE_KEY,
  collectMCPResources,
  filterLogsByResource,
  formatMCPTime,
  groupMCPLogsByIntent,
  mcpCallDetail,
  resourceLabel,
} from './mcpAuditGroup'

/** MCPAuditPane：左资源（默认全部）· 右审计时间倒序 · 折叠 MCP · 雷达刷新。 */
export function MCPAuditPane() {
  const { t } = useI18n()
  const setStatusMessage = useAppStore((s) => s.setStatusMessage)
  const [logs, setLogs] = useState<MCPCallLog[]>([])
  const [loading, setLoading] = useState(false)
  const [intentQ, setIntentQ] = useState('')
  const [resourceKind, setResourceKind] = useState('')
  const [activeResKey, setActiveResKey] = useState(MCP_ALL_RESOURCE_KEY)
  const [openIntents, setOpenIntents] = useState<Record<string, boolean>>({})
  const [openCalls, setOpenCalls] = useState<Record<string, boolean>>({})
  const radarTimer = useRef(0)

  const refresh = useCallback(async (quiet = false) => {
    if (!quiet) setLoading(true)
    try {
      const list = await api.listMCPCallLogs({
        limit: 200,
        intentContains: intentQ.trim() || undefined,
        resourceKind: resourceKind || undefined,
      })
      // Store 已按 at DESC；保持倒序
      setLogs(list)
    } catch (e) {
      setStatusMessage((e as Error).message)
    } finally {
      if (!quiet) setLoading(false)
    }
  }, [intentQ, resourceKind, setStatusMessage])

  useEffect(() => {
    void refresh()
  }, [refresh])

  // 雷达：MCP 调用落盘 → 安静刷新列表
  useEffect(() => {
    const apply = (evt: WorkbenchChangedEvent) => {
      if (evt.domain !== 'logs.mcp') return
      window.clearTimeout(radarTimer.current)
      radarTimer.current = window.setTimeout(() => {
        void refresh(true)
      }, 120)
    }
    for (const evt of takePendingWorkbenchChanged('logs.mcp')) apply(evt)
    const unsub = subscribeWorkbenchChanged(apply)
    return () => {
      unsub()
      window.clearTimeout(radarTimer.current)
    }
  }, [refresh])

  const resources = useMemo(() => collectMCPResources(logs), [logs])

  useEffect(() => {
    if (activeResKey === MCP_ALL_RESOURCE_KEY) return
    if (activeResKey === MCP_NO_RESOURCE_KEY) {
      if (!resources.some((r) => r.key === MCP_NO_RESOURCE_KEY)) {
        setActiveResKey(MCP_ALL_RESOURCE_KEY)
      }
      return
    }
    if (!resources.some((r) => r.key === activeResKey)) {
      setActiveResKey(MCP_ALL_RESOURCE_KEY)
    }
  }, [resources, activeResKey])

  const activeRes = resources.find((r) => r.key === activeResKey)
  const isAll = activeResKey === MCP_ALL_RESOURCE_KEY

  const intentGroups = useMemo(() => {
    const scoped = isAll ? logs : filterLogsByResource(logs, activeResKey)
    return groupMCPLogsByIntent(scoped)
  }, [logs, activeResKey, isAll])

  const callCount = useMemo(() => {
    if (isAll) return logs.length
    return activeRes?.count ?? 0
  }, [isAll, logs.length, activeRes])

  const toggleIntent = (key: string) => {
    setOpenIntents((prev) => ({ ...prev, [key]: !prev[key] }))
  }

  const toggleCall = (id: string) => {
    setOpenCalls((prev) => ({ ...prev, [id]: !prev[id] }))
  }

  const selectResource = (key: string) => {
    setActiveResKey(key)
    setOpenIntents({})
    setOpenCalls({})
  }

  const resTitle = isAll
    ? t('logs.audit.allAudits')
    : activeRes?.key === MCP_NO_RESOURCE_KEY
      ? t('logs.audit.noResource')
      : activeRes
        ? activeRes.label || resourceLabel({ kind: activeRes.kind, id: activeRes.id })
        : t('logs.audit.allAudits')

  return (
    <div className="product-body mcp-audit-body">
      <aside className="app-sidebar logs-sidebar mcp-audit-sidebar">
        <section className="sidebar-section">
          <div className="sidebar-header">
            <span>{t('logs.audit.resources')}</span>
            <button
              type="button"
              className="wn-btn wn-btn-icon wn-btn-sm"
              title={t('logs.refresh')}
              disabled={loading}
              {...pressProps(() => void refresh(), { disabled: loading })}
            >
              <IconRefresh size={14} />
            </button>
          </div>
          <div className="mcp-audit-filters">
            <Select
              value={resourceKind}
              options={[
                { value: '', label: t('logs.audit.allKinds') },
                ...MCP_ASSET_KINDS.map((k) => ({
                  value: k,
                  label: t(`logs.audit.kind.${k}`),
                })),
              ]}
              onChange={setResourceKind}
            />
            <input
              className="wn-input wn-input-sm"
              value={intentQ}
              onChange={(e) => setIntentQ(e.target.value)}
              placeholder={t('logs.audit.intentPh')}
            />
          </div>
          <div className="sidebar-body">
            <ul className="conn-list mcp-audit-res-list">
              <li
                className={`conn-item ${isAll ? 'active' : ''}`}
                {...pressProps(() => selectResource(MCP_ALL_RESOURCE_KEY))}
              >
                <div className="conn-meta">
                  <span className="conn-name">{t('logs.audit.allAudits')}</span>
                  <span className="conn-host">
                    {t('logs.audit.callCount', { count: logs.length })}
                  </span>
                </div>
              </li>
              {resources.map((r) => {
                const title =
                  r.key === MCP_NO_RESOURCE_KEY
                    ? t('logs.audit.noResource')
                    : r.label || resourceLabel({ kind: r.kind, id: r.id })
                const kindLabel =
                  r.key === MCP_NO_RESOURCE_KEY
                    ? t('logs.audit.noResourceKind')
                    : t(`logs.audit.kind.${r.kind}`)
                return (
                  <li
                    key={r.key}
                    className={`conn-item ${r.key === activeResKey ? 'active' : ''}`}
                    {...pressProps(() => selectResource(r.key))}
                  >
                    <div className="conn-meta">
                      <span className="conn-name">{title}</span>
                      <span className="conn-host">
                        {kindLabel} · {r.count}
                      </span>
                    </div>
                  </li>
                )
              })}
            </ul>
            {logs.length === 0 && (
              <EmptyState
                variant="inline"
                title={t('logs.audit.empty')}
                hint={t('logs.audit.emptyHint')}
              />
            )}
          </div>
        </section>
      </aside>

      <main className="app-main logs-main mcp-audit-main">
        <header className="mcp-audit-detail-head">
          <div className="mcp-audit-detail-title">
            <h2>{resTitle}</h2>
            <span className="mcp-audit-meta">
              {t('logs.audit.auditCount', { count: intentGroups.length })} ·{' '}
              {t('logs.audit.callCount', { count: callCount })}
            </span>
          </div>
        </header>

        <div className="mcp-audit-list">
          {intentGroups.length === 0 ? (
            <EmptyState
              variant="inline"
              title={t('logs.audit.emptyAudits')}
              hint={t('logs.audit.emptyAuditsHint')}
            />
          ) : (
            intentGroups.map((g) => {
              const open = !!openIntents[g.key]
              return (
                <section
                  key={g.key}
                  className={`mcp-audit-intent${open ? ' is-open' : ''}${g.failCount ? ' has-fail' : ''}`}
                >
                  <button
                    type="button"
                    className="mcp-audit-intent-head"
                    {...pressProps(() => toggleIntent(g.key))}
                  >
                    <span className={`mcp-audit-caret${open ? ' is-open' : ''}`} aria-hidden>
                      ▸
                    </span>
                    <span className="mcp-audit-intent-main">
                      <span className="mcp-audit-intent-title">
                        {g.intent || t('logs.audit.noIntent')}
                      </span>
                      {isAll &&
                        g.resources.slice(0, 3).map((r) => (
                          <span
                            key={`${r.kind}:${r.id}`}
                            className={`mcp-chip mcp-chip-${r.kind}`}
                            title={resourceLabel(r)}
                          >
                            {resourceLabel(r)}
                          </span>
                        ))}
                      {isAll && g.resources.length > 3 ? (
                        <span className="mcp-chip">+{g.resources.length - 3}</span>
                      ) : null}
                    </span>
                    <span className="mcp-audit-intent-meta">
                      {t('logs.audit.mcpCount', { count: g.count })}
                      {g.failCount > 0 ? ` · ${g.failCount} ERR` : ''}
                      {' · '}
                      {formatMCPTime(g.lastAt)}
                    </span>
                  </button>

                  {open && (
                    <div className="mcp-audit-mcp-fold">
                      {[...g.logs].reverse().map((log) => {
                        const callOpen = !!openCalls[log.id]
                        const detail = mcpCallDetail(log.tool, log.argsSummary)
                        return (
                          <article
                            key={log.id}
                            className={`mcp-audit-row${log.ok ? '' : ' is-fail'}${callOpen ? ' is-open' : ''}`}
                          >
                            <button
                              type="button"
                              className="mcp-audit-row-main"
                              title={detail || log.tool}
                              {...pressProps(() => toggleCall(log.id))}
                            >
                              <span className={`mcp-audit-caret${callOpen ? ' is-open' : ''}`} aria-hidden>
                                ▸
                              </span>
                              <span className={`mcp-audit-ok${log.ok ? '' : ' bad'}`}>
                                {log.ok ? 'OK' : 'ERR'}
                              </span>
                              <span className="mcp-audit-tool-wrap">
                                <span className="mcp-audit-tool">{log.tool}</span>
                                {detail ? <span className="mcp-audit-cmd">{detail}</span> : null}
                              </span>
                              <span className="mcp-audit-dur">{log.durationMs}ms</span>
                              <span className="mcp-audit-at">{formatMCPTime(log.at)}</span>
                            </button>
                            {callOpen && (
                              <div className="mcp-audit-row-detail">
                                {log.error && <p className="mcp-audit-err">{log.error}</p>}
                                <p className="mcp-audit-caller">
                                  {t('logs.audit.caller')}: {log.caller || '—'}
                                  {log.taskSession ? ` · ${log.taskSession}` : ''}
                                </p>
                                {log.argsSummary && (
                                  <pre className="mcp-audit-args">{log.argsSummary}</pre>
                                )}
                              </div>
                            )}
                          </article>
                        )
                      })}
                    </div>
                  )}
                </section>
              )
            })
          )}
        </div>
      </main>
    </div>
  )
}
