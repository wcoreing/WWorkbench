/** iframe / frame 上下文。 */
export function listFrames() {
  const frames = [
    {
      id: '#f0',
      url: location.href,
      title: document.title,
      sameOrigin: true,
      root: true,
    },
  ]
  document.querySelectorAll('iframe').forEach((iframe, idx) => {
    const id = `#f${idx + 1}`
    iframe.setAttribute('data-ww-frame', id)
    let sameOrigin = false
    let url = iframe.getAttribute('src') || ''
    let title = iframe.getAttribute('title') || iframe.name || ''
    try {
      const doc = iframe.contentDocument
      if (doc) {
        sameOrigin = true
        url = doc.location?.href || url
        title = doc.title || title
      }
    } catch {
      sameOrigin = false
    }
    frames.push({ id, url, title, sameOrigin, name: iframe.name || '' })
  })
  return frames
}

export function resolveContext(args) {
  const frame = String(args?.frame || '#f0').trim() || '#f0'
  if (frame === '#f0' || frame === 'root' || frame === '') {
    return { doc: document, win: window, frameEl: null, frame: '#f0' }
  }
  listFrames()
  const iframe = document.querySelector(`iframe[data-ww-frame="${frame.replace(/"/g, '\\"')}"]`)
  if (!iframe) {
    throw new Error('未找到 frame ' + frame + '（先 snapshot 查看 frames）')
  }
  let doc
  try {
    doc = iframe.contentDocument
  } catch {
    doc = null
  }
  if (!doc) {
    const src = iframe.getAttribute('src') || ''
    throw new Error(
      '跨域 iframe 无法直接操作' +
        (src ? '：请新开标签打开 ' + src + ' 再附着' : '（无 src）'),
    )
  }
  return { doc, win: doc.defaultView || window, frameEl: iframe, frame }
}

/** 穿透 open Shadow DOM 的 querySelectorAll。 */
