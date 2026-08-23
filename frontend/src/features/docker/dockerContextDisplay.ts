import type { DockerContext, SSHHost } from '../../api/types'

export const LOCAL_DOCKER_CONTEXT = 'local'

export const DEFAULT_LOCAL_DOCKER_CONTEXT: DockerContext = {
  id: LOCAL_DOCKER_CONTEXT,
  name: 'Local Docker',
  kind: 'local',
  endpoint: 'unix:///var/run/docker.sock',
  connected: false,
}

/** canDeleteDockerContext 是否允许删除（本地默认上下文不可删）。 */
export function canDeleteDockerContext(ctx: DockerContext | undefined): boolean {
  if (!ctx) return false
  return ctx.id !== LOCAL_DOCKER_CONTEXT && ctx.kind !== 'local'
}

/** contextDisplayName 本地化上下文显示名。 */
export function contextDisplayName(ctx: DockerContext, localLabel: string) {
  if (ctx.id === LOCAL_DOCKER_CONTEXT && ctx.kind === 'local') return localLabel
  return ctx.name
}

/** contextEndpointLabel 展示 Docker 上下文端点（远程优先显示 SSH 地址）。 */
export function contextEndpointLabel(ctx: DockerContext, sshHosts: SSHHost[]) {
  if (ctx.id === LOCAL_DOCKER_CONTEXT) return ctx.endpoint
  const ssh = ctx.sshHostId ? sshHosts.find((h) => h.id === ctx.sshHostId) : undefined
  if (ssh) return `${ssh.user}@${ssh.host}:${ssh.port || 22}`
  return ctx.endpoint
}

/** upsertDockerContext 将远程上下文合并进列表（本地项保持首位）。 */
export function upsertDockerContext(list: DockerContext[], ctx: DockerContext): DockerContext[] {
  if (ctx.id === LOCAL_DOCKER_CONTEXT) return list
  const local = list.find((c) => c.id === LOCAL_DOCKER_CONTEXT)
  const remotes = list.filter((c) => c.id !== LOCAL_DOCKER_CONTEXT && c.id !== ctx.id)
  remotes.unshift(ctx)
  return local ? [local, ...remotes] : remotes
}
