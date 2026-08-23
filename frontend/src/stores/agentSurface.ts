/** AgentSurface 界面快照：人正在看什么（进 AgentContext / feedforward）。 */
export interface AgentSurface {
  focusKind: string
  focusLabel: string
  table?: string
  database?: string
  connectionId?: string
  sessionId?: string
	/** SSH / Docker shell / SFTP 主机 id（供 auto @） */
	hostId?: string
	/** 当前打开的笔记 id */
	noteId?: string
	tabTitle?: string
  openTabsBrief?: string
  selectionBrief?: string
}

export const emptyAgentSurface = (): AgentSurface => ({
  focusKind: '',
  focusLabel: '',
})

/** briefList 截断列表摘要。 */
export function briefList(items: string[], max = 8): string {
  const clean = items.map((s) => s.trim()).filter(Boolean)
  if (clean.length === 0) return ''
  if (clean.length <= max) return clean.join(' · ')
  return `${clean.slice(0, max).join(' · ')}…(+${clean.length - max})`
}

export interface DbTabLike {
  id: string
  kind: string
  title: string
  database?: string
  table?: string
}

/** buildDatabaseSurface 从数据库工作区 Tab 推导界面焦点。 */
export function buildDatabaseSurface(input: {
  tabs: DbTabLike[]
  activeTabId: string | null
  connectionId?: string
  sessionId?: string
  sessionDatabase?: string
}): AgentSurface {
  const active = input.tabs.find((t) => t.id === input.activeTabId) ?? null
  const openTabsBrief = briefList(
    input.tabs.map((t) => {
      if (t.kind === 'table' && t.database && t.table) return `${t.database}.${t.table}(data)`
      if (t.kind === 'design' && t.database) {
        return t.table ? `${t.database}.${t.table}(design)` : `${t.database}(new-table)`
      }
      return `${t.title}(${t.kind})`
    }),
    12,
  )

  if (!active) {
    return {
      focusKind: 'database',
      focusLabel: input.sessionDatabase || '',
      database: input.sessionDatabase || '',
      connectionId: input.connectionId || '',
      sessionId: input.sessionId || '',
      openTabsBrief,
    }
  }

  if (active.kind === 'table' && active.database && active.table) {
    return {
      focusKind: 'table',
      focusLabel: `${active.database}.${active.table}`,
      table: active.table,
      database: active.database,
      connectionId: input.connectionId || '',
      sessionId: input.sessionId || '',
      tabTitle: active.title,
      openTabsBrief,
      selectionBrief: `table ${active.database}.${active.table}`,
    }
  }

  if (active.kind === 'design') {
    const db = active.database || input.sessionDatabase || ''
    const table = active.table || ''
    const label = table ? `${db}.${table}` : db ? `${db} · 建表/改表` : '表设计'
    return {
      focusKind: 'design',
      focusLabel: label,
      table,
      database: db,
      connectionId: input.connectionId || '',
      sessionId: input.sessionId || '',
      tabTitle: active.title,
      openTabsBrief,
    }
  }

  return {
    focusKind: 'sql',
    focusLabel: active.title || 'SQL 查询',
    database: input.sessionDatabase || '',
    connectionId: input.connectionId || '',
    sessionId: input.sessionId || '',
    tabTitle: active.title,
    openTabsBrief,
  }
}

/** buildTerminalSurface 从终端 Tab 推导界面焦点。 */
export function buildTerminalSurface(input: {
  kind: 'local' | 'ssh' | 'docker' | ''
  title: string
  hostId?: string
  hostLabel?: string
  openTabsBrief?: string
}): AgentSurface {
  if (!input.kind) {
    return emptyAgentSurface()
  }
  if (input.kind === 'local') {
    return {
      focusKind: 'terminal.local',
      focusLabel: input.title || '本机终端',
      tabTitle: input.title,
      openTabsBrief: input.openTabsBrief,
    }
  }
  if (input.kind === 'docker') {
    return {
      focusKind: 'terminal.docker',
      focusLabel: input.hostLabel || input.title || input.hostId || '容器 Shell',
      hostId: input.hostId,
      tabTitle: input.title,
      openTabsBrief: input.openTabsBrief,
      selectionBrief: input.hostId ? `docker ${input.hostId}` : undefined,
    }
  }
  return {
    focusKind: 'terminal.ssh',
    focusLabel: input.hostLabel || input.title || input.hostId || 'SSH',
    hostId: input.hostId,
    tabTitle: input.title,
    openTabsBrief: input.openTabsBrief,
    selectionBrief: input.hostId ? `ssh ${input.hostId}` : undefined,
  }
}

/** buildSftpSurface 从 SFTP 会话与路径推导界面焦点。 */
export function buildSftpSurface(input: {
  title?: string
  hostId?: string
  hostLabel?: string
  hostKind?: 'ssh' | 'docker' | ''
  localPath?: string
  remotePath?: string
  localSelected?: string[]
  remoteSelected?: string[]
  openTabsBrief?: string
}): AgentSurface {
  if (!input.hostId && !input.title) {
    return { focusKind: 'sftp', focusLabel: 'SFTP', openTabsBrief: input.openTabsBrief }
  }
  const label = input.hostLabel || input.title || input.hostId || 'SFTP'
  const pathBrief = [input.remotePath ? `remote ${input.remotePath}` : '', input.localPath ? `local ${input.localPath}` : '']
    .filter(Boolean)
    .join(' · ')
  const selParts = [
    briefList((input.remoteSelected || []).map((p) => `R:${p}`), 3),
    briefList((input.localSelected || []).map((p) => `L:${p}`), 3),
  ].filter(Boolean)
  return {
    focusKind: input.hostKind === 'docker' ? 'sftp.docker' : 'sftp',
    focusLabel: label,
    hostId: input.hostId,
    tabTitle: input.title,
    openTabsBrief: input.openTabsBrief,
    selectionBrief: [input.hostId ? `host ${input.hostId}` : '', pathBrief, selParts.join(' · ')].filter(Boolean).join(' · '),
  }
}

/** buildDockerSurface 从 Docker 上下文/容器/镜像视图推导界面焦点。 */
export function buildDockerSurface(input: {
  contextId?: string
  contextLabel?: string
  /** 远程 Docker 上下文关联的 SSH 主机（供 auto @ / 前馈） */
  sshHostId?: string
  sshHostLabel?: string
  view?: string
  containerId?: string
  containerName?: string
  containerState?: string
  composeDir?: string
  imageCount?: number
  openTabsBrief?: string
}): AgentSurface {
  const ctx = input.contextLabel || input.contextId || 'Docker'
  const view = input.view || 'containers'
  const sshHostId = input.sshHostId?.trim() || ''
  const sshHostLabel = input.sshHostLabel?.trim() || sshHostId
  const withSSHHost = <T extends AgentSurface>(surface: T): T =>
    sshHostId ? { ...surface, hostId: sshHostId, selectionBrief: surface.selectionBrief || `ssh ${sshHostId}` } : surface
  if (view === 'compose') {
    return withSSHHost({
      focusKind: 'docker.compose',
      focusLabel: input.composeDir ? `${ctx} · ${input.composeDir}` : `${ctx} · Compose`,
      tabTitle: 'Compose',
      openTabsBrief: input.openTabsBrief,
      selectionBrief: [input.contextId ? `context ${input.contextId}` : '', input.composeDir ? `dir ${input.composeDir}` : '']
        .filter(Boolean)
        .join(' · '),
    })
  }
  if (view === 'images') {
    return withSSHHost({
      focusKind: 'docker.images',
      focusLabel: `${ctx} · 镜像${input.imageCount != null ? ` (${input.imageCount})` : ''}`,
      tabTitle: 'Images',
      openTabsBrief: input.openTabsBrief,
      selectionBrief: input.contextId ? `context ${input.contextId}` : undefined,
    })
  }
  if (input.containerId || input.containerName) {
    const name = input.containerName || input.containerId || ''
    return withSSHHost({
      focusKind: 'docker.container',
      focusLabel: `${ctx} · ${name}${input.containerState ? ` (${input.containerState})` : ''}`,
      tabTitle: name,
      openTabsBrief: input.openTabsBrief,
      selectionBrief: [input.contextId ? `context ${input.contextId}` : '', input.containerId ? `container ${input.containerId}` : '']
        .filter(Boolean)
        .join(' · '),
    })
  }
  return withSSHHost({
    focusKind: 'docker',
    focusLabel: sshHostId ? `${ctx} · ${sshHostLabel}` : ctx,
    tabTitle: 'Containers',
    openTabsBrief: input.openTabsBrief,
    selectionBrief: input.contextId ? `context ${input.contextId}` : undefined,
  })
}

/** buildNotebookSurface 从笔记本打开标签推导界面焦点。 */
export function buildNotebookSurface(input: {
  noteId?: string | null
  title?: string
  language?: string
  groupLabel?: string
  openTabsBrief?: string
  sshHostId?: string
  connectionId?: string
}): AgentSurface {
  if (!input.noteId) {
    return {
      focusKind: 'notebook',
      focusLabel: '笔记本',
      openTabsBrief: input.openTabsBrief,
    }
  }
  const label = input.title || '未命名笔记'
  return {
    focusKind: 'notebook.note',
    focusLabel: input.groupLabel ? `${input.groupLabel} / ${label}` : label,
    noteId: input.noteId,
    tabTitle: label,
    openTabsBrief: input.openTabsBrief,
    connectionId: input.connectionId || '',
    selectionBrief: [
      `note ${input.noteId}`,
      input.language ? `lang ${input.language}` : '',
      input.sshHostId ? `ssh ${input.sshHostId}` : '',
      input.connectionId ? `db ${input.connectionId}` : '',
    ]
      .filter(Boolean)
      .join(' · '),
  }
}

/** buildHttpApiSurface 从当前 HTTP 请求推导界面焦点。 */
export function buildHttpApiSurface(input: {
  requestId?: string
  name?: string
  method?: string
  url?: string
  folderLabel?: string
  envLabel?: string
  openTabsBrief?: string
}): AgentSurface {
  const method = (input.method || 'GET').toUpperCase()
  const name = input.name || '未命名请求'
  const label = input.url ? `${method} ${name}` : name
  return {
    focusKind: input.requestId ? 'http.request' : 'httpapi',
    focusLabel: input.folderLabel ? `${input.folderLabel} / ${label}` : label,
    tabTitle: name,
    openTabsBrief: input.openTabsBrief,
    selectionBrief: [
      input.requestId ? `http ${input.requestId}` : '',
      input.url ? `${method} ${input.url}` : method,
      input.envLabel ? `env ${input.envLabel}` : '',
    ]
      .filter(Boolean)
      .join(' · '),
  }
}

/** buildLogsSurface 从日志源推导界面焦点。 */
export function buildLogsSurface(input: {
  sourceId?: string
  name?: string
  sourceType?: string
  path?: string
  containerId?: string
  followLive?: boolean
  openTabsBrief?: string
}): AgentSurface {
  if (!input.sourceId && !input.name) {
    return { focusKind: 'logs', focusLabel: '日志中心', openTabsBrief: input.openTabsBrief }
  }
  const name = input.name || input.sourceId || '日志源'
  return {
    focusKind: 'logs.source',
    focusLabel: input.sourceType ? `${name} (${input.sourceType})` : name,
    tabTitle: name,
    openTabsBrief: input.openTabsBrief,
    selectionBrief: [
      input.sourceId ? `log ${input.sourceId}` : '',
      input.path ? `path ${input.path}` : '',
      input.containerId ? `container ${input.containerId}` : '',
      input.followLive ? 'follow live' : '',
    ]
      .filter(Boolean)
      .join(' · '),
  }
}

/** buildEnvironmentSurface 从本机环境/预设推导界面焦点。 */
export function buildEnvironmentSurface(input: {
  presetId?: string
  presetName?: string
  scanPath?: string
  runtimeBrief?: string
  openTabsBrief?: string
}): AgentSurface {
  if (input.presetId || input.presetName) {
    return {
      focusKind: 'environment.preset',
      focusLabel: input.presetName || input.presetId || '环境预设',
      tabTitle: input.presetName,
      openTabsBrief: input.openTabsBrief,
      selectionBrief: [
        input.presetId ? `preset ${input.presetId}` : '',
        input.scanPath ? `scan ${input.scanPath}` : '',
        input.runtimeBrief || '',
      ]
        .filter(Boolean)
        .join(' · '),
    }
  }
  return {
    focusKind: 'environment',
    focusLabel: input.scanPath || '本机环境',
    openTabsBrief: input.openTabsBrief,
    selectionBrief: [input.scanPath ? `scan ${input.scanPath}` : '', input.runtimeBrief || ''].filter(Boolean).join(' · '),
  }
}

/** buildSkillsSurface 从技能工作区推导界面焦点。 */
export function buildSkillsSurface(input: {
  skillId?: string
  name?: string
  openTabsBrief?: string
}): AgentSurface {
  const label = input.name?.trim() || input.skillId?.trim() || '技能'
  return {
    focusKind: 'skill',
    focusLabel: label,
    tabTitle: input.skillId ? `/${input.skillId}` : label,
    openTabsBrief: input.openTabsBrief,
    selectionBrief: input.skillId ? `skill ${input.skillId}` : '',
  }
}
