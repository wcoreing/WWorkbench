package workbenchtools

import (
	"context"
	"encoding/json"
	"strings"
	"sync"

	"WWorkbench/internal/errno"
	"WWorkbench/internal/model"
)

const adhocTaskSession = "adhoc"

var (
	taskLogMu       sync.Mutex
	activeRunBySess = map[string]string{}
	currentTaskSess = adhocTaskSession
)

// BrowserStepInput / TaskStepInput 记一步任务账本（思考或操作）。
type BrowserStepInput struct {
	Session  string
	Tool     string
	Action   string
	Intent   string
	Summary  string
	Args     map[string]interface{}
	Locator  map[string]interface{}
	Result   json.RawMessage
	OK       bool
	Error    string
	Approved bool
	Title    string // 开新 run 时可选标题
	Source   string // mcp | ui | browser | agent
	Kind     string // thought | op（默认 op）
	Provider string // wwb | kimi | agent | ui | record | mcp
}

// TaskStepInput 与 BrowserStepInput 同构（账本通用入口名）。
type TaskStepInput = BrowserStepInput

// EnsureTaskRun 确保 session 有进行中的任务；返回 runId。
func EnsureTaskRun(d *Deps, session, title, intent, source string) string {
	if d == nil || d.Store == nil {
		return ""
	}
	session = normalizeTaskSession(session)
	taskLogMu.Lock()
	defer taskLogMu.Unlock()
	currentTaskSess = session
	if id := activeRunBySess[session]; id != "" {
		return id
	}
	if open, err := d.Store.FindOpenTaskRunBySession(session); err == nil && open.ID != "" {
		activeRunBySess[session] = open.ID
		return open.ID
	}
	if strings.TrimSpace(title) == "" {
		title = session
	}
	if strings.TrimSpace(source) == "" {
		source = "browser"
	}
	run, err := d.Store.CreateTaskRun(model.TaskRunDO{
		Session: session,
		Title:   title,
		Intent:  strings.TrimSpace(intent),
		Status:  "running",
		Source:  source,
	})
	if err != nil {
		return ""
	}
	activeRunBySess[session] = run.ID
	return run.ID
}

// CloseTaskRunForSession 结束某 session 的进行中任务。
func CloseTaskRunForSession(d *Deps, session, status string) {
	if d == nil || d.Store == nil {
		return
	}
	session = normalizeTaskSession(session)
	if status == "" {
		status = "done"
	}
	taskLogMu.Lock()
	id := activeRunBySess[session]
	delete(activeRunBySess, session)
	taskLogMu.Unlock()
	if id == "" {
		if open, err := d.Store.FindOpenTaskRunBySession(session); err == nil {
			id = open.ID
		}
	}
	if id != "" {
		_ = d.Store.UpdateTaskRunStatus(id, status)
	}
}

// CloseTaskRunByID 按 id 结束任务，并清理 session 活跃缓存。
func CloseTaskRunByID(d *Deps, runID, status string) error {
	if d == nil || d.Store == nil {
		return errno.New(errno.CodeInvalidArg, "存储未就绪", "")
	}
	runID = strings.TrimSpace(runID)
	if runID == "" {
		return errno.New(errno.CodeInvalidArg, "runId 不能为空", "")
	}
	if status == "" {
		status = "done"
	}
	run, err := d.Store.GetTaskRun(runID)
	if err != nil {
		return err
	}
	taskLogMu.Lock()
	if sid := normalizeTaskSession(run.Session); sid != "" && activeRunBySess[sid] == runID {
		delete(activeRunBySess, sid)
	}
	taskLogMu.Unlock()
	return d.Store.UpdateTaskRunStatus(runID, status)
}

// RecordTaskStep 记一步任务账本（思考/操作）；无 Store 时静默跳过。返回 runId。
func RecordTaskStep(d *Deps, in TaskStepInput) string {
	if d == nil || d.Store == nil {
		return ""
	}
	session := in.Session
	if strings.TrimSpace(session) == "" {
		taskLogMu.Lock()
		session = currentTaskSess
		taskLogMu.Unlock()
	}
	source := in.Source
	if source == "" {
		source = "mcp"
	}
	kind := strings.TrimSpace(in.Kind)
	if kind == "" {
		kind = model.TaskStepKindOp
	}
	provider := strings.TrimSpace(in.Provider)
	if provider == "" {
		provider = model.TaskProviderMCP
	}
	runID := EnsureTaskRun(d, session, in.Title, in.Intent, source)
	if runID == "" {
		return ""
	}
	argsJSON := "{}"
	if in.Args != nil {
		if b, err := json.Marshal(in.Args); err == nil {
			argsJSON = string(b)
		}
	}
	locator := ""
	if in.Locator != nil {
		if b, err := json.Marshal(in.Locator); err == nil {
			locator = string(b)
		}
	}
	result := ""
	if len(in.Result) > 0 {
		result = truncateJSON(string(in.Result), 2000)
	}
	summary := strings.TrimSpace(in.Summary)
	if summary == "" {
		summary = in.Action
	}
	action := strings.TrimSpace(in.Action)
	if action == "" && kind == model.TaskStepKindThought {
		action = "thought"
	}
	tool := strings.TrimSpace(in.Tool)
	if tool == "" && kind == model.TaskStepKindThought {
		tool = "agent"
	}
	_, _ = d.Store.AppendTaskStep(model.TaskStepDO{
		RunID:    runID,
		Kind:     kind,
		Provider: provider,
		Tool:     tool,
		Action:   action,
		Intent:   strings.TrimSpace(in.Intent),
		Summary:  summary,
		ArgsJSON: argsJSON,
		Locator:  locator,
		Result:   result,
		OK:       in.OK,
		Error:    in.Error,
		Approved: in.Approved,
	})
	// 同步文本 log.md（笔记 IDE）；失败不影响记步。
	if d.Notebook != nil {
		_, _, _, _ = SyncTaskRunLogNote(d, runID)
	}
	// 单步失败不结束整次任务；close_session / 人工结束才收口。
	return runID
}

// RecordBrowserStep 记操作步（兼容旧调用）；等价 RecordTaskStep(kind=op)。
func RecordBrowserStep(d *Deps, in BrowserStepInput) string {
	if strings.TrimSpace(in.Kind) == "" {
		in.Kind = model.TaskStepKindOp
	}
	return RecordTaskStep(d, in)
}

// RecordAgentThought 侧栏/引擎把阶段性推理写入当前任务账本。
func RecordAgentThought(d *Deps, summary string) string {
	summary = strings.TrimSpace(summary)
	if summary == "" {
		return ""
	}
	if len([]rune(summary)) > 1200 {
		summary = string([]rune(summary)[:1200]) + "…"
	}
	return RecordTaskStep(d, TaskStepInput{
		Kind:     model.TaskStepKindThought,
		Provider: model.TaskProviderAgent,
		Tool:     "agent",
		Action:   "thought",
		Summary:  summary,
		OK:       true,
		Source:   "agent",
	})
}

// CurrentTaskSession 当前活跃任务 session（供 Runner 记思考）。
func CurrentTaskSession() string {
	taskLogMu.Lock()
	defer taskLogMu.Unlock()
	return currentTaskSess
}

// HasActiveTask 是否有进行中的任务账本（非纯闲聊）。
func HasActiveTask() bool {
	taskLogMu.Lock()
	defer taskLogMu.Unlock()
	if currentTaskSess != adhocTaskSession {
		return true
	}
	return len(activeRunBySess) > 0
}

func normalizeTaskSession(session string) string {
	session = strings.TrimSpace(session)
	if session == "" {
		return adhocTaskSession
	}
	return session
}

func truncateJSON(s string, max int) string {
	if max <= 0 || len(s) <= max {
		return s
	}
	return s[:max] + "…"
}

func locatorFrom(ref, selector, name, frame string) map[string]interface{} {
	m := map[string]interface{}{}
	if ref != "" {
		m["ref"] = ref
	}
	if selector != "" {
		m["selector"] = selector
	}
	if name != "" {
		m["name"] = name
	}
	if frame != "" {
		m["frame"] = frame
	}
	if len(m) == 0 {
		return nil
	}
	return m
}

func recordBrowserFail(d *Deps, in BrowserStepInput, err error) ToolResult {
	in.OK = false
	if err != nil {
		in.Error = err.Error()
	}
	RecordBrowserStep(d, in)
	if err != nil {
		return Fail(err.Error())
	}
	return Fail(in.Error)
}

func recordBrowserOK(d *Deps, in BrowserStepInput, data json.RawMessage) ToolResult {
	in.OK = true
	in.Result = data
	runID := RecordBrowserStep(d, in)
	var out map[string]interface{}
	if json.Unmarshal(data, &out) != nil {
		m := map[string]interface{}{"ok": true, "raw": json.RawMessage(data)}
		if runID != "" {
			m["taskRunId"] = runID
		}
		return OKData(m)
	}
	out["ok"] = true
	if runID != "" {
		out["taskRunId"] = runID
	}
	return OKData(out)
}

func toolListTaskRuns(_ context.Context, d *Deps, raw json.RawMessage) ToolResult {
	if d == nil || d.Store == nil {
		return Fail("存储未就绪")
	}
	var in struct {
		Session string `json:"session"`
		Limit   int    `json:"limit"`
	}
	_ = json.Unmarshal(raw, &in)
	list, err := d.Store.ListTaskRuns(in.Session, in.Limit)
	if err != nil {
		return Fail(err.Error())
	}
	if list == nil {
		list = []model.TaskRunDO{}
	}
	return OKData(map[string]interface{}{"runs": list, "total": len(list)})
}

func toolGetTaskRun(_ context.Context, d *Deps, raw json.RawMessage) ToolResult {
	if d == nil || d.Store == nil {
		return Fail("存储未就绪")
	}
	var in struct {
		RunID string `json:"runId"`
		ID    string `json:"id"`
	}
	_ = json.Unmarshal(raw, &in)
	id := strings.TrimSpace(in.RunID)
	if id == "" {
		id = strings.TrimSpace(in.ID)
	}
	if id == "" {
		return Fail("请提供 runId")
	}
	detail, err := d.Store.GetTaskRunDetail(id)
	if err != nil {
		return Fail(err.Error())
	}
	return OKData(detail)
}

func toolTaskRecord(_ context.Context, d *Deps, raw json.RawMessage) ToolResult {
	if d == nil || d.Store == nil {
		return Fail("存储未就绪")
	}
	var in struct {
		Session  string                 `json:"session"`
		Kind     string                 `json:"kind"`
		Summary  string                 `json:"summary"`
		Intent   string                 `json:"intent"`
		Action   string                 `json:"action"`
		Tool     string                 `json:"tool"`
		Provider string                 `json:"provider"`
		Title    string                 `json:"title"`
		OK       *bool                  `json:"ok"`
		Error    string                 `json:"error"`
		Args     map[string]interface{} `json:"args"`
	}
	if err := json.Unmarshal(raw, &in); err != nil {
		return Fail("参数无效")
	}
	kind := strings.TrimSpace(in.Kind)
	if kind == "" {
		kind = model.TaskStepKindThought
	}
	if kind != model.TaskStepKindThought && kind != model.TaskStepKindOp {
		return Fail("kind 须为 thought 或 op")
	}
	summary := strings.TrimSpace(in.Summary)
	if summary == "" {
		summary = strings.TrimSpace(in.Intent)
	}
	if summary == "" {
		return Fail("请提供 summary 或 intent")
	}
	ok := true
	if in.OK != nil {
		ok = *in.OK
	}
	provider := strings.TrimSpace(in.Provider)
	if provider == "" {
		if kind == model.TaskStepKindThought {
			provider = model.TaskProviderAgent
		} else {
			provider = model.TaskProviderMCP
		}
	}
	runID := RecordTaskStep(d, TaskStepInput{
		Session:  in.Session,
		Kind:     kind,
		Provider: provider,
		Tool:     in.Tool,
		Action:   in.Action,
		Intent:   in.Intent,
		Summary:  summary,
		Title:    in.Title,
		Args:     in.Args,
		OK:       ok,
		Error:    in.Error,
		Source:   "mcp",
	})
	return OKData(map[string]interface{}{
		"ok": true, "taskRunId": runID, "kind": kind, "provider": provider,
		"note": "已写入任务账本并同步 log.md",
	})
}
