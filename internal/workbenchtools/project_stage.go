package workbenchtools

import (
	"context"
	"encoding/json"
	"os"
	"path/filepath"
	"strings"

	"WWorkbench/internal/cursorrule"
	"WWorkbench/internal/errno"
	"WWorkbench/internal/model"
	"WWorkbench/internal/store"
	"WWorkbench/internal/workbench"
)

const maxStageSSHHosts = 3

// OpenProjectStageOpts 打开可控舞台参数。
type OpenProjectStageOpts struct {
	ID        string
	LocalPath string
	Intent    string
	Source    string // ui | mcp | cursor
	NotifyUI  bool   // MCP 路径为 true，由前端开 SSH / 钉 Agent
}

// NormalizeLocalPath 绝对化并 Clean 本机路径。
func NormalizeLocalPath(localPath string) (string, error) {
	raw := strings.TrimSpace(localPath)
	if raw == "" {
		return "", errno.New(errno.CodeInvalidArg, "localPath 为空", "")
	}
	abs, err := filepath.Abs(filepath.Clean(raw))
	if err != nil {
		return "", errno.Wrap(errno.CodeInvalidArg, "localPath 无效", err)
	}
	return abs, nil
}

// FindWorkbenchProjectByLocalPath 按本机路径匹配已存项目（大小写不敏感）。
func FindWorkbenchProjectByLocalPath(st *store.Store, localPath string) (model.WorkbenchProjectDO, bool, error) {
	want, err := NormalizeLocalPath(localPath)
	if err != nil {
		return model.WorkbenchProjectDO{}, false, err
	}
	if st == nil {
		return model.WorkbenchProjectDO{}, false, errno.New(errno.CodeStoreFailed, "Store 未就绪", "")
	}
	list, err := st.ListWorkbenchProjects()
	if err != nil {
		return model.WorkbenchProjectDO{}, false, err
	}
	for _, p := range list {
		got := strings.TrimSpace(p.LocalPath)
		if got == "" {
			continue
		}
		abs, err := NormalizeLocalPath(got)
		if err != nil {
			continue
		}
		if strings.EqualFold(abs, want) {
			return p, true, nil
		}
	}
	return model.WorkbenchProjectDO{}, false, nil
}

func projectSSHHostIDs(p model.WorkbenchProjectDO, max int) (ids []string, omitted int) {
	if max <= 0 {
		max = maxStageSSHHosts
	}
	seen := map[string]bool{}
	for _, l := range p.Links {
		if !strings.EqualFold(strings.TrimSpace(l.Kind), "ssh") {
			continue
		}
		id := strings.TrimSpace(l.ID)
		if id == "" || seen[id] {
			continue
		}
		seen[id] = true
		if len(ids) < max {
			ids = append(ids, id)
		} else {
			omitted++
		}
	}
	return ids, omitted
}

func ensureProjectFromLocalPath(d *Deps, localPath string) (model.WorkbenchProjectDO, bool, error) {
	abs, err := NormalizeLocalPath(localPath)
	if err != nil {
		return model.WorkbenchProjectDO{}, false, err
	}
	if err := cursorrule.IsForbiddenAutoCreatePath(abs); err != nil {
		return model.WorkbenchProjectDO{}, false, errno.New(errno.CodeInvalidArg, err.Error(), abs)
	}
	st, err := os.Stat(abs)
	if err != nil {
		return model.WorkbenchProjectDO{}, false, errno.Wrap(errno.CodeInvalidArg, "localPath 不可用", err)
	}
	if !st.IsDir() {
		return model.WorkbenchProjectDO{}, false, errno.New(errno.CodeInvalidArg, "localPath 不是目录", abs)
	}
	if hit, ok, err := FindWorkbenchProjectByLocalPath(d.Store, abs); err != nil {
		return model.WorkbenchProjectDO{}, false, err
	} else if ok {
		return hit, false, nil
	}
	name := filepath.Base(abs)
	if name == "" || name == "." || name == string(filepath.Separator) {
		name = "untitled"
	}
	draft := model.WorkbenchProjectDO{
		Name:      name,
		LocalPath: abs,
	}
	EnsureProjectGitRemote(&draft)
	saved, err := d.Store.SaveWorkbenchProject(draft)
	if err != nil {
		return model.WorkbenchProjectDO{}, false, err
	}
	if d.Radar != nil {
		d.Radar.EmitAsset(workbench.RadarDomainProject, "project", workbench.RadarOpCreate, saved.ID, "mcp-project-stage-create", saved.Name, true)
	}
	return saved, true, nil
}

// OpenProjectStage 编排：解析/建项 → 舞台规则 → 同步对话 → SSH id 列表 → 可选 UI 联动。
func OpenProjectStage(d *Deps, opts OpenProjectStageOpts) (model.OpenWorkbenchProjectStageResultDO, error) {
	out := model.OpenWorkbenchProjectStageResultDO{
		Source:     strings.TrimSpace(opts.Source),
		SSHHostIDs: []string{},
	}
	if d == nil || d.Store == nil {
		return out, errno.New(errno.CodeStoreFailed, "Store 未就绪", "")
	}
	id := strings.TrimSpace(opts.ID)
	lp := strings.TrimSpace(opts.LocalPath)
	var (
		p       model.WorkbenchProjectDO
		created bool
		err     error
	)
	switch {
	case id != "":
		p, err = d.Store.GetWorkbenchProject(id)
		if err != nil {
			return out, err
		}
	case lp != "":
		p, created, err = ensureProjectFromLocalPath(d, lp)
		if err != nil {
			return out, err
		}
	default:
		return out, errno.New(errno.CodeInvalidArg, "请提供 id 或 localPath", "")
	}
	out.Project = p
	out.Created = created

	if d.Notebook != nil && strings.TrimSpace(p.Name) != "" {
		_, _ = d.Notebook.EnsureWorkbenchProjectDialogDir(p.Name)
	}

	_ = d.Store.SetAppSetting(store.SettingLastWorkbenchProjectID, p.ID)

	if rule := attachCursorStageRule(p.LocalPath); rule != nil {
		out.CursorStageRule = rule
	}

	syncSum := &model.ProjectCursorSyncSummaryDO{}
	if strings.TrimSpace(p.LocalPath) != "" {
		syncOut, syncErr := SyncProjectCursorTranscripts(d, p.ID, "")
		if syncErr != nil {
			syncSum.OK = false
			syncSum.Error = syncErr.Error()
		} else {
			syncSum.OK = true
			syncSum.NSynced = len(syncOut.Synced)
			syncSum.NoteIDs = syncOut.NoteIDs
			syncSum.Skipped = syncOut.Skipped
			out.Project = syncOut.Project
			p = syncOut.Project
		}
	} else {
		syncSum.OK = false
		syncSum.Error = "无 localPath，跳过 Cursor 对话同步"
	}
	out.CursorSync = syncSum

	ids, omitted := projectSSHHostIDs(p, maxStageSSHHosts)
	out.SSHHostIDs = ids
	out.SSHHostIDsOmitted = omitted

	if d.Radar != nil {
		op := workbench.RadarOpUpdate
		if created {
			op = workbench.RadarOpCreate
		}
		writeID := "ui-project-stage-open"
		if opts.NotifyUI || out.Source == "mcp" || out.Source == "cursor" {
			writeID = "mcp-project-stage-open"
		}
		d.Radar.EmitAsset(workbench.RadarDomainProject, "project", op, p.ID, writeID, p.Name, true)
	}

	if opts.NotifyUI && d.UIActions != nil {
		d.UIActions.Dispatch(UIActionOpenProjectStage, map[string]interface{}{
			"projectId":           p.ID,
			"projectName":         p.Name,
			"localPath":           p.LocalPath,
			"created":             created,
			"sshHostIds":          ids,
			"sshHostIdsOmitted":   omitted,
			"source":              out.Source,
			"cursorSyncOk":        syncSum.OK,
			"cursorSyncN":         syncSum.NSynced,
			"cursorSyncError":     syncSum.Error,
			"stageLabel":          "项目舞台 · " + p.Name,
		})
	}

	noteParts := []string{}
	if created {
		noteParts = append(noteParts, "已自动创建项目")
	} else {
		noteParts = append(noteParts, "已对齐已有项目")
	}
	if omitted > 0 {
		noteParts = append(noteParts, "SSH 终端仅开前 3 个")
	}
	if syncSum.Error != "" && !syncSum.OK {
		noteParts = append(noteParts, "对话同步："+syncSum.Error)
	}
	out.Note = strings.Join(noteParts, "；")
	_ = opts.Intent
	return out, nil
}

func toolOpenProjectStage(_ context.Context, d *Deps, raw json.RawMessage) ToolResult {
	var in struct {
		ID        string `json:"id"`
		ProjectID string `json:"projectId"`
		LocalPath string `json:"localPath"`
		Intent    string `json:"intent"`
	}
	_ = json.Unmarshal(raw, &in)
	id := strings.TrimSpace(in.ID)
	if id == "" {
		id = strings.TrimSpace(in.ProjectID)
	}
	out, err := OpenProjectStage(d, OpenProjectStageOpts{
		ID:        id,
		LocalPath: in.LocalPath,
		Intent:    in.Intent,
		Source:    "mcp",
		NotifyUI:  true,
	})
	if err != nil {
		return Fail(err.Error())
	}
	return OKData(map[string]interface{}{
		"ok":                 true,
		"created":            out.Created,
		"project":            out.Project,
		"sshHostIds":         out.SSHHostIDs,
		"sshHostIdsOmitted":  out.SSHHostIDsOmitted,
		"cursorStageRule":    out.CursorStageRule,
		"cursorSync":         out.CursorSync,
		"source":             out.Source,
		"note":               out.Note,
	})
}

func registerOpenProjectStageTool(r *Registry) {
	r.add(ToolDef{
		Name: workbench.CapOpenProjectStage,
		Description: "打开/对齐 WWorkbench 项目可控舞台：写入 Cursor 舞台规则、同步 Cursor 对话、返回至多 3 个已钉 SSH。" +
			"传 id 或 localPath；localPath 无匹配项目时自动建项（拒绝 / 与 $HOME）。须 intent。" +
			"Cursor 新会话应尽早调用：localPath=工作区根绝对路径。",
		Parameters: map[string]interface{}{
			"type": "object",
			"properties": map[string]interface{}{
				"id":        map[string]interface{}{"type": "string", "description": "已存项目 id"},
				"projectId": map[string]interface{}{"type": "string", "description": "与 id 同义"},
				"localPath": map[string]interface{}{"type": "string", "description": "本机工作区根绝对路径；无项目则自动创建"},
				"intent":    intentProp(),
			},
			"required": []string{"intent"},
		},
		Handler: toolOpenProjectStage,
	})
}
