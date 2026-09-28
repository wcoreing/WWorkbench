/** 应用图标统一入口：全部走 iconRegistry + assets/icons PNG */

import type { ImgHTMLAttributes } from 'react'
import { ICON_SRC, type IconName } from './iconRegistry'
import './icons.css'

export type { IconName } from './iconRegistry'
export type IconProps = { size?: number; className?: string }

type NamedIconProps = IconProps & { name: IconName }

/** 通用图标：按注册表名称取图 */
export function Icon({ name, size = 16, className }: NamedIconProps) {
  const imgProps: ImgHTMLAttributes<HTMLImageElement> = {
    src: ICON_SRC[name],
    width: size,
    height: size,
    alt: '',
    draggable: false,
    className: ['wn-raster-icon', className].filter(Boolean).join(' '),
    style: { width: size, height: size },
  }
  return <img {...imgProps} />
}

function named(name: IconName) {
  return function NamedIcon({ size = 16, className }: IconProps) {
    return <Icon name={name} size={size} className={className} />
  }
}

export const IconPlus = named('plus')
export const IconEdit = named('edit')
export const IconRefresh = named('refresh')
export const IconPlay = named('play')
export const IconStop = named('stop')
export const IconSql = named('sql')
export const IconDisconnect = named('disconnect')
export const IconMoon = named('moon')
export const IconSun = named('sun')
export const IconFontSize = named('fontsize')
export const IconGlobe = named('globe')
export const IconDatabase = named('database')
export const IconDbSystem = named('dbsystem')
export const IconTerminal = named('terminal')
export const IconSSH = named('ssh')
export const IconFolder = named('folder')
export const IconLayers = named('layers')
export const IconServer = named('server')
export const IconDocker = named('docker')
export const IconLaptop = named('laptop')
export const IconLogs = named('logs')
export const IconHttp = named('http')
export const IconNotebook = named('notebook')
export const IconSearch = named('search')
export const IconCopy = named('copy')
export const IconUpload = named('upload')
export const IconDownload = named('download')
export const IconTrash = named('trash')
export const IconSave = named('save')
export const IconSettings = named('settings')
export const IconAgent = named('agent')
export const IconTable = named('table')
export const IconView = named('view')
export const IconColumn = named('column')
export const IconIndex = named('index')
export const IconPrimaryKey = named('primarykey')
export const IconForeignKey = named('foreignkey')
export const IconTrigger = named('trigger')
export const IconCheckConstraint = named('checkconstraint')
export const IconProcedure = named('procedure')
export const IconSchema = named('schema')
export const IconExplain = named('explain')
export const IconImportSql = named('importsql')
export const IconFunction = named('function')
export const IconCompare = named('compare')
export const IconConnect = named('connect')
export const IconForward = named('forward')
export const IconPort = named('port')

type SvgIconProps = IconProps & { title?: string }

/** Element Plus ArrowDown 路径（下拉触发器用）。 */
const EP_ARROW_DOWN =
  'M831.872 340.864 512 652.672 192.128 340.864a30.592 30.592 0 0 0-42.752 0 29.12 29.12 0 0 0 0 41.6L489.664 714.24a32 32 0 0 0 44.672 0l340.288-331.712a29.12 29.12 0 0 0 0-41.728 30.592 30.592 0 0 0-42.752 0z'

/** Element Plus ArrowRight 路径（树展开用）。 */
const EP_ARROW_RIGHT =
  'M340.864 149.312a30.592 30.592 0 0 0 0 42.752L652.736 512 340.864 831.872a30.592 30.592 0 0 0 0 42.752 29.12 29.12 0 0 0 41.472 0L714.24 534.336a32 32 0 0 0 0-44.672L382.336 149.376a29.12 29.12 0 0 0-41.472 0z'

function EpSvgIcon({
  path,
  size = 12,
  className,
  title,
}: SvgIconProps & { path: string }) {
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      viewBox="0 0 1024 1024"
      width={size}
      height={size}
      className={['wn-ep-icon', className].filter(Boolean).join(' ')}
      aria-hidden={title ? undefined : true}
      focusable="false"
      style={{ width: size, height: size }}
    >
      {title ? <title>{title}</title> : null}
      <path fill="currentColor" d={path} />
    </svg>
  )
}

/** IconArrowDown Element Plus 风格下拉箭头。 */
export function IconArrowDown({ size = 12, className }: IconProps) {
  return <EpSvgIcon path={EP_ARROW_DOWN} size={size} className={className} />
}

/** IconArrowRight Element Plus 风格向右箭头（树节点可旋转为展开）。 */
export function IconArrowRight({ size = 12, className }: IconProps) {
  return <EpSvgIcon path={EP_ARROW_RIGHT} size={size} className={className} />
}
