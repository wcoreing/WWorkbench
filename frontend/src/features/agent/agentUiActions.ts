import { EventsOn, WindowShow, WindowUnminimise } from '../../../wailsjs/runtime/runtime'
import { useAppStore } from '../../stores/appStore'
import { dispatchWorkbenchCommand } from '../../workbench/workbenchCommandBus'
import { Capability } from '../../workbench/capabilities'
import type { ProductId } from '../../shell/products'
import {
  askConfirm,
  askConfirmOutcome,
  type ConfirmChoice,
  type ConfirmLedgerRow,
} from '../../utils/askConfirm'
import { api } from '../../api/client'
import { notify } from '../../notify'

function bringWorkbenchForward() {
  try {
    WindowUnminimise()
    WindowShow()
  } catch {
    /* runtime 未就绪时忽略 */
  }
}

function setStatus(label: string) {
  useAppStore.getState().setStatusMessage(label)
}

/** hardRiskTool 工具级硬风险（不可免确认）。 */
function hardRiskTool(toolName: string): boolean {
  const n = toolName.toLowerCase()
  return (
    n.includes('security_group') ||
    n === 'execute_sql' ||
    n.includes('remove_container') ||
    n.includes('rollback') ||
    n.includes('restore_') ||
    n === 'run_backup' ||
    n.includes('ensure_host_backup')
  )
}

/** previewMarksHard 预览字段标硬风险（shell 数据防护等）。 */
function previewMarksHard(obj: Record<string, unknown> | null): boolean {
  if (!obj) return false
  if (obj.hardRisk === true || obj.dataGuard === true) return true
  const risk = obj.risk != null ? String(obj.risk) : ''
  return (
    risk.includes('数据文件') ||
    risk.includes('递归同步') ||
    risk.includes('数据库') ||
    risk.includes('exclude')
  )
}

/** previewMarksSoft 预览字段标软风险（可被目录护照免除）。 */
function previewMarksSoft(obj: Record<string, unknown> | null): boolean {
  if (!obj || previewMarksHard(obj)) return false
  if (obj.softRisk === true) return true
  const risk = obj.risk != null ? String(obj.risk) : ''
  return (
    risk.includes('写入文件') ||
    risk.includes('tee') ||
    risk.includes('删除文件') ||
    risk.includes('rm')
  )
}

function impactFromPreview(obj: Record<string, unknown>, toolName: string): string {
  if (obj.kind === 'local' || obj.localShell) return '本机终端'
  const host = [obj.name, obj.host].map((v) => (v != null ? String(v).trim() : '')).filter(Boolean)
  if (host.length) return `主机 · ${host.join(' · ')}`
  for (const key of ['database', 'path', 'url', 'containerId', 'packId', 'sshHostId'] as const) {
    const v = obj[key]
    if (v != null && String(v).trim()) return `${key} · ${String(v).trim()}`
  }
  return toolName || ''
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
    setStatus(label)
  }

  void dispatchWorkbenchCommand({
    capability: kind,
    source: 'agent',
    payload,
  }).then((res) => {
    if (res.ok) {
      if (kind === Capability.ShellRun) {
        /* 状态已由 setStatus 写入 */
      } else if (kind === Capability.TerminalReconnect) {
        notify.info('AI：正在重连终端')
      } else if (kind === Capability.DatabaseOpen) {
        notify.success('AI：已打开数据库工作台')
      } else if (kind === Capability.LogsOpen) {
        notify.success('AI：已打开日志中心')
      } else if (kind === Capability.HttpApiOpen) {
        notify.success('AI：已打开 API 工作台')
      } else if (kind === Capability.EnvironmentOpen) {
        notify.success('AI：已打开环境工作台')
      } else if (kind === Capability.SSHForwardOpen) {
        notify.success('AI：已打开 SSH 隧道')
      } else if (kind === Capability.BrowserOpen) {
        const label = String(payload.stageLabel ?? '')
        notify.success(label || 'AI：已打开浏览器舞台')
      } else if (kind === Capability.DockerContextOpen) {
        const label = String(payload.stageLabel ?? '')
        if (label) setStatus(label)
        else notify.success('AI：已打开 Docker 上下文')
      } else if (kind === Capability.OpenProjectStage) {
        const name = String(payload.projectName ?? payload.projectId ?? '')
        const created = Boolean(payload.created)
        setStatus(created ? `已建项并进入舞台 · ${name}` : `已对齐项目舞台 · ${name}`)
      }
    } else if (res.error) {
      notify.error(res.error)
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

type ConfirmBody = {
  code?: string
  ledger?: ConfirmLedgerRow[]
  hardRisk: boolean
  softRisk: boolean
}

function pushLedger(rows: ConfirmLedgerRow[], label: string, value: string, tone?: ConfirmLedgerRow['tone']) {
  const v = value.trim()
  if (!v) return
  rows.push({ label, value: v, tone })
}

/** formatMcpConfirmBody 拆分账本行与代码块；并标硬/软风险。 */
function formatMcpConfirmBody(preview: unknown, toolName: string): ConfirmBody {
  const toolHard = hardRiskTool(toolName)
  if (preview == null) {
    return {
      ledger: toolName ? [{ label: '工具', value: toolName, tone: 'muted' }] : undefined,
      hardRisk: toolHard,
      softRisk: false,
    }
  }
  if (typeof preview === 'string') {
    const text = formatConfirmCode(preview)
    return { code: text || undefined, hardRisk: toolHard, softRisk: false }
  }
  try {
    const obj = typeof preview === 'object' ? (preview as Record<string, unknown>) : null
    if (!obj) {
      return { code: formatConfirmCode(String(preview)), hardRisk: toolHard, softRisk: false }
    }
    const hard = toolHard || previewMarksHard(obj)
    const soft = !hard && previewMarksSoft(obj)
    const codeRaw = [obj.command, obj.sql, obj.initialCommand, obj.commandPreview]
      .map((v) => (v != null ? String(v) : ''))
      .find((s) => s.trim())
    const desktopApp = toolName.startsWith('desktop_') && obj.app != null ? String(obj.app).trim() : ''
    const desktopText = desktopApp && obj.text != null ? String(obj.text) : ''
    const code = codeRaw ? formatConfirmCode(codeRaw) : desktopText.trim() ? desktopText : undefined

    const ledger: ConfirmLedgerRow[] = []
    const impact = impactFromPreview(obj, toolName)
    if (impact) pushLedger(ledger, '影响', impact)
    if (obj.risk != null && String(obj.risk).trim()) {
      pushLedger(ledger, '风险', String(obj.risk).trim(), hard ? 'danger' : soft ? 'warn' : undefined)
    } else if (hard) {
      pushLedger(ledger, '风险', '硬风险（不可免确认）', 'danger')
    }
    if (desktopApp) {
      const bundle = obj.bundleId != null ? String(obj.bundleId).trim() : ''
      pushLedger(
        ledger,
        '应用',
        `${desktopApp}${bundle && bundle !== desktopApp ? `（${bundle}）` : ''}`,
      )
      if (obj.scope != null) pushLedger(ledger, '范围', String(obj.scope), 'muted')
      if (obj.note != null) pushLedger(ledger, '说明', String(obj.note), 'muted')
    }
    if (toolName) pushLedger(ledger, '工具', toolName, 'muted')
    const hostLabel = [obj.name, obj.host, obj.user]
      .map((v) => (v != null ? String(v).trim() : ''))
      .filter(Boolean)
    if (!(impact && (impact.startsWith('主机') || impact.startsWith('SSH') || impact === '本机终端'))) {
      if (obj.kind === 'local' || obj.localShell) {
        pushLedger(ledger, '目标', '本机', 'muted')
      } else if (hostLabel.length) {
        pushLedger(ledger, '主机', hostLabel.join(' · '), 'muted')
      }
    }
    if (obj.dataGuard) pushLedger(ledger, '数据防护', '已启用', 'danger')
    if (obj.autoExclude != null && String(obj.autoExclude).trim()) {
      pushLedger(ledger, '确认后 exclude', String(obj.autoExclude).trim(), 'warn')
    }
    if (obj.backupBefore) {
      const bak =
        obj.backupDir != null && String(obj.backupDir).trim()
          ? String(obj.backupDir).trim()
          : '/www/backup/wworkbench'
      pushLedger(ledger, '写前备份', `${bak}/<时间戳>/`, 'warn')
    }
    if (Array.isArray(obj.backupPolicies) && obj.backupPolicies.length) {
      pushLedger(
        ledger,
        '备份策略',
        obj.backupPolicies.map((x) => String(x)).filter(Boolean).join('、'),
        'muted',
      )
    }
    for (const key of ['url', 'method', 'path', 'containerId', 'packId', 'releaseId'] as const) {
      const v = obj[key]
      if (v == null || !String(v).trim()) continue
      if (key === 'path' && code) continue
      pushLedger(ledger, key, String(v).trim(), 'muted')
    }
    if (!code && ledger.length === 0) {
      return { code: formatConfirmCode(JSON.stringify(preview, null, 2)), hardRisk: hard, softRisk: soft }
    }
    return { ledger: ledger.length ? ledger : undefined, code, hardRisk: hard, softRisk: soft }
  } catch {
    return { code: formatConfirmCode(String(preview)), hardRisk: toolHard, softRisk: false }
  }
}

function asProductId(v: unknown): ProductId | null {
  const id = String(v ?? '')
  if (id === 'skills') return 'notebook'
  const allowed: ProductId[] = [
    'database',
    'terminal',
    'project',
    'sftp',
    'docker',
    'environment',
    'notebook',
    'httpapi',
    'logs',
    'backup',
    'browser',
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
  setStatus(`待确认 · ${summary}`)
  // 拍板唯一入口：右下角确认弹窗（产品标签 + 结构化账本 + 代码块）
  const body = formatMcpConfirmBody(raw.preview, toolName)
  const outcome = await askConfirmOutcome({
    title: summary,
    ledger: body.ledger,
    code: body.code,
    product: product ?? undefined,
    confirmLabel: String(raw.confirmLabel ?? '').trim() || '执行',
    allowTrust: !body.hardRisk,
    danger: true,
    hardRisk: body.hardRisk,
    softRisk: body.softRisk,
    placement: 'corner',
  })
  const ok = outcome.ok
  const trust = outcome.trust
  try {
    if (pendingId) {
      await api.resolveMCPConfirm(pendingId, ok, trust)
    }
  } catch (err) {
    notify.error(err instanceof Error ? err.message : String(err))
  } finally {
    if (ok && trust) {
      setStatus(`已信任 · ${summary}`)
      notify.success(`已信任并执行 · ${summary}`)
    } else if (ok) {
      setStatus(`已确认 · ${summary}`)
      notify.success(`已确认 · ${summary}`)
    } else {
      setStatus(`已拒绝 · ${summary}`)
      notify.info('已拒绝外置 MCP 操作')
    }
  }
}

/**
 * subscribeMcpConfirm 外置 MCP 危险操作 → 工作台弹窗拍板。
 * 多请求串行，避免 askConfirm 互相顶掉。
 */
export function subscribeMcpConfirm() {
  return EventsOn('mcp:confirm', (raw: Record<string, unknown>) => {
    mcpConfirmQueue = mcpConfirmQueue.then(() => handleMcpConfirm(raw)).catch(() => {})
  })
}

/** subscribeMcpStage 后端阶段推送 → 仅状态栏短讯（拍板细节在 ConfirmDialog）。 */
export function subscribeMcpStage() {
  return EventsOn('mcp:stage', (raw: Record<string, unknown>) => {
    const label = String(raw.label ?? '').trim()
    if (label) setStatus(label)
  })
}

async function handleMcpSkillOffer(raw: Record<string, unknown>) {
  bringWorkbenchForward()
  const name = String(raw.name ?? '').trim()
  const lessons = String(raw.lessons ?? '').trim()
  const prompt = String(raw.offerPrompt ?? '').trim() || '要把这次做法写进 Skill 吗？'
  if (!name || !lessons) return

  const product = asProductId(raw.product)
  if (product) {
    useAppStore.getState().setActiveProduct(product)
  }
  setStatus(`沉淀建议 · ${name}`)

  const ledger: ConfirmLedgerRow[] = [
    { label: 'Skill', value: name },
    { label: '经验', value: lessons.length > 280 ? `${lessons.slice(0, 280)}…` : lessons },
  ]
  const domain = String(raw.domain ?? '').trim()
  if (domain) ledger.push({ label: '域', value: domain, tone: 'muted' })
  const toolName = String(raw.tool ?? '').trim()
  if (toolName) ledger.push({ label: '工具', value: toolName, tone: 'muted' })

  const ok = await askConfirm({
    title: prompt,
    ledger,
    product: product ?? undefined,
    confirmLabel: '写进 Skill',
    cancelLabel: '跳过',
    placement: 'corner',
  })
  if (!ok) {
    setStatus(`已跳过沉淀 · ${name}`)
    notify.info(`已跳过沉淀「${name}」`)
    return
  }
  try {
    await api.updateSkill({
      name,
      intent: `人审沉淀：${prompt}`,
      lessons,
    })
    setStatus(`已沉淀 · ${name}`)
    notify.success(`已写入 Skill「${name}」`)
  } catch (err) {
    notify.error(err instanceof Error ? err.message : String(err))
  }
}

/**
 * subscribeMcpSkillOffer 兼容旧 mcp:skill_offer；主路径已改为 Episode 成长卡。
 * 与危险确认串行同一视线，避免叠窗。
 */
export function subscribeMcpSkillOffer() {
  return EventsOn('mcp:skill_offer', (raw: Record<string, unknown>) => {
    mcpConfirmQueue = mcpConfirmQueue.then(() => handleMcpSkillOffer(raw)).catch(() => {})
  })
}

async function handleMcpEpisodeClose(raw: Record<string, unknown>) {
  bringWorkbenchForward()
  const episodeId = String(raw.episodeId ?? '').trim()
  if (!episodeId) return

  const skillPath = String(raw.skillPath ?? '').trim()
  const intent = String(raw.intent ?? '').trim()
  const benefit = String(raw.benefit ?? '').trim()
  const prompt =
    String(raw.offerPrompt ?? '').trim() || '勾选要写进项目 Skill 的条目'
  const title = String(raw.title ?? '').trim() || '本回合可记住这些'
  const restoreHint = String(raw.restoreHint ?? '').trim()

  const rawChoices = Array.isArray(raw.choices) ? raw.choices : []
  const choices: ConfirmChoice[] = []
  for (const c of rawChoices) {
    if (!c || typeof c !== 'object') continue
    const row = c as Record<string, unknown>
    const id = String(row.id ?? '').trim()
    const label = String(row.label ?? '').trim()
    if (!id || !label) continue
    const detail = String(row.detail ?? '').trim()
    choices.push({
      id,
      label,
      detail: detail || undefined,
      defaultChecked: row.defaultChecked !== false,
    })
  }

  if (choices.length === 0 && Number(raw.trustCount ?? 0) <= 0) return

  setStatus(
    `回合可沉淀 · ${choices.length || Number(raw.pendingCount ?? 0)} 条` +
      (intent ? ` · ${intent.slice(0, 24)}` : ''),
  )

  const ledger: ConfirmLedgerRow[] = []
  if (benefit) ledger.push({ label: '收益', value: benefit })
  if (skillPath) ledger.push({ label: 'Skill', value: skillPath, tone: 'muted' })
  if (intent) ledger.push({ label: '目标', value: intent.length > 80 ? `${intent.slice(0, 80)}…` : intent })
  if (restoreHint) ledger.push({ label: '撤销', value: restoreHint, tone: 'muted' })

  const outcome = await askConfirmOutcome({
    title,
    message: choices.length ? prompt : '本回合信任已写入；确认收口或跳过。',
    ledger: ledger.length ? ledger : undefined,
    choices: choices.length ? choices : undefined,
    confirmLabel: choices.length ? '记住勾选' : '完成本回合',
    cancelLabel: '跳过',
    placement: 'corner',
  })

  try {
    if (!outcome.ok) {
      await api.closeLearningEpisode({ episodeId, skip: true, intent: intent || '跳过沉淀' })
      setStatus('已跳过本回合沉淀')
      notify.info('已跳过本回合沉淀')
      return
    }
    const res = await api.closeLearningEpisode({
      episodeId,
      selectedIds: outcome.selectedIds,
      skip: false,
      intent: intent || '回合收口',
    })
    const written = Number((res as { written?: number })?.written ?? 0)
    setStatus(written > 0 ? `已沉淀 ${written} 条 · 下次少问` : '本回合已收口')
    notify.success(written > 0 ? `已写入 Skill（${written} 条）` : '本回合已收口')
  } catch (err) {
    notify.error(err instanceof Error ? err.message : String(err))
  }
}

/** subscribeMcpEpisodeClose 回合成长卡：勾选 → close_learning_episode。 */
export function subscribeMcpEpisodeClose() {
  return EventsOn('mcp:episode_close', (raw: Record<string, unknown>) => {
    mcpConfirmQueue = mcpConfirmQueue.then(() => handleMcpEpisodeClose(raw)).catch(() => {})
  })
}

async function handleMcpHarnessEvolve(raw: Record<string, unknown>) {
  bringWorkbenchForward()
  const candidateId = String(raw.candidateId ?? '').trim()
  if (!candidateId) return

  const skillPath = String(raw.skillPath ?? '').trim()
  const summary = String(raw.summary ?? '').trim()
  const scoreTotal = Number(raw.scoreTotal ?? 0)
  const scorePass = raw.scorePass === true
  const minScore = Number(raw.minScore ?? 55)
  const title = String(raw.title ?? '').trim() || 'Skill 可升版（harness 进化）'
  const benefit = String(raw.benefit ?? '').trim()
  const prompt =
    String(raw.offerPrompt ?? '').trim() ||
    '评测通过则可升版；升版会 pin 旧版，写错可 restore。'
  const patch = String(raw.lessonsPatch ?? '').trim()
  const breakdown = Array.isArray(raw.breakdown)
    ? raw.breakdown.map((x) => String(x)).filter(Boolean)
    : []

  setStatus(
    `进化候选 · ${scoreTotal} 分` + (skillPath ? ` · ${skillPath.slice(0, 28)}` : ''),
  )

  const ledger: ConfirmLedgerRow[] = []
  if (benefit) ledger.push({ label: '收益', value: benefit })
  if (skillPath) ledger.push({ label: 'Skill', value: skillPath, tone: 'muted' })
  ledger.push({
    label: '评测',
    value: `${scoreTotal} / 100（门槛 ${minScore}${scorePass ? ' · 达标' : ' · 未达标'}）`,
  })
  if (summary) ledger.push({ label: '摘要', value: summary.length > 80 ? `${summary.slice(0, 80)}…` : summary })
  if (breakdown.length) {
    ledger.push({ label: '细项', value: breakdown.slice(0, 4).join('；'), tone: 'muted' })
  }
  if (patch) {
    ledger.push({
      label: '补丁',
      value: patch.length > 160 ? `${patch.slice(0, 160)}…` : patch,
      tone: 'muted',
    })
  }

  const outcome = await askConfirmOutcome({
    title,
    message: prompt,
    ledger: ledger.length ? ledger : undefined,
    confirmLabel: scorePass ? '升版' : '仍要升版',
    cancelLabel: '丢弃',
    placement: 'corner',
  })

  try {
    if (!outcome.ok) {
      await api.discardHarnessCandidate({ candidateId })
      setStatus('已丢弃进化候选')
      notify.info('已丢弃 harness 进化候选')
      return
    }
    const res = await api.promoteHarnessCandidate({
      candidateId,
      force: !scorePass,
      intent: summary || 'harness 升版',
    })
    const path = String((res as { skillPath?: string })?.skillPath ?? skillPath)
    setStatus(path ? `Harness 已升版 · ${path}` : 'Harness 已升版')
    notify.success(path ? `已升版 Skill · ${path}` : 'Harness 已升版')
  } catch (err) {
    notify.error(err instanceof Error ? err.message : String(err))
  }
}

/** subscribeMcpHarnessEvolve Skill 进化卡：升版 / 丢弃。 */
export function subscribeMcpHarnessEvolve() {
  return EventsOn('mcp:harness_evolve', (raw: Record<string, unknown>) => {
    mcpConfirmQueue = mcpConfirmQueue.then(() => handleMcpHarnessEvolve(raw)).catch(() => {})
  })
}

/** subscribeCommandResults 订阅命令执行结果。 */
export function subscribeCommandResults(onResult: (raw: Record<string, unknown>) => void) {
  return EventsOn('workbench:command:result', onResult)
}
