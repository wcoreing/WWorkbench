import { useCallback, useEffect, useState } from 'react'
import { api } from '../../api/client'
import type { HTTPEnvironment } from '../../api/types'
import { ConfirmDialog } from '../../components/ConfirmDialog'
import { IconPlus } from '../../components/Icons'
import { useI18n } from '../../i18n'
import { useAppStore } from '../../stores/appStore'
import { formatEnvText, parseEnvText } from './httpUtils'
import { model } from '../../../wailsjs/go/models'
import { ModalPortal, Select } from '../../components/compat'

interface Props {
  open: boolean
  activeEnvId: string
  onActiveEnvId: (id: string) => void
  onClose: () => void
  onSaved?: () => void
}

/** HttpEnvModal 环境变量管理弹窗。 */
export function HttpEnvModal({ open, activeEnvId, onActiveEnvId, onClose, onSaved }: Props) {
  const { t } = useI18n()
  const { setStatusMessage } = useAppStore()
  const [envs, setEnvs] = useState<HTTPEnvironment[]>([])
  const [selectedId, setSelectedId] = useState('')
  const [envName, setEnvName] = useState('')
  const [envVarText, setEnvVarText] = useState('')
  const [deleteTarget, setDeleteTarget] = useState<HTTPEnvironment | null>(null)

  const refresh = useCallback(async () => {
    const list = (await api.listHTTPEnvironments()) as HTTPEnvironment[]
    setEnvs(list)
    return list
  }, [])

  const loadEditor = useCallback((item: HTTPEnvironment | null) => {
    if (!item) {
      setSelectedId('')
      setEnvName('')
      setEnvVarText('')
      return
    }
    setSelectedId(item.id)
    setEnvName(item.name)
    setEnvVarText(formatEnvText(item.varsJson))
  }, [])

  useEffect(() => {
    if (!open) return
    void refresh().then((list) => {
      const cur = list.find((e) => e.id === activeEnvId) ?? list[0]
      loadEditor(cur ?? null)
    })
  }, [open, refresh, loadEditor, activeEnvId])

  const saveEnv = async () => {
    if (!envName.trim()) {
      setStatusMessage(t('httpapi.errEnvName'))
      return
    }
    const saved = (await api.saveHTTPEnvironment(
      model.HTTPEnvironmentDO.createFrom({
        id: selectedId,
        name: envName.trim(),
        varsJson: JSON.stringify(parseEnvText(envVarText)),
        createdAt: 0,
        updatedAt: 0,
      }),
    )) as HTTPEnvironment
    setSelectedId(saved.id)
    await refresh()
    onSaved?.()
    setStatusMessage(t('httpapi.envSaved'))
  }

  if (!open) return null

  return (
    <>
      <ModalPortal>
      <div className="wn-modal-backdrop wn-modal-backdrop-top" onClick={onClose}>
        <div className="wn-modal httpapi-env-modal" onClick={(e) => e.stopPropagation()}>
          <header className="wn-modal-header wn-modal-header-bar">
            <h3 className="wn-modal-title">{t('httpapi.envManage')}</h3>
            <button type="button" className="wn-modal-close-btn" onClick={onClose} aria-label={t('common.cancel')}>
              ×
            </button>
          </header>
          <div className="wn-modal-body httpapi-env-modal-body">
            <aside className="httpapi-env-list">
              <div className="httpapi-env-list-head">
                <span>{t('httpapi.envSection')}</span>
                <button type="button" className="wn-btn wn-btn-icon wn-btn-sm" onClick={() => loadEditor(null)}>
                  <IconPlus size={14} />
                </button>
              </div>
              <ul className="conn-list">
                {envs.map((item) => (
                  <li
                    key={item.id}
                    className={`conn-item ${item.id === selectedId ? 'active' : ''}`}
                    onClick={() => loadEditor(item)}
                    onContextMenu={(e) => {
                      e.preventDefault()
                      setDeleteTarget(item)
                    }}
                  >
                    <span className="conn-name">{item.name}</span>
                  </li>
                ))}
              </ul>
            </aside>
            <div className="httpapi-env-editor-pane">
              <label className="wn-label">{t('httpapi.envName')}</label>
              <input
                className="wn-input"
                value={envName}
                onChange={(e) => setEnvName(e.target.value)}
                placeholder={t('httpapi.envNamePlaceholder')}
              />
              <label className="wn-label">{t('httpapi.envVars')}</label>
              <textarea
                className="wn-input httpapi-env-vars-area"
                value={envVarText}
                onChange={(e) => setEnvVarText(e.target.value)}
                placeholder={t('httpapi.envVarsPlaceholder')}
                spellCheck={false}
              />
              <p className="httpapi-env-hint">{t('httpapi.envVarsHint')}</p>
              <div className="httpapi-env-editor-actions">
                <label className="wn-label httpapi-env-use-label">
                  {t('httpapi.activeEnv')}
                  <Select
                    className="wn-input"
                    value={activeEnvId}
                    options={[
                      { value: '', label: t('httpapi.noEnv') },
                      ...envs.map((e) => ({ value: e.id, label: e.name })),
                    ]}
                    onChange={onActiveEnvId}
                  />
                </label>
                <button type="button" className="wn-btn wn-btn-sm wn-btn-primary" onClick={() => void saveEnv()}>
                  {t('httpapi.saveEnv')}
                </button>
              </div>
            </div>
          </div>
        </div>
      </div>
      </ModalPortal>

      <ConfirmDialog
        open={deleteTarget != null}
        title={t('httpapi.deleteEnvTitle')}
        message={deleteTarget ? t('httpapi.deleteEnvMsg', { name: deleteTarget.name }) : undefined}
        confirmLabel={t('common.delete')}
        danger
        onConfirm={() => {
          const item = deleteTarget
          setDeleteTarget(null)
          if (!item) return
          void api.deleteHTTPEnvironment(item.id).then(async () => {
            if (activeEnvId === item.id) onActiveEnvId('')
            if (selectedId === item.id) loadEditor(null)
            await refresh()
            setStatusMessage(t('httpapi.envDeleted'))
          })
        }}
        onCancel={() => setDeleteTarget(null)}
      />
    </>
  )
}
