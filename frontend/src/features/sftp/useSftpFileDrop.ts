import { useEffect } from 'react'
import { bindOsFileDrop, hitOsDropTarget } from '../../utils/osFileDrop'

/** useSftpFileDrop 监听系统文件拖放到远程窗格并上传。与笔记资源拖入共用同一个 Wails 监听。 */
export function useSftpFileDrop(enabled: boolean, onDrop: (paths: string[]) => void) {
  useEffect(() => {
    if (!enabled) return
    return bindOsFileDrop((x, y, paths) => {
      if (!hitOsDropTarget(x, y, '.sftp-drop-target')) return false
      onDrop(paths)
      return true
    })
  }, [enabled, onDrop])
}
