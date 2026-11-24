/** CapabilityRow AI 能力权限行。 */
export interface CapabilityRow {
  name: string
  label: string
  domain: string
  risk: string
  description: string
  enabled: boolean
}

export type AgentPanelView = 'chat' | 'config' | 'permissions'

/** DOMAIN_ORDER 设置页分组顺序。 */
export const DOMAIN_ORDER = [
  'core',
  'terminal',
  'cloud',
  'database',
  'notebook',
  'skillmarket',
  'project',
  'browser',
  'desktop',
  'docker',
  'backup',
  'http',
  'logs',
  'environment',
  'plugin',
  'other',
] as const
