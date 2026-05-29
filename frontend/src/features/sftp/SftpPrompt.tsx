import '../../components/ui.css'

export type SftpPromptMode = 'mkdir' | 'rename' | 'confirm'

interface Props {
  open: boolean
  mode: SftpPromptMode
  title: string
  message?: string
  defaultValue?: string
  confirmLabel?: string
  onConfirm: (value: string) => void
  onCancel: () => void
}

/** SftpPrompt 输入/确认弹窗 */
export function SftpPrompt({
  open,
  mode,
  title,
  message,
  defaultValue = '',
  confirmLabel,
  onConfirm,
  onCancel,
}: Props) {
  if (!open) return null

  const handleSubmit = (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault()
    const fd = new FormData(e.currentTarget)
    onConfirm(String(fd.get('value') ?? ''))
  }

  return (
    <div className="wn-modal-backdrop ssh-trust-backdrop" onClick={onCancel}>
      <form className="wn-modal wn-modal-compact ssh-trust-dialog" onClick={(e) => e.stopPropagation()} onSubmit={handleSubmit}>
        <header className="wn-modal-header">
          <h2 className="wn-modal-title">{title}</h2>
          {message && <p className="wn-modal-desc">{message}</p>}
        </header>
        <div className="wn-modal-body">
          {mode !== 'confirm' && (
            <input className="wn-input" name="value" defaultValue={defaultValue} autoFocus placeholder="名称" />
          )}
        </div>
        <footer className="wn-modal-footer">
          <button type="button" className="wn-btn wn-btn-tool" onClick={onCancel}>
            取消
          </button>
          <button type="submit" className="wn-btn wn-btn-sm wn-btn-primary">
            {confirmLabel ?? (mode === 'confirm' ? '确定' : '保存')}
          </button>
        </footer>
      </form>
    </div>
  )
}
