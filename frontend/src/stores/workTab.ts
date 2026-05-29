/** WorkTab 数据库工作区标签页。 */
export type WorkTab =
  | { id: string; kind: 'sql'; title: string; sql: string }
  | { id: string; kind: 'table'; title: string; database: string; table: string }
  | { id: string; kind: 'ddl'; title: string; content: string; database?: string; editable?: boolean }
  | { id: string; kind: 'design'; title: string; database: string; mode: 'create' | 'alter'; table?: string }
