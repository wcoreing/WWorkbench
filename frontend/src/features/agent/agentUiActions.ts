import { EventsOn, WindowShow, WindowUnminimise } from '../../../wailsjs/runtime/runtime'
import { useAppStore } from '../../stores/appStore'
import { dispatchWorkbenchCommand } from '../../workbench/workbenchCommandBus'
import { Capability } from '../../workbench/capabilities'
import type { ProductId } from '../../shell/products'
import { askConfirm } from '../../utils/askConfirm'
import { api } from '../../api/client'

let stageClearTimer: ReturnType<typeof setTimeout> | null = null

function bringWorkbenchForward() {
  try {
    WindowUnminimise()
    WindowShow()
  } catch {
    /* runtime 未就绪时忽略 */
  }
}

function scheduleClearStage(at: number, ms = 90_000) {
  if (stageClearTimer) clearTimeout(stageClearTimer)
  stageClearTimer = setTimeout(() => {
    const cur = useAppStore.getState().mcpStage
    if (cur && cur.at === at) {
      useAppStore.getState().setMcpStage(null)
    }
  }, ms)
}

function setShellStage(label: string, detail?: string) {
  const at = Date.now()
  useAppStore.getState().setMcpStage({ kind: 'shell', label, detail, at })
  useAppStore.getState().setStatusMessage(label)
  scheduleClearStage(at)
}

/** dispatchAgentUiAction 执行 Agent 触发的 UI 联动（走 CommandBus）。 */
export function dispatchAgentUiAction(raw: Record<string, unknown>) {
  const kind = String(raw.kind ?? '')
  if (!kind) return

  bringWorkbenchForward()

  const payload = { ...raw }
  delete payload.kind

  if (kind === Capability.ShellRun) {
    const stageLabel = String(payload.stageLabel ?? '')
    const name = String(payload.name ?? '')
    const preview = String(payload.commandPreview ?? '')
    const label =
      stageLabel ||
      (payload.localShell
        ? preview
          ? `MCP · 本机 · ${preview}`
          : 'MCP · 本机终端'
        : name
          ? preview
            ? `MCP · ${name} · ${preview}`
            : `MCP · ${name}`
          : 'MCP · SSH 终端')
    setShellStage(label, preview || undefined)
  }

  void dispatchWorkbenchCommand({
    capability: kind,
    source: 'agent',
    payload,
  }).then((res) => {
    if (res.ok) {
      if (kind === Capability.ShellRun) {
        /* 状态已由 setShellStage 写入 */
      } else if (kind === Capability.TerminalReconnect) {
        useAppStore.getState().setStatusMessage('AI：正在重连终端')
      } else if (kind === Capability.DatabaseOpen) {
        useAppStore.getState().setStatusMessage('AI：已打开数据库工作台')
      } else if (kind === Capability.LogsOpen) {
        useAppStore.getState().setStatusMessage('AI：已打开日志中心')
      } else if (kind === Capability.HttpApiOpen) {
        useAppStore.getState().setStatusMessage('AI：已打开 API 工作台')
      } else if (kind === Capability.EnvironmentOpen) {
        useAppStore.getState().setStatusMessage('AI：已打开环境工作台')
      } else if (kind === Capability.SSHForwardOpen) {
        useAppStore.getState().setStatusMessage('AI：已打开 SSH 隧道')
      } else if (kind === Capability.DockerContextOpen) {
        const label = String(payload.stageLabel ?? '')
        if (label) setShellStage(label)
        else useAppStore.getState().setStatusMessage('AI：已打开 Docker 上下文')
      }
    } else if (res.error) {
      useAppStore.getState().setStatusMessage(res.error)
    }
  })
}

function previewMessage(preview: unknown): string | undefined {
  if (preview == null) return undefined
  if (typeof preview === 'string') return preview
  try {
    const obj = typeof preview === 'object' ? (preview as Record<string, unknown>) : null
    if (obj) {
      const bits: string[] = []
      for (const key of ['command', 'sql', 'url', 'method', 'path', 'containerId', 'packId', 'releaseId']) {
        const v = obj[key]
        if (v != null && String(v).trim()) bits.push(`${key}: ${String(v)}`)
      }
      if (bits.length) return bits.join('\n')
    }
    return JSON.stringify(preview, null, 2)
  } catch {
    return String(preview)
  }
}

function asProductId(v: unknown): ProductId | null {
  const id = String(v ?? '')
  const allowed: ProductId[] = [
    'database',
    'terminal',
    'sftp',
    'docker',
    'environment',
    'notebook',
    'skills',
    'httpapi',
    'logs',
    'plugins',
  ]
  return (allowed as string[]).includes(id) ? (id as ProductId) : null
}

/** subscribeAgentUiActions 订阅 agent:ui_action。 */
export function subscribeAgentUiActions() {
  return EventsOn('agent:ui_action', (raw: Record<string, unknown>) => {
    dispatchAgentUiAction(raw)
  })
}

let mcpConfirmQueue: Promise<void> = Promise.resolve()

async function handleMcpConfirm(raw: Record<string, unknown>) {
  bringWorkbenchForward()
  const pendingId = String(raw.pendingId ?? '')
  const summary = String(raw.summary ?? '确认执行危险操作')
  const toolName = String(raw.toolName ?? '')
  const product = asProductId(raw.product)
  if (product) {
    useAppStore.getState().setActiveProduct(product)
  }
  const at = Date.now()
  useAppStore.getState().setMcpStage({
    kind: 'confirm',
    label: `待确认 · ${summary}`,
    detail: toolName || undefined,
    at,
  })
  useAppStore.getState().setStatusMessage(`待确认 · ${summary}`)

  const message = previewMessage(raw.preview)
  const ok = await askConfirm({
    title: summary,
    message: message
      ? `${toolName ? `工具：${toolName}\n\n` : ''}${message}`
      : toolName
        ? `工具：${toolName}`
        : undefined,
    confirmLabel: '执行',
    danger: true,
  })
  try {
    if (pendingId) {
      await api.resolveMCPConfirm(pendingId, ok)
    }
  } catch (err) {
    useAppStore.getState().setStatusMessage(err instanceof Error ? err.message : String(err))
  } finally {
    const cur = useAppStore.getState().mcpStage
    if (cur && cur.at === at) {
      if (ok) {
        const nextAt = Date.now()
        useAppStore.getState().setMcpStage({
          kind: 'shell',
          label: `已确认 · ${summary}`,
          at: nextAt,
        })
        scheduleClearStage(nextAt, 30_000)
        useAppStore.getState().setStatusMessage(`已确认 · ${summary}`)
      } else {
        useAppStore.getState().setMcpStage(null)
        useAppStore.getState().setStatusMessage('已拒绝外置 MCP 操作')
      }
    }
  }
}

/**
 * subscribeMcpConfirm 外置 MCP 危险操作 → 工作台弹窗拍板（与终端同一视线）。
 * 多请求串行，避免 askConfirm 互相顶掉。
 */
export function subscribeMcpConfirm() {
  return EventsOn('mcp:confirm', (raw: Record<string, unknown>) => {
    mcpConfirmQueue = mcpConfirmQueue.then(() => handleMcpConfirm(raw)).catch(() => {})
  })
}

/** subscribeCommandResults 订阅命令执行结果。 */
export function subscribeCommandResults(onResult: (raw: Record<string, unknown>) => void) {
  return EventsOn('workbench:command:result', onResult)
}
