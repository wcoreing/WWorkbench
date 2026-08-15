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
