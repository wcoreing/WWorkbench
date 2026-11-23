import { useLayoutEffect } from 'react'
import type { ProductId } from './products'

const PARK_ATTR = 'data-ww-compositor-park'

/**
 * useParkHiddenProductCompositor — 切走产品后停泊其 canvas。
 *
 * macOS WKWebView（WebviewIsTransparent）下，父级 [hidden]/display:none
 * 仍可能滞留 xterm/Monaco 的合成层，盖住当前产品（如数据库标签条）。
 * 对隐藏宿主内 canvas 显式 display:none，逼合成器丢弃幽灵层；再显示时还原。
 */
export function useParkHiddenProductCompositor(activeProduct: ProductId) {
  useLayoutEffect(() => {
    document.querySelectorAll('.product-view-host').forEach((host) => {
      if (!(host instanceof HTMLElement)) return
      const hidden = host.hasAttribute('hidden')
      host.querySelectorAll('canvas').forEach((node) => {
        if (!(node instanceof HTMLCanvasElement)) return
        if (hidden) {
          if (node.getAttribute(PARK_ATTR) === '1') return
          node.setAttribute(PARK_ATTR, '1')
          node.style.display = 'none'
          return
        }
        if (node.getAttribute(PARK_ATTR) !== '1') return
        node.removeAttribute(PARK_ATTR)
        node.style.display = ''
      })
    })
  }, [activeProduct])
}
