/** 顶栏专用描边图标：随 currentColor 变色，与 chrome 控件视觉一致。 */

import type { ReactNode, SVGAttributes } from 'react'
import './icons.css'

export type ShellChromeIconProps = {
  size?: number
  className?: string
}

type UiIconProps = ShellChromeIconProps & {
  children: ReactNode
  viewBox?: string
}

function UiIcon({ size = 16, className, children, viewBox = '0 0 16 16' }: UiIconProps) {
  const svgProps: SVGAttributes<SVGSVGElement> = {
    width: size,
    height: size,
    viewBox,
    className: ['wn-ui-icon', className].filter(Boolean).join(' '),
    fill: 'none',
    stroke: 'currentColor',
    strokeWidth: 1.5,
    strokeLinecap: 'round',
    strokeLinejoin: 'round',
    'aria-hidden': true,
  }
  return <svg {...svgProps}>{children}</svg>
}

/** 界面字号 */
export function IconUiFontSize({ size, className }: ShellChromeIconProps) {
  return (
    <UiIcon size={size} className={className}>
      <path d="M4 11.5V4.5h3.25a2.25 2.25 0 0 1 0 4.5H6v2.5" />
      <path d="M11 11.5h3.5" />
      <path d="M12.75 8v3.5" />
    </UiIcon>
  )
}

/** 语言 / 区域 */
export function IconUiGlobe({ size, className }: ShellChromeIconProps) {
  return (
    <UiIcon size={size} className={className}>
      <circle cx="8" cy="8" r="5.5" />
      <path d="M2.5 8h11" />
      <path d="M8 2.5c1.8 1.6 1.8 9.4 0 11" />
      <path d="M8 2.5c-1.8 1.6-1.8 9.4 0 11" />
    </UiIcon>
  )
}

/** 浅色主题（当前为暗色时显示） */
export function IconUiSun({ size, className }: ShellChromeIconProps) {
  return (
    <UiIcon size={size} className={className}>
      <circle cx="8" cy="8" r="2.5" />
      <path d="M8 2.25v1.5M8 12.25v1.5M2.25 8h1.5M12.25 8h1.5" />
      <path d="M4.1 4.1l1.05 1.05M10.85 10.85l1.05 1.05M4.1 11.9l1.05-1.05M10.85 5.15l1.05-1.05" />
    </UiIcon>
  )
}

/** 深色主题（当前为浅色时显示） */
export function IconUiMoon({ size, className }: ShellChromeIconProps) {
  return (
    <UiIcon size={size} className={className}>
      <path d="M11.6 3.4a5.5 5.5 0 1 0 1 9.1A6 6 0 0 1 11.6 3.4z" />
    </UiIcon>
  )
}

/** Agent 面板开关 */
export function IconUiAgent({ size, className }: ShellChromeIconProps) {
  return (
    <UiIcon size={size} className={className}>
      <path d="M8 2.5l.7 2.1 2.2.6-1.7 1.4.5 2.2L8 7.6 6.3 8.8l.5-2.2-1.7-1.4 2.2-.6L8 2.5z" />
      <path d="M13.2 10.2l.45 1.35 1.35.45-1.35.45-.45 1.35-.45-1.35-1.35-.45 1.35-.45.45-1.35z" />
    </UiIcon>
  )
}
