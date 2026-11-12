import type { NoteSummary } from '../../api/types'
import type { ResourceTag } from '../../tags'
import type { HostProject } from '../../api/types'
import {
  NOTEBOOK_ROOT_MEMORY,
  NOTEBOOK_ROOT_WORKFLOW,
  isMemoryProjectDir,
  isSystemNotebookRoot,
} from './businessRoots'
import { skillEntryNoteId } from './noteModel'

export const TAG_OPEN_VERSION_HISTORY = 'open-version-history'
export const TAG_FOCUS_WORKFLOW = 'focus-workflow'
export const TAG_OPEN_MEMORY_NOTE = 'open-memory-note'

const WORKFLOW_ROOT = NOTEBOOK_ROOT_WORKFLOW
const MEMORY_ROOT = NOTEBOOK_ROOT_MEMORY

export type NotebookTagLabels = {
  workflow: string
  memory: string
  versioned: string
  localBound: string
  titleWorkflow: string
  titleMemory: string
  titleVersioned: string
  titleWorkflowFolder: string
  titleLocalBound: string
}

function normRel(rel: string): string {
  return (rel || '').replace(/\\/g, '/').replace(/^\/+|\/+$/g, '')
}

/** isWorkflowSkillDir 工作流/{name}（一级技能目录）。 */
export function isWorkflowSkillDir(dirRel: string): boolean {
  const rel = normRel(dirRel)
  if (!rel.startsWith(`${WORKFLOW_ROOT}/`)) return false
  const rest = rel.slice(WORKFLOW_ROOT.length + 1)
  return Boolean(rest) && !rest.includes('/')
}

/** isUnderMemory 记忆区或其子路径。 */
export function isUnderMemory(rel: string): boolean {
  const id = normRel(rel)
  return id === MEMORY_ROOT || id.startsWith(`${MEMORY_ROOT}/`)
}

/** resolveFolderResourceTags 目录行标签。 */
export function resolveFolderResourceTags(
  folderId: string,
  versioned: boolean,
  labels: NotebookTagLabels,
  project?: HostProject | null,
): ResourceTag[] {
  const id = normRel(folderId)
  if (!id || isSystemNotebookRoot(id)) return []
  const tags: ResourceTag[] = []
  if (isWorkflowSkillDir(id)) {
    tags.push({
      id: 'workflow',
      label: labels.workflow,
      title: labels.titleWorkflowFolder,
      tone: 'neutral',
      action: {
        kind: TAG_FOCUS_WORKFLOW,
        payload: { dirRel: id, noteId: skillEntryNoteId(id) },
      },
    })
  } else if (isUnderMemory(id)) {
    tags.push({
      id: 'memory',
      label: labels.memory,
      title: labels.titleMemory,
      tone: 'accent',
    })
  }
  if (isMemoryProjectDir(id) && project?.localPath) {
    tags.push({
      id: 'local-bound',
      label: labels.localBound,
      title: `${labels.titleLocalBound}: ${project.localPath}`,
      tone: 'success',
    })
  }
  if (versioned) {
    tags.push({
      id: 'versioned',
      label: labels.versioned,
      title: labels.titleVersioned,
      tone: 'success',
      action: {
        kind: TAG_OPEN_VERSION_HISTORY,
        payload: { dirRel: id },
      },
    })
  }
  return tags
}

/** resolveNoteResourceTags 笔记行标签（取代左侧 role badge）。 */
export function resolveNoteResourceTags(note: NoteSummary, labels: NotebookTagLabels): ResourceTag[] {
  const role = note.role || 'note'
  if (role === 'skill') {
    return [
      {
        id: 'workflow',
        label: labels.workflow,
        title: labels.titleWorkflow,
        tone: 'neutral',
        action: {
          kind: TAG_FOCUS_WORKFLOW,
          payload: { noteId: note.id },
        },
      },
    ]
  }
  if (role === 'memory') {
    return [
      {
        id: 'memory',
        label: labels.memory,
        title: labels.titleMemory,
        tone: 'accent',
        action: {
          kind: TAG_OPEN_MEMORY_NOTE,
          payload: { noteId: note.id },
        },
      },
    ]
  }
  return []
}
