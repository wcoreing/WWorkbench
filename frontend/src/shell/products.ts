/** 产品线定义 — UI 壳按此注册各产品工作区 */

export type ProductId = 'database' | 'terminal' | 'sftp' | 'docker' | 'environment'

export interface ProductDef {
  id: ProductId
  label: string
  shortLabel: string
  description: string
  available: boolean
}

export const PRODUCTS: ProductDef[] = [
  {
    id: 'database',
    label: '数据库',
    shortLabel: 'DB',
    description: 'MySQL 连接、SQL 查询、表数据编辑',
    available: true,
  },
  {
    id: 'terminal',
    label: '终端',
    shortLabel: 'SSH',
    description: '本机 Shell 与 SSH 交互式终端',
    available: true,
  },
  {
    id: 'sftp',
    label: '文件',
    shortLabel: 'SFTP',
    description: 'SFTP 文件浏览、上传与下载',
    available: true,
  },
  {
    id: 'docker',
    label: '容器',
    shortLabel: 'Docker',
    description: 'Docker 容器、镜像与 Compose 管理',
    available: true,
  },
  {
    id: 'environment',
    label: '环境',
    shortLabel: 'Env',
    description: 'Node / Go / PHP / Java 本机版本切换与预设',
    available: false,
  },
]

/** 按 id 查找产品线 */
export function getProduct(id: ProductId): ProductDef {
  return PRODUCTS.find((p) => p.id === id) ?? PRODUCTS[0]
}
