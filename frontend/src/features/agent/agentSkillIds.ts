/** mergeSkillIds 合并多组 skill id 并去重。 */
export function mergeSkillIds(...groups: string[][]): string[] {
  return [...new Set(groups.flat().map((id) => id.trim()).filter(Boolean))]
}

/** buildSkillLabelMap 由技能列表生成 id → 展示名映射。 */
export function buildSkillLabelMap(skills: { id: string; name: string }[]): Record<string, string> {
  const out: Record<string, string> = {}
  for (const s of skills) out[s.id] = s.name
  return out
}
