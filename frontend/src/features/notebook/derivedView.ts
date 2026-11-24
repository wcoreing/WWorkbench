/** DerivedView 页头注释里的来源、技能和源提交。应用只读这三项。 */
export type DerivedView = {
  source: string
  skill: string
  sourceRev: string
}

/** FileStamp 该源文件在目录仓中的当前提交。 */
export type FileStamp = {
  enabled: boolean
  short: string
  dirty: boolean
}

const VIEW_COMMENT = /<!--\s*wwb-view\b([^>]*)-->/i
const ATTR = /([A-Za-z]+)\s*=\s*"([^"]*)"/g

/** parseDerivedView 读取 HTML 页头的 wwb-view 注释。没有注释时三项皆空。 */
export function parseDerivedView(html: string): DerivedView {
  const head = (html || '').slice(0, 2000)
  const block = VIEW_COMMENT.exec(head)
  const view: DerivedView = { source: '', skill: '', sourceRev: '' }
  if (!block) return view
  const body = block[1] || ''
  for (const match of body.matchAll(ATTR)) {
    const key = match[1]
    const value = (match[2] || '').trim()
    if (key === 'source') view.source = value
    else if (key === 'skill') view.skill = value
    else if (key === 'sourceRev') view.sourceRev = value
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
