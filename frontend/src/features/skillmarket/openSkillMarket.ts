import { useAppStore } from '../../stores/appStore'

/** openSkillMarket 切换到技能市场一级产品（账号菜单 / 深链入口）。 */
export function openSkillMarket() {
  useAppStore.getState().setActiveProduct('skillmarket')
}
