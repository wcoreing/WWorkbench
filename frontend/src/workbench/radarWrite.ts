/** 本机 UI 笔记本路径写：侧栏已 remap/refresh，雷达再处理会重复。 */
export function isUINotebookPathWrite(writeId: string | undefined | null): boolean {
  const wid = (writeId || '').toLowerCase()
  return (
    wid === 'ui-notebook-rename' ||
    wid === 'ui-notebook-move' ||
    wid === 'ui-notebook-copy' ||
    wid === 'ui-notebook-delete-path' ||
    wid === 'ui-notebook-mkdir' ||
    wid === 'ui-notebook-create-file'
  )
}

/** 本机 UI 笔记写（含路径/保存）：勿回拉正文盖掉正在输入。 */
export function isUINotebookWrite(writeId: string | undefined | null): boolean {
  const wid = (writeId || '').toLowerCase()
  return wid.startsWith('ui-notebook-')
}

/** Agent / MCP 落盘（后续路径工具用）；延后 reveal 策略可挂这里。 */
export function isAgentRadarWrite(writeId: string | undefined | null): boolean {
  const wid = (writeId || '').toLowerCase()
  if (!wid) return false
  return wid.startsWith('mcp-') || wid.startsWith('agent-')
}
