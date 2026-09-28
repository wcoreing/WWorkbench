/** 笔记本编辑区 / 预览字号档位（与界面全局 zoom 独立）。 */
export const NOTEBOOK_EDITOR_FONT_SIZES = [12, 13, 14, 15, 16, 18] as const
export type NotebookEditorFontSize = (typeof NOTEBOOK_EDITOR_FONT_SIZES)[number]
export const DEFAULT_NOTEBOOK_EDITOR_FONT: NotebookEditorFontSize = 13
export const NOTEBOOK_EDITOR_FONT_SETTING_KEY = 'notebook_editor_font_size'

/** clampNotebookEditorFontSize 限制到可用档位。 */
export function clampNotebookEditorFontSize(value: number): NotebookEditorFontSize {
  const n = Math.round(value)
  if ((NOTEBOOK_EDITOR_FONT_SIZES as readonly number[]).includes(n)) {
    return n as NotebookEditorFontSize
  }
  if (n < NOTEBOOK_EDITOR_FONT_SIZES[0]) return NOTEBOOK_EDITOR_FONT_SIZES[0]
  return NOTEBOOK_EDITOR_FONT_SIZES[NOTEBOOK_EDITOR_FONT_SIZES.length - 1]
}
