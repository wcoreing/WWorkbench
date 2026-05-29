/** selectionHint 生成多选传输提示文案 */
export function selectionHint(names: string[]): string | undefined {
  if (names.length === 0) return undefined
  if (names.length === 1) return names[0]
  return `${names.length} 项`
}
