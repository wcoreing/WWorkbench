import { useMemo } from 'react'
import { pressProps } from '../../components/compat'
import { useAppStore } from '../../stores/appStore'
import type { AgentChatMode } from './agentChatMode'

/** 侧栏空态挂载的桌面微信 Skill（引擎=Agent，headed）。 */
export const WECHAT_FILE_HELPER_SKILL_ID = '微信文件传输助手'

export interface AgentStarterItem {
  id: string
  label: string
  hint?: string
  message: string
  mode?: AgentChatMode
  primary?: boolean
  /** 仅切到终端产品线，不发消息（降低空态摩擦）。 */
  goTerminal?: boolean
  /** 挂载 Skill（首轮 get_skill），如微信发消息。 */
  skillIds?: string[]
}

interface Props {
  t: (key: string, params?: Record<string, string | number>) => string
  busy: boolean
  onSuggest: (item: AgentStarterItem) => void
}

/** buildStarterItems 按当前界面焦点生成空态建议（无环境门槛）。 */
export function buildStarterItems(
  t: Props['t'],
  surface: { focusKind?: string; focusLabel?: string },
  activeProduct: string,
): AgentStarterItem[] {
  const focusKind = surface.focusKind?.trim() || ''
  const focusLabel = surface.focusLabel?.trim() || ''

  if (focusKind.startsWith('terminal.')) {
    return [
      {
        id: 'read-shell',
        label: t('agent.starterReadTerminal'),
        hint: focusLabel ? t('agent.starterFocusHint', { label: focusLabel }) : undefined,
        message: t('agent.starterReadTerminalMsg'),
        mode: 'plan',
        primary: true,
      },
      {
        id: 'host-check',
        label: t('agent.starterHostCheck'),
        message: t('agent.starterHostCheckMsg'),
        mode: 'plan',
      },
      {
        id: 'next-steps',
        label: t('agent.starterNextSteps'),
        message: t('agent.starterNextStepsMsg'),
        mode: 'ask',
      },
    ]
  }

  if (activeProduct === 'database' && focusKind) {
    return [
      {
        id: 'db-overview',
        label: t('agent.starterDbOverview'),
        hint: focusLabel ? t('agent.starterFocusHint', { label: focusLabel }) : undefined,
        message: t('agent.starterDbOverviewMsg'),
        mode: 'plan',
        primary: true,
      },
      {
        id: 'next-steps',
        label: t('agent.starterNextSteps'),
        message: t('agent.starterNextStepsMsg'),
        mode: 'ask',
      },
    ]
  }

  if (activeProduct === 'project' || focusKind === 'project') {
    return [
      {
        id: 'project-round',
        label: t('agent.starterProjectRound'),
        hint: focusLabel ? t('agent.starterFocusHint', { label: focusLabel }) : undefined,
        message: t('agent.starterProjectRoundMsg'),
        mode: 'ask',
        primary: true,
      },
      {
        id: 'project-distill',
        label: t('agent.starterProjectDistill'),
        message: t('agent.starterProjectDistillMsg'),
        mode: 'agent',
      },
      {
        id: 'next-steps',
        label: t('agent.starterNextSteps'),
        message: t('agent.starterNextStepsMsg'),
        mode: 'ask',
      },
    ]
  }

  const items: AgentStarterItem[] = [
    {
      id: 'wechat-file-helper',
      label: t('agent.starterWechatSend'),
      hint: t('agent.starterWechatSendHint'),
      message: t('agent.starterWechatSendMsg'),
      mode: 'agent',
      skillIds: [WECHAT_FILE_HELPER_SKILL_ID],
      primary: true,
    },
  ]
  if (activeProduct !== 'terminal') {
    items.push({
      id: 'go-terminal',
      label: t('agent.starterOpenTerminal'),
      hint: t('agent.starterOpenTerminalHint'),
      message: '',
      goTerminal: true,
    })
  } else {
    items.push({
      id: 'open-then-ask',
      label: t('agent.starterOpenTerminal'),
      hint: t('agent.starterOpenTerminalHint'),
      message: t('agent.starterOpenTerminalMsg'),
      mode: 'ask',
    })
  }
  items.push({
    id: 'what-open',
    label: t('agent.starterWhatOpen'),
    message: t('agent.starterWhatOpenMsg'),
    mode: 'ask',
  })
  return items.slice(0, 3)
}

/** AgentStarter 空对话建议卡：降低上手摩擦，引导读当前终端/焦点。 */
export function AgentStarter({ t, busy, onSuggest }: Props) {
  const activeProduct = useAppStore((s) => s.activeProduct)
  const agentSurface = useAppStore((s) => s.agentSurface)
  const items = useMemo(
    () => buildStarterItems(t, agentSurface, activeProduct),
    [t, agentSurface, activeProduct],
  )

  return (
    <div className="agent-starter">
      <p className="agent-starter-lead">{t('agent.starterLead')}</p>
      <div className="agent-starter-list">
        {items.map((item) => (
          <button
            key={item.id}
            type="button"
            className={`agent-starter-card${item.primary ? ' is-primary' : ''}`}
            disabled={busy}
            {...pressProps(() => onSuggest(item))}
          >
            <span className="agent-starter-card-label">{item.label}</span>
            {item.hint ? <span className="agent-starter-card-hint">{item.hint}</span> : null}
          </button>
        ))}
      </div>
    </div>
  )
}
