import type { ProductId } from '../shell/products'

/** Wails WebView 中 window.confirm 不可靠，统一走应用内 ConfirmDialog。 */

/** ConfirmLedgerRow 确认账本一行（影响 / 风险 / 工具…）。 */
export type ConfirmLedgerRow = {
  label: string
  value: string
  /** danger=硬风险；warn=软风险；muted=次要 */
  tone?: 'danger' | 'warn' | 'muted'
}

export type ConfirmRequest = {
  title: string
  /** 普通说明；与 ledger 二选一优先 ledger */
  message?: string
  /** 结构化账本 */
  ledger?: ConfirmLedgerRow[]
  /** 命令 / SQL 等，弹窗内以代码块展示 */
  code?: string
  /** 触及的产品线 */
  product?: ProductId
  confirmLabel?: string
  cancelLabel?: string
  /** 非硬风险时显示「信任并执行」 */
  allowTrust?: boolean
  danger?: boolean
  /** 确认经济：硬风险不可免 */
  hardRisk?: boolean
  /** 软风险（可被目录护照免除，本次仍需拍板） */
  softRisk?: boolean
  /** center=居中遮罩；corner=右下角面板（MCP 拍板） */
  placement?: 'center' | 'corner'
}

/** ConfirmOutcome 拍板结果；trust 仅在 ok 时有意义。 */
export type ConfirmOutcome = { ok: boolean; trust: boolean }

type Listener = () => void

let current: ConfirmRequest | null = null
let resolver: ((outcome: ConfirmOutcome) => void) | null = null
const listeners = new Set<Listener>()

function notify() {
  for (const l of listeners) l()
}

/** subscribeConfirmDialog 供 ConfirmHost 订阅状态。 */
export function subscribeConfirmDialog(listener: Listener): () => void {
  listeners.add(listener)
  return () => listeners.delete(listener)
}

/** getConfirmDialogState 当前弹窗请求。 */
export function getConfirmDialogState(): ConfirmRequest | null {
  return current
}

/** askConfirmOutcome 弹出确认；完整结果含 trust。 */
export function askConfirmOutcome(req: ConfirmRequest): Promise<ConfirmOutcome> {
  if (resolver) {
    resolver({ ok: false, trust: false })
    resolver = null
  }
  const hardRisk = !!req.hardRisk
  current = {
    title: req.title,
    message: req.message,
    ledger: req.ledger?.length ? req.ledger : undefined,
    code: req.code?.trim() ? req.code : undefined,
    product: req.product,
    confirmLabel: req.confirmLabel,
    cancelLabel: req.cancelLabel,
    allowTrust: !hardRisk && !!req.allowTrust,
    danger: !!req.danger,
    hardRisk,
    softRisk: !!req.softRisk && !hardRisk,
    placement: req.placement === 'corner' ? 'corner' : 'center',
  }
  notify()
  return new Promise((resolve) => {
    resolver = resolve
  })
}

/** askConfirm 弹出确认；确定 → true，取消/关闭 → false（忽略 trust）。 */
export function askConfirm(req: ConfirmRequest): Promise<boolean> {
  return askConfirmOutcome(req).then((o) => o.ok)
}

/** resolveConfirm 关闭弹窗并回传结果。 */
export function resolveConfirm(ok: boolean, trust = false) {
  current = null
  const r = resolver
  resolver = null
  notify()
  r?.({ ok, trust: ok && trust })
}
