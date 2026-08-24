import { useEffect, useMemo, useRef, useState } from 'react'
import type { RuntimeInfo, RuntimeLang, RuntimeVersion } from '../../api/types'
import { api } from '../../api/client'
import { onEnvInstallLog } from '../../api/envInstallEvents'
import { LoadingPane } from '../../components/LoadingHost'
import { useI18n } from '../../i18n'
import { useLoading } from '../../stores/loadingStore'
import '../../components/ui.css'

const versionLoadingKey = (lang: RuntimeLang) => `environment.versions.${lang}`

const VERSION_HINT: Record<RuntimeLang, string> = {
  node: '例如 20、20.11.0、lts',
  go: '例如 1.22.3',
  php: '例如 5.6、7.4、8.3 或 8.3.33',
  java: '例如 21、17（Temurin 主版本）',
}

const MANAGER_DESC: Record<RuntimeLang, string> = {
  node: '通过 nvm / nvm-windows 管理多个 Node.js 版本',
  go: 'WWorkbench 自管官方 Go（或 macOS goenv）',
  php: 'macOS 用 Homebrew 多版本；Linux 用系统包管理器（apt/dnf）；Windows 用官方包',
  java: '本机/远端均可装 Temurin；有 sdkman 时优先用 sdkman',
}

interface EnvVersionModalProps {
  open: boolean
  lang: RuntimeLang | null
  runtime: RuntimeInfo | undefined
  versions: RuntimeVersion[]
  /** sshHostId 空字符串表示本机。 */
  sshHostId?: string
  onClose: () => void
  onRefresh: (opts?: { silent?: boolean; force?: boolean }) => Promise<void>
  onStatus: (msg: string) => void
}

/** versionRowKey 版本行唯一键。 */
function versionRowKey(v: RuntimeVersion) {
  return v.formula || `${v.label ?? ''}:${v.version}`
}

/** versionActionTarget 安装/切换/卸载时传给后端的标识。 */
function versionActionTarget(v: RuntimeVersion) {
  return v.formula || v.version
}

/** versionSourceLabel 表格「库」列显示文本。 */
function versionSourceLabel(v: RuntimeVersion) {
  return v.label || v.formula || v.version
}

/** versionSortKey 提取版本排序键。 */
function versionSortKey(v: RuntimeVersion) {
  const m = (v.formula || v.version).match(/php@([\d.]+)/)
  if (m) return m[1]
  const tag = v.version.match(/^(\d+\.\d+(?:\.\d+)?)/)
  return tag ? tag[1] : v.version
}

/** EnvVersionModal 安装 / 切换运行时版本。 */
export function EnvVersionModal({
  open,
  lang,
  runtime,
  versions,
  sshHostId = '',
  onClose,
  onRefresh,
  onStatus,
}: EnvVersionModalProps) {
  const { t } = useI18n()
  const versionsLoading = useLoading(lang ? versionLoadingKey(lang) : 'environment.versions._')
  const [inputVersion, setInputVersion] = useState('')
  const [installing, setInstalling] = useState(false)
  const [switchingVersion, setSwitchingVersion] = useState<string | null>(null)
  const [uninstallingKey, setUninstallingKey] = useState<string | null>(null)
  const [showInstallLog, setShowInstallLog] = useState(false)
  const [installLog, setInstallLog] = useState<string[]>([])
  const logEndRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!open) {
      setInstalling(false)
      setSwitchingVersion(null)
      setUninstallingKey(null)
      setShowInstallLog(false)
      setInstallLog([])
      setInputVersion('')
    }
  }, [open])

  useEffect(() => {
    if (!installing || !lang || !showInstallLog) return
    return onEnvInstallLog((evt) => {
      if (evt.lang !== lang || !evt.line) return
      setInstallLog((prev) => {
        if (evt.replaceLast && prev.length > 0) {
          const next = prev.slice()
          next[next.length - 1] = evt.line
          return next
        }
        return [...prev, evt.line]
      })
    })
  }, [installing, lang, showInstallLog])

  useEffect(() => {
    if (!showInstallLog) return
    logEndRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [installLog, showInstallLog])

  const sortedVersions = useMemo(() => {
    return [...versions].sort((a, b) => {
      const byVer = versionSortKey(b).localeCompare(versionSortKey(a), undefined, { numeric: true })
      if (byVer !== 0) return byVer
      return versionSourceLabel(a).localeCompare(versionSourceLabel(b))
    })
  }, [versions])

  const hasCatalog = sortedVersions.some((v) => !v.installed)
  const installedCount = sortedVersions.filter((v) => v.installed).length

  if (!open || !lang) return null

  const needsManager = runtime?.needsManager && runtime?.canInstallManager && !runtime?.canInstall
  const managerLabel = runtime?.managerLabel || runtime?.manager || '版本管理工具'
  const busy = installing || switchingVersion != null || uninstallingKey != null
  const canUninstall = lang === 'php' || lang === 'node' || lang === 'go' || lang === 'java'
  const listLoading = versionsLoading.active

  const runInstall = async (
    label: string,
    fn: () => Promise<void>,
    closeOnSuccess = true,
  ) => {
    setShowInstallLog(true)
    setInstallLog([])
    setInstalling(true)
    onStatus(label)
    try {
      await fn()
      await onRefresh()
      if (closeOnSuccess) onClose()
    } catch (e) {
      onStatus((e as Error).message)
    } finally {
      setInstalling(false)
      setShowInstallLog(false)
    }
  }

  /** switchVersion 切换已安装版本（行内反馈，不关闭弹窗）。 */
  const switchVersion = async (v: RuntimeVersion) => {
    if (busy || switchingVersion) return
    if (v.active) return
    const key = versionRowKey(v)
    const target = versionActionTarget(v)

    setSwitchingVersion(key)
    onStatus(`正在切换至 ${v.version}…`)
    try {
      await api.useEnvVersion(sshHostId, lang, target)
      await onRefresh({ silent: true })
      const shellHint =
        lang === 'php' || lang === 'go' || lang === 'java'
          ? '，请新开终端后生效'
          : ''
      onStatus(`已切换至 ${v.version}${shellHint}`)
    } catch (e) {
      onStatus((e as Error).message)
    } finally {
      setSwitchingVersion(null)
    }
  }

  /** installRowVersion 安装 catalog 中的指定版本。 */
  const installRowVersion = async (v: RuntimeVersion) => {
    const target = versionActionTarget(v)
    return runInstall(`正在安装 ${v.version}…`, async () => {
      await api.installEnvVersion(sshHostId, lang, target)
      onStatus(`已安装并切换至 ${v.version}，请新开终端后执行 go version / java -version 验证`)
    }, false)
  }

  /** uninstallRowVersion 卸载 catalog 中的指定版本。 */
  const uninstallRowVersion = async (v: RuntimeVersion) => {
    if (busy || v.active) return
    const key = versionRowKey(v)
    const target = versionActionTarget(v)
    setUninstallingKey(key)
    onStatus(`正在卸载 ${v.version}…`)
    try {
      await api.uninstallEnvVersion(sshHostId, lang, target)
      await onRefresh({ silent: true })
      onStatus(`已卸载 ${v.version}`)
    } catch (e) {
      onStatus((e as Error).message)
    } finally {
      setUninstallingKey(null)
    }
  }

  const installManager = () =>
    runInstall(`正在安装 ${managerLabel}…`, async () => {
      await api.installEnvManager(sshHostId, lang)
      onStatus(`${managerLabel} 已安装`)
    })

  const installVersion = () => {
    const version = inputVersion.trim()
    if (!version) {
      onStatus('请输入要安装的版本号')
      return
    }
    return runInstall(`正在安装 ${version}…`, async () => {
      await api.installEnvVersion(sshHostId, lang, version)
      setInputVersion('')
      onStatus(`已安装 ${version}`)
    })
  }

  const ensureVersion = () => {
    const version = inputVersion.trim()
    if (!version) {
      onStatus('请输入版本号')
      return
    }
    return runInstall(`正在安装并切换 ${version}…`, async () => {
      await api.ensureEnvVersion(sshHostId, lang, version)
      setInputVersion('')
      onStatus(`已安装并切换至 ${version}`)
    })
  }

  return (
    <div className="wn-modal-backdrop" onClick={onClose}>
      <div className="wn-modal env-version-modal" onClick={(e) => e.stopPropagation()} role="dialog">
        <header className="wn-modal-header env-version-modal-header">
          <div className="env-version-modal-head">
            <h2 className="wn-modal-title">管理 {runtime?.label ?? lang}</h2>
            <p className="wn-modal-desc">
              {needsManager
                ? `未检测到 ${managerLabel}，安装后可管理多版本`
                : runtime?.canInstall
                  ? `通过 ${runtime.managerLabel || runtime.manager} 安装或切换版本`
                  : `当前由 ${runtime?.manager ?? 'system'} 管理，仅可切换已安装版本`}
            </p>
          </div>
          {!needsManager && (
            <button
              type="button"
              className="wn-btn wn-btn-sm wn-btn-ghost env-version-refresh-btn"
              disabled={busy || listLoading}
              title={t('environment.refreshList')}
              onClick={() => void onRefresh({ force: true })}
            >
              {t('common.refresh')}
            </button>
          )}
        </header>
        <div className="wn-modal-body">
          {needsManager && (
            <div className="env-manager-install">
              <p className="wn-modal-desc">{MANAGER_DESC[lang]}</p>
              <button
                type="button"
                className="wn-btn wn-btn-sm wn-btn-primary"
                disabled={busy || listLoading}
                onClick={() => void installManager()}
              >
                {installing ? t('environment.installing') : t('environment.installManager', { manager: managerLabel })}
              </button>
            </div>
          )}

          {runtime?.canInstall && !hasCatalog && (
            <div className="wn-form env-version-install">
              <div className="wn-field">
                <label className="wn-label" htmlFor="env-version-input">
                  安装新版本
                </label>
                <input
                  id="env-version-input"
                  className="wn-input"
                  value={inputVersion}
                  onChange={(e) => setInputVersion(e.target.value)}
                  placeholder={VERSION_HINT[lang]}
                  disabled={busy || listLoading}
                />
              </div>
              <div className="env-version-install-actions">
                <button
                  type="button"
                  className="wn-btn wn-btn-sm wn-btn-tool"
                  disabled={busy || listLoading || !inputVersion.trim()}
                  onClick={() => void installVersion()}
                >
                  仅安装
                </button>
                <button
                  type="button"
                  className="wn-btn wn-btn-sm wn-btn-primary"
                  disabled={busy || listLoading || !inputVersion.trim()}
                  onClick={() => void ensureVersion()}
                >
                  {installing ? t('environment.installing') : t('environment.installSwitch')}
                </button>
              </div>
            </div>
          )}

          {showInstallLog && installing && installLog.length > 0 && (
            <div className="env-version-log">
              <div className="wn-label">安装日志</div>
              <pre className="env-version-log-body">
                {installLog.join('\n')}
                <div ref={logEndRef} />
              </pre>
            </div>
          )}

          {showInstallLog && installing && installLog.length === 0 && (
            <p className="wn-modal-desc env-version-waiting">{t('environment.installWaiting')}</p>
          )}

          {!needsManager && (
            <div className="env-version-installed">
              <div className="wn-label">
                {hasCatalog ? t('environment.catalogVersions', { count: sortedVersions.length }) : t('environment.installedVersions', { count: installedCount })}
              </div>
              <LoadingPane
                loadingKey={versionLoadingKey(lang)}
                label={t('environment.refreshing')}
                minHeight={200}
                className="env-version-list-pane"
              >
                {sortedVersions.length === 0 ? (
                  <p className="wn-modal-desc">
                    {runtime?.manager === 'system'
                      ? '未检测到系统 PHP。若已安装，请点刷新；否则在远端执行 apt install php / dnf install php'
                      : t('environment.noVersions')}
                  </p>
                ) : (
                  <div className="env-version-table-wrap">
                    <table className="env-version-table">
                    <thead>
                      <tr>
                        <th className="col-source">库</th>
                        <th className="col-version">版本</th>
                        <th className="col-installed">已安装</th>
                        <th className="col-actions">操作</th>
                      </tr>
                    </thead>
                    <tbody>
                      {sortedVersions.map((v) => {
                        const key = versionRowKey(v)
                        const isSwitching = switchingVersion === key
                        const isUninstalling = uninstallingKey === key
                        return (
                          <tr key={key} className={v.active ? 'is-active' : ''}>
                            <td className="env-version-source" title={versionSourceLabel(v)}>
                              {versionSourceLabel(v)}
                            </td>
                            <td className="env-version-ver">{v.version}</td>
                            <td className="env-version-installed-cell">
                              {v.installed ? <span className="env-version-check" aria-label="已安装">✓</span> : '—'}
                            </td>
                            <td className="env-version-actions-cell">
                              <div className="env-version-actions">
                                {v.active ? (
                                  <span className="env-version-badge">当前</span>
                                ) : v.installed ? (
                                  <>
                                    <button
                                      type="button"
                                      className="env-version-text-btn"
                                      disabled={busy || listLoading}
                                      onClick={() => void switchVersion(v)}
                                    >
                                      {isSwitching ? t('environment.switching') : t('environment.switch')}
                                    </button>
                                    {canUninstall && (
                                      <button
                                        type="button"
                                        className="env-version-text-btn is-danger"
                                        disabled={busy || listLoading}
                                        onClick={() => void uninstallRowVersion(v)}
                                      >
                                        {isUninstalling ? t('environment.uninstalling') : t('environment.uninstall')}
                                      </button>
                                    )}
                                  </>
                                ) : (
                                  <button
                                    type="button"
                                    className="env-version-text-btn"
                                    disabled={busy || listLoading}
                                    onClick={() => void installRowVersion(v)}
                                  >
                                    安装
                                  </button>
                                )}
                              </div>
                            </td>
                          </tr>
                        )
                      })}
                    </tbody>
                  </table>
                  </div>
                )}
              </LoadingPane>
            </div>
          )}
        </div>
        <footer className="wn-modal-footer">
          <button type="button" className="wn-btn wn-btn-tool" onClick={onClose}>
            关闭
          </button>
        </footer>
      </div>
    </div>
  )
}
