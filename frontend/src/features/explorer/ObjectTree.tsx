import type { ObjectTreeNode } from '../../api/types'
import '../../components/ui.css'

interface Props {
  nodes: ObjectTreeNode[]
  onTableDoubleClick: (database: string, table: string) => void
  onShowDDL: (database: string, table: string) => void
}

export function ObjectTree({ nodes, onTableDoubleClick, onShowDDL }: Props) {
  const renderNode = (node: ObjectTreeNode, depth = 0) => (
    <li key={node.id}>
      <div
        className={`wn-tree-item ${node.nodeType}`}
        style={{ paddingLeft: 6 + depth * 16 }}
        onDoubleClick={() => {
          if (node.nodeType === 'table' && node.database && node.table) {
            onTableDoubleClick(node.database, node.table)
          }
        }}
        onContextMenu={(e) => {
          if (node.nodeType === 'table' && node.database && node.table) {
            e.preventDefault()
            onShowDDL(node.database, node.table)
          }
        }}
        title={node.nodeType === 'table' ? '双击打开表 · 右键查看 DDL' : node.label}
      >
        <span className="tree-icon">{treeIcon(node.nodeType)}</span>
        <span className="tree-label">{node.label}</span>
      </div>
      {node.children && node.children.length > 0 && (
        <ul className="wn-tree">{node.children.map((c) => renderNode(c, depth + 1))}</ul>
      )}
    </li>
  )

  if (!nodes.length) {
    return <div className="empty-hint">连接后显示数据库对象</div>
  }

  return <ul className="wn-tree">{nodes.map((n) => renderNode(n))}</ul>
}

function treeIcon(type: string) {
  if (type === 'database') return '◆'
  if (type === 'table') return '▤'
  return '○'
}
