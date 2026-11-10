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
    const intent = String(payload.intent ?? '').trim()
    const label =
      stageLabel ||
      (payload.localShell
        ? intent || preview
          ? `MCP · 本机 · ${intent || preview}`
          : 'MCP · 本机终端'
        : name
          ? intent || preview
            ? `MCP · ${name} · ${intent || preview}`
            : `MCP · ${name}`
          : 'MCP · SSH 终端')
    setShellStage(label, intent || preview || undefined)
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

/** formatConfirmCode 把注入命令整理成可读多行（去 \r，并按 && / || / ; 断行）。 */
function formatConfirmCode(raw: string): string {
  const normalized = raw
    .replace(/\r\n/g, '\n')
    .replace(/\r/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim()
  if (!normalized) return normalized
  // MCP 注入多为单行长链；已有多行则逐行再断链，避免整段糊成一坨。
  return normalized
    .split('\n')
    .map((line) => prettyBreakShellChain(line.trimEnd()))
    .join('\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim()
}

/** prettyBreakShellChain 在引号外按 && / || / ; 断行，操作符留在行尾便于审阅。 */
function prettyBreakShellChain(cmd: string): string {
  const s = cmd.replace(/[ \t]{2,}/g, ' ').trim()
  if (!s || s.length < 48) return s

  const parts: string[] = []
  let buf = ''
  let quote: "'" | '"' | null = null
  let escape = false

  const flushOp = (op: string, i: number): number => {
    parts.push(`${buf.trimEnd()} ${op}`)
    buf = ''
    let j = i
    while (j + 1 < s.length && (s[j + 1] === ' ' || s[j + 1] === '\t')) j++
    return j
  }

  for (let i = 0; i < s.length; i++) {
    const ch = s[i]!
    if (escape) {
      buf += ch
      escape = false
      continue
    }
    if (quote === "'") {
      buf += ch
      if (ch === "'") quote = null
      continue
    }
    if (quote === '"') {
      if (ch === '\\') {
        buf += ch
        escape = true
        continue
      }
      buf += ch
      if (ch === '"') quote = null
      continue
    }
    if (ch === "'" || ch === '"') {
      quote = ch
      buf += ch
      continue
    }
    if (ch === '\\') {
      buf += ch
      escape = true
      continue
    }
    if ((ch === '&' || ch === '|') && s[i + 1] === ch) {
      i = flushOp(ch + ch, i + 1)
      continue
    }
    if (ch === ';' && s[i + 1] !== ';') {
      i = flushOp(';', i)
      continue
    }
    buf += ch
  }
  if (buf.trim()) parts.push(buf.trim())
  if (parts.length <= 1) return s
  return parts.join('\n')
}

/** formatMcpConfirmBody 拆分说明文案与代码块内容。 */
function formatMcpConfirmBody(
  preview: unknown,
  toolName: string,
): { message?: string; code?: string } {
  if (preview == null) {
    return { message: toolName ? `工具 · ${toolName}` : undefined }
  }
  if (typeof preview === 'string') {
    const text = formatConfirmCode(preview)
    return text ? { code: text } : { message: toolName ? `工具 · ${toolName}` : undefined }
  }
  try {
    const obj = typeof preview === 'object' ? (preview as Record<string, unknown>) : null
    if (!obj) {
      return { code: formatConfirmCode(String(preview)) }
    }
    const codeRaw = [obj.command, obj.sql, obj.initialCommand, obj.commandPreview]
      .map((v) => (v != null ? String(v) : ''))
      .find((s) => s.trim())
    const code = codeRaw ? formatConfirmCode(codeRaw) : undefined

    const meta: string[] = []
    if (obj.intent != null && String(obj.intent).trim()) {
      meta.push(`意图 · ${String(obj.intent).trim()}`)
    }
    if (toolName) meta.push(`工具 · ${toolName}`)
    const hostLabel = [obj.name, obj.host, obj.user]
      .map((v) => (v != null ? String(v).trim() : ''))
      .filter(Boolean)
    if (obj.kind === 'local' || obj.localShell) {
      meta.push('目标 · 本机')
    } else if (hostLabel.length) {
      meta.push(`主机 · ${hostLabel.join(' · ')}`)
    }
    if (obj.risk != null && String(obj.risk).trim()) {
      meta.push(`风险 · ${String(obj.risk).trim()}`)
    }
    if (obj.dataGuard) {
      meta.push('数据防护 · 已启用')
    }
    if (obj.autoExclude != null && String(obj.autoExclude).trim()) {
      meta.push(`确认后自动 exclude · ${String(obj.autoExclude).trim()}`)
    }
    if (obj.backupBefore) {
      const bak =
        obj.backupDir != null && String(obj.backupDir).trim()
          ? String(obj.backupDir).trim()
          : '/www/backup/wworkbench'
      meta.push(`确认后写前备份 · ${bak}/<时间戳>/`)
    }
    if (Array.isArray(obj.backupPolicies) && obj.backupPolicies.length) {
      meta.push(
        `备份策略 · ${obj.backupPolicies.map((x) => String(x)).filter(Boolean).join('、')}`,
      )
    }
    for (const key of ['url', 'method', 'path', 'containerId', 'packId', 'releaseId'] as const) {
      const v = obj[key]
      if (v != null && String(v).trim() && key !== 'path') {
        meta.push(`${key} · ${String(v).trim()}`)
      } else if (key === 'path' && v != null && String(v).trim() && !code) {
        meta.push(`path · ${String(v).trim()}`)
      }
    }
    if (!code && meta.length === 0) {
      return { code: formatConfirmCode(JSON.stringify(preview, null, 2)) }
    }
    return {
      message: meta.length ? meta.join('\n') : undefined,
      code,
    }
  } catch {
    return { code: formatConfirmCode(String(preview)) }
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
    'backup',
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

  const body = formatMcpConfirmBody(raw.preview, toolName)
  const ok = await askConfirm({
    title: summary,
    message: body.message,
    code: body.code,
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
