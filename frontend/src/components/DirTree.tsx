import { useCallback, useEffect, useState } from 'react'
import { IconFolder } from './Icons'
import { pressProps } from './compat'

export interface DirEntry {
  name: string
  path: string
  isDir: boolean
}

interface DirTreeProps {
  rootLabel: string
  listDir: (subPath: string) => Promise<DirEntry[]>
  activePath: string
  onSelectFile: (path: string) => void
  filter?: string
  refreshKey?: number | string
}

function matchesFilter(entry: DirEntry, filter: string): boolean {
  const q = filter.trim().toLowerCase()
  if (!q) return true
  return entry.name.toLowerCase().includes(q) || entry.path.toLowerCase().includes(q)
}

function DirTreeNode({
  entry,
  depth,
  listDir,
  activePath,
  onSelectFile,
  filter = '',
  refreshKey,
}: {
  entry: DirEntry
  depth: number
  listDir: (subPath: string) => Promise<DirEntry[]>
  activePath: string
  onSelectFile: (path: string) => void
  filter?: string
  refreshKey?: number | string
}) {
  const [open, setOpen] = useState(depth < 1)
  const [children, setChildren] = useState<DirEntry[]>([])
  const [loadedKey, setLoadedKey] = useState<string | number | undefined>(undefined)

  const loadChildren = useCallback(async () => {
    if (!entry.isDir) return
    const list = await listDir(entry.path)
    setChildren(list)
    setLoadedKey(refreshKey)
  }, [entry.isDir, entry.path, listDir, refreshKey])

  useEffect(() => {
    if (!entry.isDir || !open) return
    if (loadedKey === refreshKey && children.length > 0) return
    void loadChildren()
  }, [open, entry.isDir, loadChildren, loadedKey, refreshKey, children.length])

  useEffect(() => {
    setChildren([])
    setLoadedKey(undefined)
  }, [refreshKey])

  if (entry.isDir) {
    const visible = filter.trim() ? children.filter((c) => matchesFilter(c, filter)) : children
    const showChildren = open && (visible.length > 0 || !filter.trim())

    return (
      <>
        <button
          type="button"
          className={`dir-tree-row dir-tree-dir${open ? ' is-open' : ''}`}
          style={{ paddingLeft: 8 + depth * 12 }}
          {...pressProps(() => setOpen((v) => !v))}
        >
          <span className="dir-tree-chevron">{open ? '▾' : '▸'}</span>
          <IconFolder size={14} />
          <span className="dir-tree-name">{entry.name}</span>
        </button>
        {showChildren &&
          visible.map((c) => (
            <DirTreeNode
              key={c.path}
              entry={c}
              depth={depth + 1}
              listDir={listDir}
              activePath={activePath}
              onSelectFile={onSelectFile}
              filter={filter}
              refreshKey={refreshKey}
            />
          ))}
      </>
    )
  }

  if (filter.trim() && !matchesFilter(entry, filter)) return null

  const isActive = entry.path === activePath
  return (
    <button
      type="button"
      className={`dir-tree-row dir-tree-file${isActive ? ' is-active' : ''}`}
      style={{ paddingLeft: 8 + depth * 12 }}
      {...pressProps(() => onSelectFile(entry.path))}
    >
      <span className="dir-tree-chevron" aria-hidden />
      <span className="dir-tree-dot">·</span>
      <span className="dir-tree-name">{entry.name}</span>
    </button>
  )
}

/** DirTree 通用懒加载目录树（listDir 的 path 相对挂载根，空串=根）。 */
export function DirTree({ rootLabel, listDir, activePath, onSelectFile, filter = '', refreshKey }: DirTreeProps) {
  const [open, setOpen] = useState(true)
  const [children, setChildren] = useState<DirEntry[]>([])
  const [loadedKey, setLoadedKey] = useState<string | number | undefined>(undefined)

  const loadRoot = useCallback(async () => {
    const list = await listDir('')
    setChildren(list)
    setLoadedKey(refreshKey)
  }, [listDir, refreshKey])

  useEffect(() => {
    if (!open) return
    if (loadedKey === refreshKey && children.length > 0) return
    void loadRoot()
  }, [open, loadRoot, loadedKey, refreshKey, children.length])

  useEffect(() => {
    setChildren([])
    setLoadedKey(undefined)
  }, [refreshKey])

  const visible = filter.trim() ? children.filter((c) => matchesFilter(c, filter)) : children

  return (
    <div className="dir-tree" role="tree">
      <button
        type="button"
        className={`dir-tree-row dir-tree-dir dir-tree-root${open ? ' is-open' : ''}`}
        style={{ paddingLeft: 8 }}
        {...pressProps(() => setOpen((v) => !v))}
      >
        <span className="dir-tree-chevron">{open ? '▾' : '▸'}</span>
        <IconFolder size={14} />
        <span className="dir-tree-name">{rootLabel}</span>
      </button>
      {open &&
        visible.map((c) => (
          <DirTreeNode
            key={c.path}
            entry={c}
            depth={1}
            listDir={listDir}
            activePath={activePath}
            onSelectFile={onSelectFile}
            filter={filter}
            refreshKey={refreshKey}
          />
        ))}
    </div>
  )
}
