/** AppLocale 应用界面语言。 */
export type AppLocale = 'zh' | 'en'

export type MessageTree = {
  [key: string]: string | MessageTree
}
