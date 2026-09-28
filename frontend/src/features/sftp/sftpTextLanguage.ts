const TEXT_EXTS = new Set([
  'txt', 'md', 'markdown', 'json', 'js', 'mjs', 'cjs', 'ts', 'tsx', 'jsx',
  'css', 'scss', 'less', 'html', 'htm', 'xml', 'yml', 'yaml', 'toml',
  'ini', 'conf', 'cfg', 'env', 'sh', 'bash', 'zsh', 'fish', 'py', 'go', 'rs',
  'java', 'c', 'h', 'cpp', 'hpp', 'cc', 'sql', 'log', 'vue', 'svelte', 'php',
  'rb', 'pl', 'lua', 'r', 'swift', 'kt', 'scala', 'cs', 'gitignore', 'dockerignore',
  'editorconfig', 'properties', 'csv', 'tsv', 'nginx', 'dockerfile', 'makefile',
  'tf', 'hcl', 'proto', 'graphql', 'gql', 'lock', 'npmrc', 'prettierrc', 'eslintrc',
])

const IMAGE_EXTS = new Set([
  'png', 'jpg', 'jpeg', 'gif', 'webp', 'bmp', 'ico', 'svg', 'avif',
])

const TEXT_NAMES = new Set([
  'dockerfile', 'makefile', 'readme', 'license', 'licence', 'changelog',
  'authors', 'gemfile', 'rakefile', 'procfile', 'cmakelists.txt',
  '.bashrc', '.zshrc', '.profile', '.gitignore', '.dockerignore', '.env',
  '.editorconfig', '.npmrc',
])

/** isProbablyTextFile 判断是否优先走在线编辑（否则下载）。 */
export function isProbablyTextFile(name: string): boolean {
  const n = name.trim().toLowerCase()
  if (!n) return false
  if (TEXT_NAMES.has(n)) return true
  const dot = n.lastIndexOf('.')
  if (dot < 0) return true
  const ext = n.slice(dot + 1)
  if (IMAGE_EXTS.has(ext)) return false
  return TEXT_EXTS.has(ext)
}

/** isProbablyImageFile 判断是否走图片预览。 */
export function isProbablyImageFile(name: string): boolean {
  const n = name.trim().toLowerCase()
  const dot = n.lastIndexOf('.')
  if (dot < 0) return false
  return IMAGE_EXTS.has(n.slice(dot + 1))
}

/** imageMimeFromName 根据扩展名猜测图片 MIME。 */
export function imageMimeFromName(name: string): string {
  const n = name.trim().toLowerCase()
  const dot = n.lastIndexOf('.')
  const ext = dot >= 0 ? n.slice(dot + 1) : ''
  switch (ext) {
    case 'png':
      return 'image/png'
    case 'jpg':
    case 'jpeg':
      return 'image/jpeg'
    case 'gif':
      return 'image/gif'
    case 'webp':
      return 'image/webp'
    case 'bmp':
      return 'image/bmp'
    case 'ico':
      return 'image/x-icon'
    case 'svg':
      return 'image/svg+xml'
    case 'avif':
      return 'image/avif'
    default:
      return 'application/octet-stream'
  }
}

/** guessMonacoLanguage 根据文件名猜测 Monaco language id。 */
export function guessMonacoLanguage(name: string): string {
  const n = name.trim().toLowerCase()
  const base = n.includes('/') ? n.slice(n.lastIndexOf('/') + 1) : n
  if (base === 'dockerfile' || base.endsWith('.dockerfile')) return 'dockerfile'
  if (base === 'makefile' || base.startsWith('makefile')) return 'makefile'
  const dot = base.lastIndexOf('.')
  const ext = dot >= 0 ? base.slice(dot + 1) : ''
  switch (ext) {
    case 'ts':
    case 'tsx':
      return 'typescript'
    case 'js':
    case 'jsx':
    case 'mjs':
    case 'cjs':
      return 'javascript'
    case 'py':
      return 'python'
    case 'go':
      return 'go'
    case 'rs':
      return 'rust'
    case 'java':
      return 'java'
    case 'json':
      return 'json'
    case 'yml':
    case 'yaml':
      return 'yaml'
    case 'md':
    case 'markdown':
      return 'markdown'
    case 'html':
    case 'htm':
      return 'html'
    case 'css':
    case 'scss':
    case 'less':
      return 'css'
    case 'xml':
    case 'svg':
      return 'xml'
    case 'sql':
      return 'sql'
    case 'sh':
    case 'bash':
    case 'zsh':
      return 'shell'
    case 'php':
      return 'php'
    case 'rb':
      return 'ruby'
    case 'c':
    case 'h':
      return 'c'
    case 'cpp':
    case 'hpp':
    case 'cc':
      return 'cpp'
    case 'toml':
      return 'ini'
    case 'ini':
    case 'conf':
    case 'cfg':
    case 'env':
    case 'properties':
      return 'ini'
    default:
      return 'plaintext'
  }
}
