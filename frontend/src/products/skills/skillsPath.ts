/** isSkillMarkdown 是否 SKILL.md（走元数据 API）。 */
export function isSkillMarkdown(path: string): boolean {
  return /\/SKILL\.md$/i.test(path) || /^[^/]+\/SKILL\.md$/i.test(path)
}

/** skillIdFromPath 从相对路径取 skill id。 */
export function skillIdFromPath(path: string): string {
  return path.split('/')[0]?.trim() ?? ''
}
