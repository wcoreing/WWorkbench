import type { ConnectionDraft } from '../stores/appStore'
import { Capability } from './capabilities'
import { openCapability, type CommandSource } from './workbenchCommandBus'

/**
 * 基于已有资产外键的跨产品打开（不另建关系表）。
 * 外键约定：DockerContext.sshHostId、LogSource.{sshHostId,dockerContextId,containerId}、
 * Connection.sshHostId、Note.{sshHostId,connectionId}、ShellHost.{contextId,containerId}。
 */

/** openTerminal 打开本机或 SSH/容器终端。 */
export function openTerminal(
  opts: { hostId?: string; localShell?: boolean; initialCommand?: string },
  source: CommandSource = 'user',
) {
  openCapability(
    Capability.ShellRun,
    {
      hostId: opts.hostId,
      localShell: opts.localShell,
      initialCommand: opts.initialCommand,
    },
    source,
  )
}

/** openSftp 打开 SFTP（hostId 可为 SSH 或 Docker ShellHost）。 */
export function openSftp(opts: { hostId: string }, source: CommandSource = 'user') {
  openCapability(Capability.SftpOpen, { hostId: opts.hostId }, source)
}

/** openDatabase 打开数据库工作台。 */
export function openDatabase(
  opts: {
    connectionId?: string
    initialSql?: string
    runSql?: boolean
    connectionDraft?: ConnectionDraft
  },
  source: CommandSource = 'user',
) {
  openCapability(
    Capability.DatabaseOpen,
    {
      connectionId: opts.connectionId,
      initialSql: opts.initialSql,
      runSql: opts.runSql,
      connectionDraft: opts.connectionDraft,
    },
    source,
  )
}

/** openNotebook 按主机/连接创建或打开笔记。 */
export function openNotebook(
  opts: { hostId?: string; connectionId?: string; initialCommand?: string },
  source: CommandSource = 'user',
) {
  openCapability(
    Capability.NotebookOpen,
    {
      hostId: opts.hostId,
      connectionId: opts.connectionId,
      initialCommand: opts.initialCommand,
    },
    source,
  )
}

/** openDockerContextFromHost 从 SSH 主机登记 Docker 上下文。 */
export function openDockerContextFromHost(opts: { hostId: string }, source: CommandSource = 'user') {
  openCapability(Capability.DockerContextOpen, { hostId: opts.hostId }, source)
}

/** openLogs 打开日志中心（已有 logSourceId，或按外键起草 Docker/SSH 日志源）。 */
export function openLogs(
  opts: {
    logSourceId?: string
    sourceType?: string
    name?: string
    path?: string
    sshHostId?: string
    dockerContextId?: string
    containerId?: string
    composeDir?: string
    composeService?: string
    fetch?: boolean
  },
  source: CommandSource = 'user',
) {
  openCapability(Capability.LogsOpen, { ...opts }, source)
}

/** openHttpApi 打开 API 工作台并可选聚焦请求。 */
export function openHttpApi(opts: { requestId?: string } = {}, source: CommandSource = 'user') {
  openCapability(Capability.HttpApiOpen, { requestId: opts.requestId }, source)
}

/** openEnvironment 打开本机环境工作台，可选聚焦语言版本切换或预设。 */
export function openEnvironment(
  opts: { lang?: string; presetId?: string; openVersions?: boolean } = {},
  source: CommandSource = 'user',
) {
  openCapability(
    Capability.EnvironmentOpen,
    {
      lang: opts.lang,
      presetId: opts.presetId,
      openVersions: opts.openVersions,
    },
    source,
  )
}

/** openSSHForward 打开终端侧栏隧道面板，可选新建或编辑预设。 */
export function openSSHForward(
  opts: { hostId?: string; presetId?: string; openNew?: boolean } = {},
  source: CommandSource = 'user',
) {
  openCapability(
    Capability.SSHForwardOpen,
    {
      hostId: opts.hostId,
      presetId: opts.presetId,
      openNew: opts.openNew ?? Boolean(opts.hostId),
    },
    source,
  )
}
