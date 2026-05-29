/** formatBytes 格式化文件大小。 */
export function formatBytes(size: number): string {
  if (size < 1024) return `${size} B`
  if (size < 1024 * 1024) return `${(size / 1024).toFixed(1)} KB`
  if (size < 1024 * 1024 * 1024) return `${(size / 1024 / 1024).toFixed(1)} MB`
  return `${(size / 1024 / 1024 / 1024).toFixed(1)} GB`
}

/** formatModTime 格式化修改时间。 */
export function formatModTime(ts: number): string {
  if (!ts) return '-'
  return new Date(ts * 1000).toLocaleString('zh-CN', {
    month: 'short',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  })
}

/** formatFullModTime 格式化完整修改时间（冲突对比用）。 */
export function formatFullModTime(ts: number): string {
  if (!ts) return '-'
  return new Date(ts * 1000).toLocaleString('zh-CN')
}

/** parentLocalPath 返回上级本地目录。 */
export function parentLocalPath(path: string): string {
  const parts = path.split(/[/\\]/).filter(Boolean)
  if (parts.length <= 1) return path.startsWith('/') ? '/' : parts[0] ? `${parts[0]}/` : path
  parts.pop()
  const isUnix = path.startsWith('/')
  return isUnix ? `/${parts.join('/')}` : parts.join('/')
}

/** parentRemotePath 返回上级远程目录。 */
export function parentRemotePath(path: string): string {
  if (path === '/' || path === '') return '/'
  const parts = path.split('/').filter(Boolean)
  parts.pop()
  return parts.length ? `/${parts.join('/')}` : '/'
}

/** joinRemotePath 拼接远程路径。 */
export function joinRemotePath(dir: string, name: string): string {
  const base = dir.endsWith('/') ? dir.slice(0, -1) : dir
  return `${base}/${name}`
}

/** joinLocalPath 拼接本地路径。 */
export function joinLocalPath(dir: string, name: string): string {
  const sep = dir.includes('\\') ? '\\' : '/'
  const base = dir.endsWith(sep) ? dir.slice(0, -1) : dir
  return `${base}${sep}${name}`
}

/** siblingPath 在同目录下生成新路径。 */
export function siblingPath(entryPath: string, newName: string): string {
  const isWin = entryPath.includes('\\')
  const sep = isWin ? '\\' : '/'
  const parts = entryPath.split(/[/\\]/).filter(Boolean)
  parts.pop()
  parts.push(newName)
  if (entryPath.startsWith('/')) return `/${parts.join('/')}`
  if (/^[A-Za-z]:/.test(entryPath) && parts.length > 0) return `${parts[0]}${sep}${parts.slice(1).join(sep)}`
  return parts.join(sep)
}
