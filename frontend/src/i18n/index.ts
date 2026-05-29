import { useCallback } from 'react'
import type { ProductId } from '../shell/products'
import { PRODUCTS } from '../shell/products'
import { useAppStore } from '../stores/appStore'
import { en } from './locales/en'
import { zh } from './locales/zh'
import type { AppLocale, MessageTree } from './types'

export type { AppLocale } from './types'

const catalogs: Record<AppLocale, MessageTree> = { zh, en }

/** READY_MESSAGES 就绪状态文案（切换语言时同步状态栏）。 */
export const READY_MESSAGES = new Set(['就绪', 'Ready'])

/** lookupMessage 按点路径读取文案。 */
function lookupMessage(tree: MessageTree, key: string): string | undefined {
  let cur: string | MessageTree | undefined = tree
  for (const part of key.split('.')) {
    if (!cur || typeof cur !== 'object') return undefined
    cur = cur[part]
  }
  return typeof cur === 'string' ? cur : undefined
}

/** interpolate 替换 {name} 占位符。 */
function interpolate(template: string, params?: Record<string, string | number>) {
  if (!params) return template
  return template.replace(/\{(\w+)\}/g, (_, name: string) => String(params[name] ?? `{${name}}`))
}

/** translate 翻译指定 key。 */
export function translate(locale: AppLocale, key: string, params?: Record<string, string | number>) {
  const msg =
    lookupMessage(catalogs[locale], key) ??
    lookupMessage(catalogs.zh, key) ??
    key
  return interpolate(msg, params)
}

/** applyDocumentLocale 设置 html lang。 */
export function applyDocumentLocale(locale: AppLocale) {
  document.documentElement.lang = locale === 'zh' ? 'zh-CN' : 'en'
}

/** useI18n 组件内翻译 hook。 */
export function useI18n() {
  const locale = useAppStore((s) => s.locale)
  const t = useCallback(
    (key: string, params?: Record<string, string | number>) => translate(locale, key, params),
    [locale]
  )
  return { locale, t }
}

export interface LocalizedProduct {
  id: ProductId
  label: string
  shortLabel: string
  description: string
  available: boolean
}

/** useLocalizedProduct 获取当前语言下的产品线信息。 */
export function useLocalizedProduct(id: ProductId): LocalizedProduct {
  const { t } = useI18n()
  const meta = PRODUCTS.find((p) => p.id === id) ?? PRODUCTS[0]
  return {
    id: meta.id,
    available: meta.available,
    label: t(`products.${meta.id}.label`),
    shortLabel: t(`products.${meta.id}.shortLabel`),
    description: t(`products.${meta.id}.description`),
  }
}

/** useLocalizedProducts 获取全部产品线文案。 */
export function useLocalizedProducts(): LocalizedProduct[] {
  const { t } = useI18n()
  return PRODUCTS.map((p) => ({
    id: p.id,
    available: p.available,
    label: t(`products.${p.id}.label`),
    shortLabel: t(`products.${p.id}.shortLabel`),
    description: t(`products.${p.id}.description`),
  }))
}
