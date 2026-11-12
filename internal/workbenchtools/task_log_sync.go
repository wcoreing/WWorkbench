package workbenchtools

import (
	"strings"

	"WWorkbench/internal/errno"
	"WWorkbench/internal/model"
	"WWorkbench/internal/notebook"
)

// ResolveTaskSkillName 当前任务应对齐的工作流目录名：已关联工作流优先，否则用标题。
func ResolveTaskSkillName(d *Deps, run model.TaskRunDO) string {
	if d != nil && d.Notebook != nil {
		if list, err := d.Notebook.ListWorkflowNotes(80); err == nil {
			for _, w := range list {
				if strings.TrimSpace(w.SourceRunID) == run.ID && strings.TrimSpace(w.Name) != "" {
					return notebook.SanitizeSkillDirName(w.Name)
				}
			}
		}
	}
	if name := notebook.SanitizeSkillDirName(run.Title); name != "" {
		return name
	}
	return notebook.SanitizeSkillDirName(slugifyWorkflowName(run.Title, run.Session, "run"))
}

// SyncTaskRunLogNote 将任务步骤同步为 工作流/{name}/log.md 文本笔记。
func SyncTaskRunLogNote(d *Deps, runID string) (noteID, scopeRoot, skillName string, err error) {
	if d == nil || d.Store == nil || d.Notebook == nil {
		return "", "", "", errno.New(errno.CodeStoreFailed, "笔记本或存储未就绪", "")
	}
	detail, err := d.Store.GetTaskRunDetail(strings.TrimSpace(runID))
	if err != nil {
		return "", "", "", err
	}
	skillName = ResolveTaskSkillName(d, detail.Run)
	noteID, scopeRoot, err = d.Notebook.SyncTaskRunLog(skillName, detail.Run, detail.Steps)
	return noteID, scopeRoot, skillName, err
}
