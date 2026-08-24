import { useEffect, useState } from 'react'
import { api } from '../../api/client'
import type { EnvPreset, RuntimeLang } from '../../api/types'
import '../../components/ui.css'

const LANGS: RuntimeLang[] = ['node', 'go', 'php', 'java']
const LANG_LABELS: Record<RuntimeLang, string> = {
  node: 'Node.js',
  go: 'Go',
  php: 'PHP',
  java: 'Java',
}

interface EnvPresetModalProps {
  open: boolean
  initial?: EnvPreset | null
  /** 新建时从当前运行时快照填入（可再微调） */
  seedRuntimes?: Record<string, string>
  defaultName?: string
  onClose: () => void
  onSaved: () => void
}

/** EnvPresetModal 保存当前 / 编辑环境预设。 */
export function EnvPresetModal({
  open,
  initial,
  seedRuntimes,
  defaultName = '',
  onClose,
  onSaved,
}: EnvPresetModalProps) {
  const [name, setName] = useState('')
  const [runtimes, setRuntimes] = useState<Record<string, string>>({})
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')
  const isEdit = Boolean(initial)

  useEffect(() => {
    if (!open) return
    setError('')
    setName(initial?.name ?? defaultName)
    setRuntimes({ ...(initial?.runtimes ?? seedRuntimes ?? {}) })
  }, [open, initial, seedRuntimes, defaultName])

  if (!open) return null

  const submit = async () => {
    if (!name.trim()) {
      setError('请输入预设名称')
      return
    }
    const filled = Object.fromEntries(
      Object.entries(runtimes).filter(([, v]) => String(v ?? '').trim() !== ''),
    )
    if (Object.keys(filled).length === 0) {
      setError('至少保留一项已检测到的版本')
      return
    }
    setSaving(true)
    setError('')
    try {
      await api.saveEnvPreset({
        id: initial?.id ?? crypto.randomUUID(),
        name: name.trim(),
        active: initial?.active ?? false,
        runtimes: filled,
      })
      onSaved()
      onClose()
    } catch (e) {
      setError((e as Error).message)
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="wn-modal-backdrop" onClick={onClose}>
      <div className="wn-modal wn-modal-compact" onClick={(e) => e.stopPropagation()} role="dialog">
        <header className="wn-modal-header">
          <h2 className="wn-modal-title">{isEdit ? '编辑预设' : '保存当前预设'}</h2>
          <p className="wn-modal-desc">
            {isEdit
              ? '修改后应用预设时将按新版本切换'
              : '已填入当前目标机上检测到的版本，可按需微调后保存'}
          </p>
        </header>
        <div className="wn-modal-body">
          <div className="wn-form">
            <div className="wn-field">
              <label className="wn-label" htmlFor="env-preset-name">
                名称
              </label>
              <input
                id="env-preset-name"
                className="wn-input"
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="全栈项目"
              />
            </div>
            {LANGS.map((lang) => (
              <div className="wn-field" key={lang}>
                <label className="wn-label" htmlFor={`env-preset-${lang}`}>
                  {LANG_LABELS[lang]}
                </label>
                <input
                  id={`env-preset-${lang}`}
                  className="wn-input"
                  value={runtimes[lang] ?? ''}
                  onChange={(e) =>
                    setRuntimes((prev) => ({
                      ...prev,
                      [lang]: e.target.value,
                    }))
                  }
                  placeholder="留空表示应用预设时不切换此项"
                />
              </div>
            ))}
          </div>
          {error && <div className="wn-form-msg error">{error}</div>}
        </div>
        <footer className="wn-modal-footer">
          <button type="button" className="wn-btn wn-btn-tool" onClick={onClose} disabled={saving}>
            取消
          </button>
          <button type="button" className="wn-btn wn-btn-primary" onClick={() => void submit()} disabled={saving}>
            {saving ? '保存中…' : '保存'}
          </button>
        </footer>
      </div>
    </div>
  )
}
