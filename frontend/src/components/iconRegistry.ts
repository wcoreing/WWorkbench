/** 图标资源注册表：唯一清单，新增图标只改这里 + assets/icons/*.png */

import agent from '../assets/icons/agent.png'
import checkconstraint from '../assets/icons/checkconstraint.png'
import column from '../assets/icons/column.png'
import compare from '../assets/icons/compare.png'
import connect from '../assets/icons/connect.png'
import copy from '../assets/icons/copy.png'
import database from '../assets/icons/database.png'
import dbsystem from '../assets/icons/dbsystem.png'
import disconnect from '../assets/icons/disconnect.png'
import docker from '../assets/icons/docker.png'
import download from '../assets/icons/download.png'
import edit from '../assets/icons/edit.png'
import environment from '../assets/icons/environment.png'
import explain from '../assets/icons/explain.png'
import fontsize from '../assets/icons/fontsize.png'
import foreignkey from '../assets/icons/foreignkey.png'
import forward from '../assets/icons/forward.png'
import functionIcon from '../assets/icons/function.png'
import globe from '../assets/icons/globe.png'
import httpapi from '../assets/icons/httpapi.png'
import importsql from '../assets/icons/importsql.png'
import index from '../assets/icons/index.png'
import laptop from '../assets/icons/laptop.png'
import logs from '../assets/icons/logs.png'
import moon from '../assets/icons/moon.png'
import notebook from '../assets/icons/notebook.png'
import play from '../assets/icons/play.png'
import plus from '../assets/icons/plus.png'
import port from '../assets/icons/port.png'
import primarykey from '../assets/icons/primarykey.png'
import procedure from '../assets/icons/procedure.png'
import refresh from '../assets/icons/refresh.png'
import save from '../assets/icons/save.png'
import schema from '../assets/icons/schema.png'
import search from '../assets/icons/search.png'
import server from '../assets/icons/server.png'
import settings from '../assets/icons/settings.png'
import sftp from '../assets/icons/sftp.png'
import sql from '../assets/icons/sql.png'
import ssh from '../assets/icons/ssh.png'
import stop from '../assets/icons/stop.png'
import sun from '../assets/icons/sun.png'
import table from '../assets/icons/table.png'
import terminal from '../assets/icons/terminal.png'
import trash from '../assets/icons/trash.png'
import trigger from '../assets/icons/trigger.png'
import upload from '../assets/icons/upload.png'
import view from '../assets/icons/view.png'

/** 正式资源目录：frontend/src/assets/icons */
export const ICON_SRC = {
  agent,
  checkconstraint,
  column,
  compare,
  connect,
  copy,
  database,
  dbsystem,
  disconnect,
  docker,
  download,
  edit,
  environment,
  explain,
  fontsize,
  foreignkey,
  forward,
  function: functionIcon,
  globe,
  httpapi,
  importsql,
  index,
  laptop,
  logs,
  moon,
  notebook,
  play,
  plus,
  port,
  primarykey,
  procedure,
  refresh,
  save,
  schema,
  search,
  server,
  settings,
  sftp,
  sql,
  ssh,
  stop,
  sun,
  table,
  terminal,
  trash,
  trigger,
  upload,
  view,
  // 语义别名（业务名 → 资源名）
  folder: sftp,
  layers: environment,
  http: httpapi,
} as const

export type IconName = keyof typeof ICON_SRC

export const ICON_NAMES = Object.keys(ICON_SRC) as IconName[]
