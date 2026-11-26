/** DerivedView 页头注释里的来源、技能、源提交，以及页面运行时。 */
export type DerivedView = {
  source: string
  skill: string
  sourceRev: string
  runtime: string
}

/** FileStamp 该源文件在目录仓中的当前提交。 */
export type FileStamp = {
  enabled: boolean
  short: string
  dirty: boolean
}

const VIEW_COMMENT = /<!--\s*wwb-view\b([^>]*)-->/i
const ATTR = /([A-Za-z]+)\s*=\s*"([^"]*)"/g

/** parseDerivedView 读取 HTML 页头的 wwb-view 注释。没有注释时皆空。 */
export function parseDerivedView(html: string): DerivedView {
  const head = (html || '').slice(0, 2000)
  const block = VIEW_COMMENT.exec(head)
  const view: DerivedView = { source: '', skill: '', sourceRev: '', runtime: '' }
  if (!block) return view
  const body = block[1] || ''
  for (const match of body.matchAll(ATTR)) {
    const key = match[1]
    const value = (match[2] || '').trim()
    if (key === 'source') view.source = value
    else if (key === 'skill') view.skill = value
    else if (key === 'sourceRev') view.sourceRev = value
    else if (key === 'runtime') view.runtime = value
  }
  return view
}

/** sourceNoteIdFromPage 同名目录里的 HTML → 源笔记。路径对不上时为空。 */
export function sourceNoteIdFromPage(noteId: string): string {
  const id = (noteId || '').replace(/\\/g, '/')
  const matched = id.match(/^(.*)\/([^/]+)\/html\/([^/]+)\.html?$/i)
  if (!matched || matched[2] !== matched[3]) return ''
  const parent = matched[1]
  return `${parent ? `${parent}/` : ''}${matched[3]}.md`
}

/** linkedSourceNoteId 页面要打开的源笔记。目录关系优先，页头注释其次。 */
export function linkedSourceNoteId(noteId: string, html: string): string {
  return sourceNoteIdFromPage(noteId) || parseDerivedView(html).source
}

const SOURCE_LINK_MARK = 'data-wwb-open-source'

/** rewriteDerivedAssetRefs 把页面里的 ../assets/文件 改成附件地址。srcdoc 没有笔记目录。 */
export function rewriteDerivedAssetRefs(html: string, pageNoteId: string): string {
  const source = sourceNoteIdFromPage(pageNoteId)
  const slash = (pageNoteId || '').lastIndexOf('/')
  if (!source || slash < 0 || !html) return html
  const fromDir = pageNoteId.slice(0, slash)
  const assetsRoot = `${source.replace(/\.md$/i, '')}/assets/`
  const prefix = `/notebook-assets/${source.split('/').map(encodeURIComponent).join('/')}/`
  return html.replace(
    /(^|[^:\w-])(:?)(src|href)(\s*=\s*)("([^"]*)"|'([^']*)')/gi,
    (full, lead: string, colon: string, attr: string, eq: string, quoted: string, dbl?: string, sgl?: string) => {
      const raw = dbl != null ? dbl : sgl
      if (raw == null) return full
      const resolved = resolveNotebookRel(fromDir, raw)
      if (!resolved || !resolved.startsWith(assetsRoot)) return full
      const file = resolved.slice(assetsRoot.length)
      if (!file || file.includes('/') || file === '.' || file === '..') return full
      const quote = quoted.startsWith("'") ? "'" : '"'
      return `${lead}${colon}${attr}${eq}${quote}${prefix}${encodeURIComponent(file)}${quote}`
    },
  )
}

function resolveNotebookRel(fromDir: string, raw: string): string | null {
  const value = (raw || '').trim()
  if (!value || /^(?:[a-z][a-z0-9+.-]*:|\/\/|#|\/)/i.test(value)) return null
  const pathOnly = value.split(/[?#]/)[0]
  const stack = fromDir.split('/').filter(Boolean)
  for (const seg of pathOnly.split('/')) {
    if (seg === '' || seg === '.') continue
    if (seg === '..') {
      if (stack.length === 0) return null
      stack.pop()
      continue
    }
    if (seg.includes('\\')) return null
    stack.push(seg)
  }
  return stack.join('/')
}

/** withDerivedSourceLink 让页面里的源路径点回笔记。脚本只能通知这一个路径。 */
export function withDerivedSourceLink(html: string, sourceId: string): string {
  const source = (sourceId || '').trim()
  if (!source || !html || html.includes(SOURCE_LINK_MARK)) return html
  const literal = JSON.stringify(source).replace(/</g, '\\u003c')
  const script = `<script ${SOURCE_LINK_MARK}>${sourceLinkScript(literal)}</script>`
  if (/<\/body>/i.test(html)) return html.replace(/<\/body>/i, `${script}</body>`)
  return html + script
}

function sourceLinkScript(literal: string): string {
  return `(function(){var id=${literal};function bind(root){if(!root)return;var walker=document.createTreeWalker(root,NodeFilter.SHOW_TEXT);var nodes=[];while(walker.nextNode())nodes.push(walker.currentNode);nodes.forEach(function(node){var text=node.nodeValue||"";var at=text.indexOf(id);if(at<0)return;var parent=node.parentNode;if(!parent||(parent.closest&&parent.closest("script,style,[data-wwb-open]")))return;var a=document.createElement("a");a.href="#";a.setAttribute("data-wwb-open",id);a.textContent=id;var frag=document.createDocumentFragment();if(at>0)frag.appendChild(document.createTextNode(text.slice(0,at)));frag.appendChild(a);if(at+id.length<text.length)frag.appendChild(document.createTextNode(text.slice(at+id.length)));parent.replaceChild(frag,node);});}document.addEventListener("click",function(e){var el=e.target&&e.target.closest?e.target.closest("[data-wwb-open]"):null;if(!el)return;e.preventDefault();parent.postMessage({type:"wwb-open-note",id:el.getAttribute("data-wwb-open")},"*");},true);if(document.body)bind(document.body);else document.addEventListener("DOMContentLoaded",function(){bind(document.body);});})();`
}

/** siblingHtmlNoteId 源笔记 → 同名目录里的 HTML 页面。不是 Markdown 时为空。 */
export function siblingHtmlNoteId(noteId: string): string {
  const id = (noteId || '').replace(/\\/g, '/')
  if (!/\.md$/i.test(id)) return ''
  const slash = id.lastIndexOf('/')
  const dir = slash >= 0 ? id.slice(0, slash + 1) : ''
  const stem = (slash >= 0 ? id.slice(slash + 1) : id).replace(/\.md$/i, '')
  return `${dir}${stem}/html/${stem}.html`
}

/** derivedSourceStale 页头 sourceRev 与该文件当前提交不一致，或工作区改过这个文件。 */
export function derivedSourceStale(sourceRev: string, stamp: FileStamp | null): boolean {
  const want = sourceRev.trim().toLowerCase()
  if (!want || !stamp?.enabled) return false
  if (stamp.dirty) return true
  const got = stamp.short.trim().toLowerCase()
  if (!got) return true
  return !got.startsWith(want) && !want.startsWith(got)
}
