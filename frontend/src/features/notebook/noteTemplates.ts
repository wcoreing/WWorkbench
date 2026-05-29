import type { Connection, SSHHost } from '../../api/types'

/** buildSSHHostTemplate 生成 SSH 主机信息模板。 */
export function buildSSHHostTemplate(host: SSHHost): string {
  return `# ${host.name}

| 项 | 值 |
|---|---|
| 主机 | ${host.host} |
| 端口 | ${host.port} |
| 用户 | ${host.user} |

\`\`\`shell
ssh ${host.user}@${host.host} -p ${host.port}
\`\`\`
`
}

/** buildConnectionTemplate 生成数据库连接信息模板。 */
export function buildConnectionTemplate(conn: Connection): string {
  const ssh = conn.sshEnabled ? `是（${conn.sshHost || conn.sshHostId || '跳板'}）` : '否'
  return `# ${conn.name}

| 项 | 值 |
|---|---|
| 类型 | ${conn.dbType} |
| 主机 | ${conn.host} |
| 端口 | ${conn.port} |
| 用户 | ${conn.user} |
| 数据库 | ${conn.database || '-'} |
| SSH 隧道 | ${ssh} |

\`\`\`sql
-- ${conn.host}:${conn.port}/${conn.database || ''}
SELECT 1;
\`\`\`
`
}

/** buildServerChecklistTemplate 生成服务器巡检清单模板。 */
export function buildServerChecklistTemplate(title: string): string {
  return `# ${title}

## 基本信息
- 环境：
- 负责人：

## 常用命令
\`\`\`shell
# 磁盘
df -h

# 内存
free -m

# 进程
ps aux | head

# 日志
journalctl -n 50 --no-pager
\`\`\`

## 备注

`
}

/** extractFromCodeBlocks 提取 fenced 代码块内容。 */
function extractFromCodeBlocks(text: string, langs: string[]): string {
  const re = /```([\w-]*)\s*\n([\s\S]*?)```/g
  const blocks: string[] = []
  let m: RegExpExecArray | null
  while ((m = re.exec(text)) !== null) {
    const lang = (m[1] || '').toLowerCase()
    if (langs.length === 0 || langs.includes(lang) || lang === '') {
      const body = m[2].trim()
      if (body) blocks.push(body)
    }
  }
  return blocks.join('\n\n')
}

/** normalizeCommandLines 过滤空行与 shell 注释。 */
function normalizeCommandLines(text: string): string[] {
  return text
    .split('\n')
    .map((l) => l.trim())
    .filter((l) => l && !l.startsWith('#'))
}

/** extractRunCommands 从笔记提取终端可执行命令（优先代码块）。 */
export function extractRunCommands(text: string): string {
  const fromBlocks = extractFromCodeBlocks(text, ['shell', 'bash', 'sh', 'zsh', ''])
  const source = fromBlocks || text
  const lines = normalizeCommandLines(source)
  if (!lines.length) return ''
  return lines.map((l) => (l.endsWith('\r') ? l : `${l}\r`)).join('')
}

/** extractSqlText 从笔记提取 SQL（优先 sql 代码块，支持纯文本单行 SQL）。 */
export function extractSqlText(text: string): string {
  const fromBlocks = extractFromCodeBlocks(text, ['sql', 'mysql', ''])
  if (fromBlocks) return fromBlocks.trim()
  const trimmed = text.trim()
  if (
    /^(SELECT|INSERT|UPDATE|DELETE|SHOW|USE|CREATE|ALTER|DROP|DESC|DESCRIBE|EXPLAIN|SET|GRANT|TRUNCATE|WITH)\b/is.test(
      trimmed
    )
  ) {
    return trimmed
  }
  const lines = text.split('\n').filter((l) => {
    const t = l.trim()
    if (!t || t.startsWith('#')) return false
    if (t.startsWith('--')) return true
    return /^(SELECT|INSERT|UPDATE|DELETE|SHOW|USE|CREATE|ALTER|DROP|DESC|DESCRIBE|EXPLAIN|SET|GRANT|TRUNCATE|WITH)\b/i.test(t)
  })
  return lines.join('\n').trim()
}
