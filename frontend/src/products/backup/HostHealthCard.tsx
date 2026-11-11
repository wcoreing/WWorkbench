import { useEffect, useMemo, useState } from 'react'
import type { HostHealthFinding, HostHealthReport, SSHHost } from '../../api/types'
import { ConfirmDialog } from '../../components/ConfirmDialog'
import { ModalPortal, Select, backdropDismissProps, pressProps } from '../../components/compat'
import { useI18n } from '../../i18n'
import '../../components/ui.css'

type Props = {
  open: boolean
  onClose: () => void
  hosts: SSHHost[]
  hostId: string
  onHostIdChange: (id: string) => void
  workDir: string
  onWorkDirChange: (dir: string) => void
  onBrowseWorkDir: () => void
  report: HostHealthReport | null
  busy: boolean
  onScan: () => void
  onCreateSelected: (findingIds: string[], withCron: boolean) => Promise<void>
}

function severityClass(sev: string) {
  if (sev === 'critical') return 'is-critical'
  if (sev === 'warn') return 'is-warn'
  return 'is-ok'
}

function scoreTone(score: number) {
  if (score >= 85) return 'is-ok'
  if (score >= 60) return 'is-warn'
  return 'is-critical'
}

/** HostHealthModal 指定工作目录扫描，勾选后创建备份策略。 */
export function HostHealthCard({
  open,
  onClose,
  hosts,
  hostId,
  onHostIdChange,
  workDir,
  onWorkDirChange,
  onBrowseWorkDir,
  report,
  busy,
  onScan,
  onCreateSelected,
}: Props) {
  const { t } = useI18n()
  const [selected, setSelected] = useState<Record<string, boolean>>({})
  const [confirmOpen, setConfirmOpen] = useState(false)

  const findings = useMemo(() => report?.findings ?? [], [report])
  const selectable = useMemo(() => findings.filter((f) => f.fixable), [findings])
  const selectedIds = useMemo(
    () => selectable.filter((f) => selected[f.id]).map((f) => f.id),
    [selectable, selected],
  )

  useEffect(() => {
    if (!open) return
    setSelected({})
    setConfirmOpen(false)
  }, [open])

  useEffect(() => {
    setSelected({})
  }, [report?.scannedAt, report?.workDir])

  const toggle = (id: string, on: boolean) => {
    setSelected((prev) => ({ ...prev, [id]: on }))
  }

  const selectAllFixable = (on: boolean) => {
    const next: Record<string, boolean> = {}
    if (on) {
      for (const f of selectable) next[f.id] = true
    }
    setSelected(next)
  }

  if (!open) return null

  const canScan = Boolean(hostId && workDir.trim().startsWith('/'))
  const canCreate = selectedIds.length > 0 && !busy

  return (
    <ModalPortal>
      <div
        className="wn-modal-backdrop wn-modal-backdrop-top"
        {...backdropDismissProps(() => {
          if (!busy) onClose()
        })}
      >
        <div
          className="wn-modal wn-modal-wide host-health-modal"
          onClick={(e) => e.stopPropagation()}
          onPointerDown={(e) => e.stopPropagation()}
          role="dialog"
          aria-labelledby="host-health-modal-title"
        >
          <header className="wn-modal-header-bar">
            <h2 id="host-health-modal-title" className="wn-modal-title">
              {t('backup.healthTitle')}
            </h2>
            <button
              type="button"
              className="wn-modal-close-btn"
              disabled={busy}
              aria-label={t('common.close')}
              {...pressProps(onClose)}
            >
              ×
            </button>
          </header>
          <p className="wn-modal-desc host-health-modal-desc">{t('backup.healthHint')}</p>

          <div className="wn-modal-body host-health-modal-body">
            <div className="host-health-controls host-health-controls-grid">
              <Select
                value={hostId}
                onChange={(id) => onHostIdChange(id)}
                options={[
                  { value: '', label: t('backup.healthPickHost') },
                  ...hosts.map((h) => ({
                    value: h.id,
                    label: `${h.name} · ${h.user}@${h.host}`,
                  })),
                ]}
              />
              <div className="host-health-path-row">
                <input
                  className="wn-input"
                  value={workDir}
                  placeholder={t('backup.healthWorkDirPlaceholder')}
                  onChange={(e) => onWorkDirChange(e.target.value)}
                />
                <button
                  type="button"
                  className="wn-btn wn-btn-sm wn-btn-tool"
                  disabled={busy || !hostId}
                  {...pressProps(onBrowseWorkDir)}
                >
                  {t('backup.browsePath')}
                </button>
                <button
                  type="button"
                  className="wn-btn wn-btn-primary wn-btn-sm"
                  disabled={busy || !canScan}
                  {...pressProps(() => onScan())}
                >
                  {t('backup.healthScan')}
                </button>
              </div>
            </div>

            {report ? (
              <div className="host-health-body">
                <div className={`host-health-score ${scoreTone(report.score)}`}>
                  <span className="host-health-score-num">{report.score}</span>
                  <div className="host-health-score-meta">
                    <div className="host-health-summary">{report.summary || t('backup.healthDone')}</div>
                    <div className="host-health-metrics">
                      <span>
                        {t('backup.healthWorkDir')}: {report.workDir || workDir}
                      </span>
                      <span>
                        {t('backup.healthCovered')}: {report.coveredCount}
                      </span>
                      <span>
                        {t('backup.healthSelectable')}: {report.fixableCount}
                      </span>
                    </div>
                  </div>
                </div>

                {selectable.length > 0 ? (
                  <div className="host-health-select-bar">
                    <label className="wn-check">
                      <input
                        type="checkbox"
                        checked={selectable.length > 0 && selectedIds.length === selectable.length}
                        onChange={(e) => selectAllFixable(e.target.checked)}
                      />
                      {t('backup.healthSelectAll')}
                    </label>
                    <button
                      type="button"
                      className="wn-btn wn-btn-primary wn-btn-sm"
                      disabled={!canCreate}
                      {...pressProps(() => setConfirmOpen(true))}
                    >
                      {t('backup.healthCreateSelected')}
                      {selectedIds.length > 0 ? ` (${selectedIds.length})` : ''}
                    </button>
                  </div>
                ) : null}

                {findings.length === 0 ? (
                  <div className="host-health-empty">{t('backup.healthNoFindings')}</div>
                ) : (
                  <ul className="host-health-findings">
                    {findings.map((f) => (
                      <FindingRow
                        key={f.id}
                        finding={f}
                        checked={Boolean(selected[f.id])}
                        onToggle={(on) => toggle(f.id, on)}
                      />
                    ))}
                  </ul>
                )}
              </div>
            ) : (
              <div className="host-health-empty">{t('backup.healthIdle')}</div>
            )}
          </div>

          <footer className="wn-modal-footer">
            <button type="button" className="wn-btn wn-btn-tool" disabled={busy} {...pressProps(onClose)}>
              {t('common.close')}
            </button>
          </footer>
        </div>
      </div>

      <ConfirmDialog
        open={confirmOpen}
        title={t('backup.healthCreateTitle')}
        message={t('backup.healthCreateMsg', {
          count: String(selectedIds.length),
          dir: report?.workDir || workDir,
        })}
        confirmLabel={t('backup.healthCreateSelected')}
        onConfirm={() => {
          const ids = selectedIds
          setConfirmOpen(false)
          void onCreateSelected(ids, true)
        }}
        onCancel={() => setConfirmOpen(false)}
      />
    </ModalPortal>
  )
}

function FindingRow({
  finding,
  checked,
  onToggle,
}: {
  finding: HostHealthFinding
  checked: boolean
  onToggle: (on: boolean) => void
}) {
  const { t } = useI18n()
  return (
    <li className={`host-health-finding ${severityClass(finding.severity)}`}>
      <div className="host-health-finding-main">
        {finding.fixable ? (
          <label className="wn-check host-health-check">
            <input type="checkbox" checked={checked} onChange={(e) => onToggle(e.target.checked)} />
            <span className="host-health-finding-title">{finding.title}</span>
          </label>
        ) : (
          <span className="host-health-finding-title">{finding.title}</span>
        )}
        {finding.fixable ? null : <span className="host-health-badge">{t('backup.healthCoveredBadge')}</span>}
      </div>
      <div className="host-health-finding-detail">{finding.detail}</div>
    </li>
  )
}
