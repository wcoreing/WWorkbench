import { useCallback } from 'react'
import { api } from '../../api/client'
import type { HostProject } from '../../api/types'
import { notify } from '../../notify'

type TFn = (key: string, params?: Record<string, string | number>) => string

/** 记忆区项目 localPath / remotePath 绑定（侧栏）。 */
export function useHostProjectBinding(opts: {
  projectByDir: Record<string, HostProject>
  onProjectBindingChanged?: () => void | Promise<void>
  t: TFn
}) {
  const { projectByDir, onProjectBindingChanged, t } = opts

  const saveProjectPaths = useCallback(
    async (dirRel: string, patch: { localPath?: string; remotePath?: string }) => {
      const cur =
        projectByDir[dirRel] ||
        (await api.getHostProject(dirRel).catch(() => ({
          dirRel,
          name: dirRel.split('/').pop() || dirRel,
          sshHostId: '',
          localPath: '',
          remotePath: '',
          noteId: '',
        })))
      const next = await api.saveHostProject({
        ...cur,
        dirRel,
        localPath: patch.localPath !== undefined ? patch.localPath : cur.localPath || '',
        remotePath: patch.remotePath !== undefined ? patch.remotePath : cur.remotePath || '',
      })
      notify.success(
        next.localPath
          ? t('notebook.projectLocalSaved', { path: next.localPath })
          : t('notebook.projectBindingSaved'),
      )
      await onProjectBindingChanged?.()
    },
    [projectByDir, onProjectBindingChanged, t],
  )

  const setProjectLocalDir = useCallback(
    async (dirRel: string) => {
      try {
        const cur = projectByDir[dirRel]
        const picked = await api.pickLocalProjectDir(cur?.localPath || '')
        if (!picked) return
        await saveProjectPaths(dirRel, { localPath: picked })
      } catch (e) {
        notify.error((e as Error).message)
      }
    },
    [projectByDir, saveProjectPaths],
  )

  const setProjectRemoteDir = useCallback(
    async (dirRel: string) => {
      try {
        const cur = projectByDir[dirRel] || (await api.getHostProject(dirRel).catch(() => null))
        const input = window.prompt(
          t('notebook.projectRemotePathPrompt'),
          cur?.remotePath || '/www/wwwroot/',
        )
        if (input === null) return
        await saveProjectPaths(dirRel, { remotePath: input.trim() })
      } catch (e) {
        notify.error((e as Error).message)
      }
    },
    [projectByDir, saveProjectPaths, t],
  )

  return { saveProjectPaths, setProjectLocalDir, setProjectRemoteDir }
}
