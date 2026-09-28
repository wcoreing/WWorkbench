/** formatBytes 格式化文件大小。 */
export function formatBytes(size: number): string {
  if (size < 1024) return `${size} B`
  if (size < 1024 * 1024) return `${(size / 1024).toFixed(1)} KB`
  if (size < 1024 * 1024 * 1024) return `${(size / 1024 / 1024).toFixed(1)} MB`
  return `${(size / 1024 / 1024 / 1024).toFixed(1)} GB`
}

/** formatModTime 格式化修改时间（宝塔式完整日期时间）。 */
export function formatModTime(ts: number): string {
  if (!ts) return '-'
  const d = new Date(ts * 1000)
  const p = (n: number) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}:${p(d.getSeconds())}`
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

/** shellSingleQuote 用单引号包裹路径，供 cd 等命令注入。 */
export function shellSingleQuote(path: string): string {
  return `'${path.replace(/'/g, `'\\''`)}'`
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

/** PathCrumb 面包屑一段。 */
export interface PathCrumb {
  label: string
  path: string
}

/** splitPathCrumbs 将路径拆成可点击面包屑（本地 / 远程）。 */
export function splitPathCrumbs(path: string, side: 'local' | 'remote'): PathCrumb[] {
  const raw = path.trim()
  if (!raw) return [{ label: side === 'remote' ? '/' : '.', path: side === 'remote' ? '/' : raw }]

  if (side === 'remote' || raw.startsWith('/')) {
    const parts = raw.split('/').filter(Boolean)
    const crumbs: PathCrumb[] = [{ label: '/', path: '/' }]
    let acc = ''
    for (const part of parts) {
      acc += `/${part}`
      crumbs.push({ label: part, path: acc })
    }
    return crumbs
  }

  const sep = raw.includes('\\') ? '\\' : '/'
  const parts = raw.split(/[/\\]/).filter(Boolean)
  if (parts.length === 0) return [{ label: raw, path: raw }]
  const crumbs: PathCrumb[] = []
  let acc = ''
  for (let i = 0; i < parts.length; i++) {
    const part = parts[i]
    if (i === 0 && /^[A-Za-z]:$/.test(part)) {
      acc = part + sep
      crumbs.push({ label: part, path: acc })
      continue
    }
    acc = acc ? `${acc.replace(/[/\\]$/, '')}${sep}${part}` : part
    crumbs.push({ label: part, path: acc })
  }
  return crumbs
}
