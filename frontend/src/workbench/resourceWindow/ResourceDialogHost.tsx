import { ModalPortal, backdropDismissProps, pressProps } from '../../components/compat'
import { useI18n } from '../../i18n'
import { ResourceSurfaceRouter } from './surfaces/ResourceSurfaceRouter'
import { ResourceWindowChrome } from './ResourceWindowChrome'
import { useResourceWindowStore } from './store'
import './resourceWindow.css'

/**
 * ResourceDialogHost 弹窗形态扩展点：与 Panel 共用 ResourceSurface。
 * 挂在 AppShell；presentation:'dialog' 时由 openResource 写入 store.dialog。
 */
export function ResourceDialogHost() {
  const { t } = useI18n()
  const dialog = useResourceWindowStore((s) => s.dialog)
  const setDialog = useResourceWindowStore((s) => s.setDialog)

  if (!dialog) return null

  const close = () => setDialog(null)

  return (
    <ModalPortal>
      <div className="wn-modal-backdrop wn-modal-backdrop-top" {...backdropDismissProps(close)}>
        <div
          className="wn-modal rw-dialog"
          role="dialog"
          aria-modal="true"
          aria-label={dialog.title}
          onClick={(e) => e.stopPropagation()}
          onPointerDown={(e) => e.stopPropagation()}
        >
          <ResourceWindowChrome
            window={dialog}
            active
            chrome="dialog"
            onFocus={() => {}}
            onClose={close}
          />
          <div className="rw-dialog-body">
            <ResourceSurfaceRouter window={dialog} active />
          </div>
          <footer className="wn-modal-footer">
            <button type="button" className="wn-btn wn-btn-sm wn-btn-tool" {...pressProps(close)}>
              {t('common.close')}
            </button>
          </footer>
        </div>
      </div>
    </ModalPortal>
  )
}
