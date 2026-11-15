package workbenchtools

import (
	"context"
	"encoding/json"
	"strings"

	"WWorkbench/internal/model"
	"WWorkbench/internal/workbench"
)

func toolListWorkbenchProjects(_ context.Context, d *Deps, _ json.RawMessage) ToolResult {
	if d == nil || d.Store == nil {
		return Fail("Store 未就绪")
	}
	list, err := d.Store.ListWorkbenchProjects()
	if err != nil {
		return Fail(err.Error())
	}
	if list == nil {
		list = []model.WorkbenchProjectDO{}
	}
	return OKData(map[string]interface{}{"ok": true, "projects": list, "n": len(list)})
}

func toolGetWorkbenchProject(_ context.Context, d *Deps, raw json.RawMessage) ToolResult {
	var in struct {
		ID string `json:"id"`
	}
	_ = json.Unmarshal(raw, &in)
	id := strings.TrimSpace(in.ID)
	if id == "" {
		return Fail("请提供 id")
	}
	if d == nil || d.Store == nil {
		return Fail("Store 未就绪")
	}
	p, err := d.Store.GetWorkbenchProject(id)
	if err != nil {
		return Fail(err.Error())
	}
	return OKData(map[string]interface{}{"ok": true, "project": p})
}

func toolSaveWorkbenchProject(ctx context.Context, d *Deps, raw json.RawMessage) ToolResult {
	var in model.WorkbenchProjectDO
	if err := json.Unmarshal(raw, &in); err != nil {
		return Fail("参数无效: " + err.Error())
	}
	if d == nil || d.Store == nil {
		return Fail("Store 未就绪")
	}
	EnsureProjectGitRemote(&in)
	op := workbench.RadarOpUpdate
	if strings.TrimSpace(in.ID) == "" {
		op = workbench.RadarOpCreate
	}
	saved, err := d.Store.SaveWorkbenchProject(in)
	if err != nil {
		return Fail(err.Error())
	}
	if d.Radar != nil {
		d.Radar.EmitAsset(workbench.RadarDomainProject, "project", op, saved.ID, "mcp-project-save", saved.Name, true)
	}
	_ = ctx
	return OKData(map[string]interface{}{"ok": true, "project": saved})
}

func toolDeleteWorkbenchProject(_ context.Context, d *Deps, raw json.RawMessage) ToolResult {
	var in struct {
		ID     string `json:"id"`
		Intent string `json:"intent"`
	}
	_ = json.Unmarshal(raw, &in)
	id := strings.TrimSpace(in.ID)
	if id == "" {
		return Fail("请提供 id")
	}
	if d == nil || d.Store == nil {
		return Fail("Store 未就绪")
	}
	p, _ := d.Store.GetWorkbenchProject(id)
	if err := d.Store.DeleteWorkbenchProject(id); err != nil {
		return Fail(err.Error())
	}
	if d.Radar != nil {
		d.Radar.EmitAsset(workbench.RadarDomainProject, "project", workbench.RadarOpDelete, id, "mcp-project-delete", p.Name, false)
	}
	return OKData(map[string]interface{}{"ok": true, "id": id})
}

func registerProjectTools(r *Registry) {
	r.add(ToolDef{
		Name:        workbench.CapListProjects,
		Description: "列出项目组合（本机文件夹锚点 + 钉住的 ssh/db/docker/log/http/note/skill/backup）。",
		Parameters:  map[string]interface{}{"type": "object", "properties": map[string]interface{}{}},
		Handler:     toolListWorkbenchProjects,
	})
	r.add(ToolDef{
		Name:        workbench.CapGetProject,
		Description: "读取一个项目组合详情。id 来自 list_projects。",
		Parameters: map[string]interface{}{
			"type": "object",
			"properties": map[string]interface{}{
				"id": map[string]interface{}{"type": "string"},
			},
			"required": []string{"id"},
		},
		Handler: toolGetWorkbenchProject,
	})
	r.add(ToolDef{
		Name: workbench.CapSaveProject,
		Description: "创建或更新项目组合。必填 name 或 localPath；links 为资源引用数组 {kind,id,label?}。" +
			"kind=ssh|database|docker|log|http|note|backup|skill。不存密钥。" +
			"gitRemote 可空：空且有 localPath 时自动探测 origin。",
		Parameters: map[string]interface{}{
			"type": "object",
			"properties": map[string]interface{}{
				"id":        map[string]interface{}{"type": "string"},
				"name":      map[string]interface{}{"type": "string"},
				"localPath": map[string]interface{}{"type": "string", "description": "本机项目文件夹绝对路径"},
				"gitRemote": map[string]interface{}{"type": "string", "description": "可空；空则自动探测 git origin"},
				"links": map[string]interface{}{
					"type": "array",
					"items": map[string]interface{}{
						"type": "object",
						"properties": map[string]interface{}{
							"kind":  map[string]interface{}{"type": "string"},
							"id":    map[string]interface{}{"type": "string"},
							"label": map[string]interface{}{"type": "string"},
						},
					},
				},
				"intent": map[string]interface{}{"type": "string"},
			},
		},
		Handler: toolSaveWorkbenchProject,
	})
	r.add(ToolDef{
		Name:        workbench.CapDetectProjectGit,
		Description: "从本机项目目录探测 git origin URL（读 .git/config）。给 save_project / 智能配置填 gitRemote。",
		Parameters: map[string]interface{}{
			"type": "object",
			"properties": map[string]interface{}{
				"localPath": map[string]interface{}{"type": "string", "description": "本机项目文件夹绝对路径"},
			},
			"required": []string{"localPath"},
		},
		Handler: toolDetectProjectGit,
	})
	r.add(ToolDef{
		Name:        workbench.CapDeleteProject,
		Description: "删除项目组合（不删本机文件夹与其它产品资产）。须 intent。",
		Parameters: map[string]interface{}{
			"type": "object",
			"properties": map[string]interface{}{
				"id":     map[string]interface{}{"type": "string"},
				"intent": map[string]interface{}{"type": "string"},
			},
			"required": []string{"id", "intent"},
		},
		Handler: toolDeleteWorkbenchProject,
	})
	r.add(ToolDef{
		Name: workbench.CapSuggestProjectResources,
		Description: "智能配置·建议：按项目名/本机路径/git 与现有 ssh/db/docker/log/http/note/skill/backup 做匹配打分，返回候选（含 reason/score/alreadyLinked）。" +
			"笔记按标题匹配；记忆区项目 localPath 对齐时优先建议约定笔记/Skill。传 id 读已存项目；或传 name+localPath(+gitRemote) 对草稿建议。下一步用 configure_project_resources 钉入。",
		Parameters: map[string]interface{}{
			"type": "object",
			"properties": map[string]interface{}{
				"id":        map[string]interface{}{"type": "string", "description": "已存项目 id"},
				"name":      map[string]interface{}{"type": "string"},
				"localPath": map[string]interface{}{"type": "string"},
				"gitRemote": map[string]interface{}{"type": "string"},
			},
		},
		Handler: toolSuggestProjectResources,
	})
	r.add(ToolDef{
		Name: workbench.CapConfigureProjectResources,
		Description: "智能配置·应用：把 suggest_project_resources 的候选钉进项目并保存。" +
			"keys 为空=采纳全部未钉建议；否则传 [\"ssh:id\",\"database:id\",…]。须 intent。",
		Parameters: map[string]interface{}{
			"type": "object",
			"properties": map[string]interface{}{
				"id":     map[string]interface{}{"type": "string", "description": "项目 id"},
				"keys":   map[string]interface{}{"type": "array", "items": map[string]interface{}{"type": "string"}, "description": "kind:id 列表；空=全采纳"},
				"intent": map[string]interface{}{"type": "string"},
			},
			"required": []string{"id", "intent"},
		},
		Handler: toolConfigureProjectResources,
	})
	r.add(ToolDef{
		Name: workbench.CapSyncProjectCursorTranscripts,
		Description: "把本机 Cursor agent-transcripts 同步进项目仓库 .wworkbench/cursor-transcripts/（跨机 git SSOT），" +
			"并镜像成笔记本「项目/{名}/对话/」笔记钉进 links。可选 transcriptId 只同步一条。须 intent。",
		Parameters: map[string]interface{}{
			"type": "object",
			"properties": map[string]interface{}{
				"id":           map[string]interface{}{"type": "string", "description": "项目 id"},
				"transcriptId": map[string]interface{}{"type": "string", "description": "可选：只同步该会话 id"},
				"intent":       map[string]interface{}{"type": "string"},
			},
			"required": []string{"id", "intent"},
		},
		Handler: toolSyncProjectCursorTranscripts,
	})
	r.add(ToolDef{
		Name:        workbench.CapListProjectCursorTranscripts,
		Description: "列出项目仓库内已同步的 Cursor transcripts（id/title/updated/noteId）。",
		Parameters: map[string]interface{}{
			"type": "object",
			"properties": map[string]interface{}{
				"id": map[string]interface{}{"type": "string", "description": "项目 id"},
			},
			"required": []string{"id"},
		},
		Handler: toolListProjectCursorTranscripts,
	})
	r.add(ToolDef{
		Name: workbench.CapGetProjectCursorTranscript,
		Description: "读取一条已同步的 Cursor transcript。默认返回可读 md（去 tool 噪音）；raw=true 返回 jsonl 截断正文。" +
			"换机续作：先 list 再 get 最近 1～2 条，勿把整份 jsonl 贴进聊天。",
		Parameters: map[string]interface{}{
			"type": "object",
			"properties": map[string]interface{}{
				"id":           map[string]interface{}{"type": "string", "description": "项目 id"},
				"transcriptId": map[string]interface{}{"type": "string"},
				"raw":          map[string]interface{}{"type": "boolean", "description": "true=jsonl 原文截断"},
			},
			"required": []string{"id", "transcriptId"},
		},
		Handler: toolGetProjectCursorTranscript,
	})
}

func toolSyncProjectCursorTranscripts(_ context.Context, d *Deps, raw json.RawMessage) ToolResult {
	var in struct {
		ID           string `json:"id"`
		TranscriptID string `json:"transcriptId"`
		Intent       string `json:"intent"`
	}
	_ = json.Unmarshal(raw, &in)
	id := strings.TrimSpace(in.ID)
	if id == "" {
		return Fail("请提供 id")
	}
	out, err := SyncProjectCursorTranscripts(d, id, in.TranscriptID)
	if err != nil {
		return Fail(err.Error())
	}
	return OKData(map[string]interface{}{
		"ok":            true,
		"project":       out.Project,
		"synced":        out.Synced,
		"nSynced":       len(out.Synced),
		"skipped":       out.Skipped,
		"noteIds":       out.NoteIDs,
		"gitIgnoreOk":   out.GitIgnoreOK,
		"gitIgnoreHint": out.GitIgnoreHint,
		"note":          "跨机：提交 .wworkbench/cursor-transcripts/ 后 pull；换机 list/get 再续。requestId 不能恢复聊天窗。",
	})
}

func toolListProjectCursorTranscripts(_ context.Context, d *Deps, raw json.RawMessage) ToolResult {
	var in struct {
		ID string `json:"id"`
	}
	_ = json.Unmarshal(raw, &in)
	id := strings.TrimSpace(in.ID)
	if id == "" {
		return Fail("请提供 id")
	}
	if d == nil || d.Store == nil {
		return Fail("Store 未就绪")
	}
	p, err := d.Store.GetWorkbenchProject(id)
	if err != nil {
		return Fail(err.Error())
	}
	list, err := ListProjectCursorTranscripts(p.LocalPath)
	if err != nil {
		return Fail(err.Error())
	}
	return OKData(map[string]interface{}{
		"ok":          true,
		"projectId":   p.ID,
		"localPath":   p.LocalPath,
		"transcripts": list,
		"n":           len(list),
	})
}

func toolGetProjectCursorTranscript(_ context.Context, d *Deps, raw json.RawMessage) ToolResult {
	var in struct {
		ID           string `json:"id"`
		TranscriptID string `json:"transcriptId"`
		Raw          bool   `json:"raw"`
	}
	_ = json.Unmarshal(raw, &in)
	id := strings.TrimSpace(in.ID)
	tid := strings.TrimSpace(in.TranscriptID)
	if id == "" || tid == "" {
		return Fail("请提供 id 与 transcriptId")
	}
	if d == nil || d.Store == nil {
		return Fail("Store 未就绪")
	}
	p, err := d.Store.GetWorkbenchProject(id)
	if err != nil {
		return Fail(err.Error())
	}
	meta, body, bodyPath, err := GetProjectCursorTranscript(p.LocalPath, tid, !in.Raw)
	if err != nil {
		return Fail(err.Error())
	}
	return OKData(map[string]interface{}{
		"ok":       true,
		"meta":     meta,
		"body":     body,
		"bodyPath": bodyPath,
		"format":   map[bool]string{true: "jsonl", false: "markdown"}[in.Raw],
	})
}

func toolDetectProjectGit(_ context.Context, _ *Deps, raw json.RawMessage) ToolResult {
	var in struct {
		LocalPath string `json:"localPath"`
	}
	_ = json.Unmarshal(raw, &in)
	path := strings.TrimSpace(in.LocalPath)
	if path == "" {
		return Fail("请提供 localPath")
	}
	url := DetectGitRemote(path)
	return OKData(map[string]interface{}{
		"ok":        true,
		"localPath": path,
		"gitRemote": url,
		"found":     url != "",
	})
}

func toolSuggestProjectResources(_ context.Context, d *Deps, raw json.RawMessage) ToolResult {
	var in struct {
		ID        string `json:"id"`
		Name      string `json:"name"`
		LocalPath string `json:"localPath"`
		GitRemote string `json:"gitRemote"`
	}
	_ = json.Unmarshal(raw, &in)
	if d == nil || d.Store == nil {
		return Fail("Store 未就绪")
	}
	var p model.WorkbenchProjectDO
	if id := strings.TrimSpace(in.ID); id != "" {
		got, err := d.Store.GetWorkbenchProject(id)
		if err != nil {
			return Fail(err.Error())
		}
		p = got
	} else {
		p = model.WorkbenchProjectDO{
			Name:      strings.TrimSpace(in.Name),
			LocalPath: strings.TrimSpace(in.LocalPath),
			GitRemote: strings.TrimSpace(in.GitRemote),
		}
		if p.Name == "" && p.LocalPath == "" {
			return Fail("请提供 id，或 name/localPath")
		}
	}
	EnsureProjectGitRemote(&p)
	out := SuggestProjectResources(d, p)
	return OKData(map[string]interface{}{
		"ok":          true,
		"project":     out.Project,
		"gitRemote":   out.Project.GitRemote,
		"tokens":      out.Tokens,
		"suggestions": out.Suggestions,
		"n":           len(out.Suggestions),
		"note":        "由 Agent 核对后 configure_project_resources(id, keys?, intent) 钉入；keys 空=全采纳未钉项。gitRemote 已自动探测时可一并 save_project。",
	})
}

func toolConfigureProjectResources(_ context.Context, d *Deps, raw json.RawMessage) ToolResult {
	var in struct {
		ID     string   `json:"id"`
		Keys   []string `json:"keys"`
		Intent string   `json:"intent"`
	}
	_ = json.Unmarshal(raw, &in)
	id := strings.TrimSpace(in.ID)
	if id == "" {
		return Fail("请提供 id")
	}
	if d == nil || d.Store == nil {
		return Fail("Store 未就绪")
	}
	out, err := ConfigureProjectResources(d, id, in.Keys)
	if err != nil {
		return Fail(err.Error())
	}
	return OKData(map[string]interface{}{
		"ok":      true,
		"project": out.Project,
		"added":   out.Added,
		"skipped": out.Skipped,
		"nAdded":  len(out.Added),
	})
}
