import { useEffect } from 'react'
import { OnFileDrop, OnFileDropOff } from '../../../wailsjs/runtime/runtime'

/** useSftpFileDrop 监听系统文件拖放到远程窗格并上传 */
export function useSftpFileDrop(enabled: boolean, onDrop: (paths: string[]) => void) {
  useEffect(() => {
    if (!enabled) return
    OnFileDrop((_x, _y, paths) => {
      if (paths.length > 0) onDrop(paths)
    }, true)
    return () => OnFileDropOff()
  }, [enabled, onDrop])
}
