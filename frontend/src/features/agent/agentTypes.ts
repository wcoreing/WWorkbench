/** CapabilityRow AI 能力权限行。 */
export interface CapabilityRow {
  name: string
  label: string
  risk: string
  description: string
  enabled: boolean
  needsConfirm: boolean
}

export type AgentPanelView = 'chat' | 'config' | 'permissions'
