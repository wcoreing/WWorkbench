import { useAppStore } from '../../stores/appStore'
import {
  openBackup,
  openCapability,
  openDatabase,
  openHttpApi,
  openLogs,
  openNotebook,
  openSftp,
  openTerminal,
} from '../../stores/productLink'
import { Capability } from '../capabilities'
import { isPanelReadyKind, type OpenResourceInput, type ResourceWindow } from './types'
import { useResourceWindowStore } from './store'

function newWindowId(): string {
  return `rw-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 7)}`
}

/** openAsProduct 降级到全屏产品线（现有 openCapability 路径）。 */
export function openAsProduct(input: OpenResourceInput): void {
  const id = input.resourceId
  switch (input.kind) {
    case 'ssh':
      openTerminal({ hostId: id })
      return
    case 'database':
      openDatabase({ connectionId: id })
      return
    case 'docker':
      openCapability(Capability.DockerContextOpen, { contextId: id })
      return
    case 'log':
      openLogs({ logSourceId: id })
      return
    case 'http':
      openHttpApi({ requestId: id })
      return
    case 'note':
    case 'skill':
      openNotebook({ noteId: id })
      return
    case 'backup':
      openBackup({ policyId: id })
      return
    case 'sftp':
      openSftp({ hostId: id })
      return
    default:
      return
  }
}

/**
 * openResource 统一开资源入口。
 * - dialog（默认）：弹窗壳；无 Surface 时降级 product
 * - panel：嵌入舞台（项目等）；无 Surface 时降级 product
 * - product：切全屏产品线
 */
export function openResource(input: OpenResourceInput): ResourceWindow | null {
  const presentation = input.presentation ?? 'dialog'
  const stageKey = (input.stageKey || '').trim() || 'global'
  const title = (input.title || '').trim() || `${input.kind}:${input.resourceId}`

  if (presentation === 'product' || !isPanelReadyKind(input.kind)) {
    openAsProduct(input)
    return null
  }

  const win: ResourceWindow = {
    id: newWindowId(),
    kind: input.kind,
    resourceId: input.resourceId,
    title,
    presentation,
    stageKey,
    meta: input.meta,
    openedAt: Date.now(),
  }

  if (presentation === 'dialog') {
    useResourceWindowStore.getState().setDialog(win)
    return win
  }

  // panel：确保项目产品线可见，舞台才能看到
  const { activeProduct, setActiveProduct } = useAppStore.getState()
  if (stageKey !== 'global' && activeProduct !== 'project') {
    setActiveProduct('project')
  }
  useResourceWindowStore.getState().upsertPanel(win)
  return win
}
