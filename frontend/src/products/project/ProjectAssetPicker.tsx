import { useEffect, useMemo, useState } from 'react'
import { api } from '../../api/client'
import type {
  BackupPolicy,
  Connection,
  DockerContext,
  HTTPSavedRequest,
  LogSource,
  NoteSummary,
  SSHHost,
  WorkbenchProjectLink,
} from '../../api/types'
import { ModalPortal, backdropDismissProps, pressProps } from '../../components/compat'
import { useI18n } from '../../i18n'
import { notify } from '../../notify'

export type ProjectAssetKind =
  | 'ssh'
  | 'database'
  | 'docker'
  | 'log'
  | 'http'
  | 'note'
  | 'skill'
  | 'backup'

type PickRow = { id: string; label: string; sublabel?: string; pinKind?: WorkbenchProjectLink['kind'] }

const KINDS: ProjectAssetKind[] = ['ssh', 'database', 'docker', 'log', 'http', 'note', 'skill', 'backup']

function kindLabelKey(kind: ProjectAssetKind): string {
  switch (kind) {
    case 'ssh':
      return 'project.kindSsh'
    case 'database':
      return 'project.kindDatabase'
    case 'docker':
      return 'project.kindDocker'
    case 'log':
      return 'project.kindLog'
    case 'http':
      return 'project.kindHttp'
    case 'note':
      return 'project.kindNote'
    case 'skill':
      return 'project.kindSkill'
    case 'backup':
      return 'project.kindBackup'
  }
}

type Props = {
  open: boolean
  linked: WorkbenchProjectLink[]
  onPick: (link: WorkbenchProjectLink) => void
  onClose: () => void
}

/** ProjectAssetPicker 在项目页内挑选钉入资源（无需切产品线拖拽）。 */
export function ProjectAssetPicker({ open, linked, onPick, onClose }: Props) {
  const { t } = useI18n()
  const [kind, setKind] = useState<ProjectAssetKind>('ssh')
  const [q, setQ] = useState('')
  const [busy, setBusy] = useState(false)
  const [hosts, setHosts] = useState<SSHHost[]>([])
  const [connections, setConnections] = useState<Connection[]>([])
  const [dockers, setDockers] = useState<DockerContext[]>([])
  const [logs, setLogs] = useState<LogSource[]>([])
  const [https, setHttps] = useState<HTTPSavedRequest[]>([])
  const [notes, setNotes] = useState<NoteSummary[]>([])
  const [backups, setBackups] = useState<BackupPolicy[]>([])

  useEffect(() => {
    if (!open) return
    setBusy(true)
    void Promise.all([
      api.listSSHHosts(),
      api.listConnections(),
      api.listDockerContexts(),
      api.listLogSources(),
      api.listHTTPRequests(),
      api.listNotes(),
      api.listBackupPolicies(),
    ])
      .then(([h, c, d, l, r, n, b]) => {
        setHosts(h as SSHHost[])
        setConnections(c as Connection[])
        setDockers(d as DockerContext[])
        setLogs(l as LogSource[])
        setHttps(r as HTTPSavedRequest[])
        setNotes(n as NoteSummary[])
        setBackups(b as BackupPolicy[])
      })
      .catch((e) => notify.error((e as Error).message))
      .finally(() => setBusy(false))
  }, [open])

  const linkedSet = useMemo(() => new Set(linked.map((l) => `${l.kind}:${l.id}`)), [linked])

  const rows: PickRow[] = useMemo(() => {
    switch (kind) {
      case 'ssh':
        return hosts.map((h) => ({
          id: h.id,
          label: h.name || h.host,
          sublabel: `${h.user}@${h.host}:${h.port}`,
        }))
      case 'database':
        return connections.map((c) => ({
          id: c.id,
          label: c.name || c.host,
          sublabel: `${c.dbType} · ${c.host}:${c.port}`,
        }))
      case 'docker':
        return dockers.map((d) => ({
          id: d.id,
          label: d.name || d.id,
          sublabel: d.endpoint || d.kind,
        }))
      case 'log':
        return logs.map((l) => ({
          id: l.id,
          label: l.name || l.path || l.id,
          sublabel: l.sourceType,
        }))
      case 'http':
        return https.map((r) => ({
          id: r.id,
          label: r.name || r.url,
          sublabel: `${r.method} ${r.url}`,
        }))
      case 'note':
        return notes
          .filter((n) => n.role !== 'skill')
          .map((n) => ({
            id: n.id,
            label: n.title || n.id,
            sublabel: [n.role, n.language].filter(Boolean).join(' · '),
          }))
      case 'skill':
        return notes
          .filter((n) => n.role === 'skill')
          .map((n) => ({
            id: n.id,
            label: n.title || n.id,
            sublabel: n.id,
            pinKind: 'skill',
          }))
      case 'backup':
        return backups.map((p) => ({
          id: p.id,
          label: p.name || p.path || p.id,
          sublabel: p.kind,
        }))
    }
  }, [kind, hosts, connections, dockers, logs, https, notes, backups])

  const filtered = useMemo(() => {
    const query = q.trim().toLowerCase()
    if (!query) return rows
    return rows.filter(
      (r) =>
        r.label.toLowerCase().includes(query) ||
        (r.sublabel || '').toLowerCase().includes(query) ||
        r.id.toLowerCase().includes(query),
    )
  }, [rows, q])

  if (!open) return null

  return (
    <ModalPortal>
      <div className="wn-modal-backdrop wn-modal-backdrop-top" {...backdropDismissProps(onClose)}>
        <div
          className="wn-modal project-asset-picker"
          role="dialog"
          aria-modal="true"
          aria-labelledby="project-asset-picker-title"
          onClick={(e) => e.stopPropagation()}
        >
          <header className="wn-modal-header">
            <h2 id="project-asset-picker-title" className="wn-modal-title">
              {t('project.addResource')}
            </h2>
            <p className="wn-modal-desc">{t('project.addResourceHint')}</p>
          </header>
          <div className="wn-modal-body project-asset-picker-body">
            <div className="project-asset-kind-tabs" role="tablist">
              {KINDS.map((k) => (
                <button
                  key={k}
                  type="button"
                  role="tab"
                  aria-selected={kind === k}
                  className={`wn-btn wn-btn-sm wn-btn-tool${kind === k ? ' is-active' : ''}`}
                  {...pressProps(() => {
                    setKind(k)
                    setQ('')
                  })}
                >
                  {t(kindLabelKey(k))}
                </button>
              ))}
            </div>
            <input
              className="project-asset-search"
              value={q}
              placeholder={t('project.searchResource')}
              onChange={(e) => setQ(e.target.value)}
            />
            <ul className="project-asset-pick-list">
              {busy ? (
                <li className="project-asset-pick-empty">{t('common.loading')}</li>
              ) : filtered.length === 0 ? (
                <li className="project-asset-pick-empty">{t('project.noResources')}</li>
              ) : (
                filtered.map((row) => {
                  const pinKind = row.pinKind || kind
                  const pinned = linkedSet.has(`${pinKind}:${row.id}`)
                  return (
                    <li key={`${pinKind}:${row.id}`}>
                      <button
                        type="button"
                        className={`project-asset-pick-row${pinned ? ' is-pinned' : ''}`}
                        disabled={pinned}
                        {...pressProps(() => {
                          if (pinned) return
                          onPick({ kind: pinKind, id: row.id, label: row.label })
                        })}
                      >
                        <span className="project-asset-pick-label">{row.label}</span>
                        {row.sublabel ? <span className="project-asset-pick-sub">{row.sublabel}</span> : null}
                        <span className="project-asset-pick-action">
                          {pinned ? t('project.alreadyPinned') : t('project.pin')}
                        </span>
                      </button>
                    </li>
                  )
                })
              )}
            </ul>
          </div>
          <footer className="wn-modal-footer">
            <button type="button" className="wn-btn wn-btn-sm" {...pressProps(onClose)}>
              {t('common.close')}
            </button>
          </footer>
        </div>
      </div>
    </ModalPortal>
  )
}
