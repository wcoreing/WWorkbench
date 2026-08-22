package agent

import (
	"context"
	"encoding/json"
	"fmt"
	"strings"
	"sync"
	"time"
	"unicode/utf8"

	"WWorkbench/internal/agentcap"
	"WWorkbench/internal/harness"
	"WWorkbench/internal/model"
	"WWorkbench/internal/store"
	"WWorkbench/internal/turnctx"
	"WWorkbench/internal/workbenchtools"

	"github.com/cloudwego/eino/schema"
	"github.com/google/uuid"
	"github.com/wcoreing/ningharness/history"
	nhskill "github.com/wcoreing/ningharness/skill"
)

// Emitter 向前端推送 Agent 事件。
type Emitter func(event string, payload map[string]interface{})

// threadState 进程内会话缓存。
type threadState struct {
	mu            sync.Mutex
	id            string
	title         string
	context       model.AgentContextDO
	taskID        string
	pendingImages []model.AgentChatImageDO
	mode          string
}

// Runner Agent Host 薄封装：编排交给 ningharness Lifecycle，思考交给 WorkbenchGuest（流式）。
type Runner struct {
	store   *store.Store
	tools   *workbenchtools.Registry
	harness *harness.Host
	threads map[string]*threadState
	mu      sync.Mutex
	emit    Emitter
	appCtx  context.Context
	runs    map[string]context.CancelFunc
	runsMu  sync.Mutex
}

// NewRunner 创建 Runner。
func NewRunner(st *store.Store, reg *workbenchtools.Registry, h *harness.Host, appCtx context.Context, emit Emitter) *Runner {
	return &Runner{
		store:   st,
		tools:   reg,
		harness: h,
		threads: map[string]*threadState{},
		emit:    emit,
		appCtx:  appCtx,
		runs:    map[string]context.CancelFunc{},
	}
}

// Stop 停止指定线程正在进行的生成。
func (r *Runner) Stop(threadID string) bool {
	if threadID == "" {
		return false
	}
	r.runsMu.Lock()
	cancel, ok := r.runs[threadID]
	r.runsMu.Unlock()
	if !ok {
		return false
	}
	cancel()
	return true
}

// InvalidateThread 丢弃进程内会话缓存。
func (r *Runner) InvalidateThread(threadID string) {
	r.mu.Lock()
	delete(r.threads, threadID)
	r.mu.Unlock()
}

// Rewind 截断工作记忆并清缓存。
func (r *Runner) Rewind(threadID string, keepSeq int) error {
	r.Stop(threadID)
	if r.harness == nil {
		return fmt.Errorf("harness 未就绪")
	}
	if err := r.harness.RewindHistory(threadID, keepSeq); err != nil {
		return err
	}
	r.InvalidateThread(threadID)
	return nil
}

// preparedChat 一次对话轮次的公共准备结果。
type preparedChat struct {
	threadID  string
	prompt    string
	ff        string
	skillIDs  []string
	uiContent string
	ctxSnap   model.AgentContextDO
	images    []model.AgentChatImageDO
	th        *threadState
}

// prepareChat 校验并准备会话；resolveLeading 为 true 时解析消息开头 /skill。
func (r *Runner) prepareChat(req model.AgentChatRequestDO, resolveLeading bool) (preparedChat, error) {
	if r.harness == nil {
		return preparedChat{}, fmt.Errorf("ningharness 未就绪，请重启应用")
	}
	msg := strings.TrimSpace(req.Message)
	images, err := normalizeChatImages(req.Images)
	if err != nil {
		return preparedChat{}, err
	}
	if msg == "" && len(images) == 0 {
		return preparedChat{}, fmt.Errorf("消息不能为空")
	}
	settings := r.store.GetAgentSettings()
	if !settings.HasAPIKey {
		return preparedChat{}, fmt.Errorf("请先在 AI 设置中填写 API Key 并保存")
	}
	if strings.TrimSpace(settings.Model) == "" {
		return preparedChat{}, fmt.Errorf("请先在 AI 设置中填写模型名称")
	}

	skillIDs := trimSkillIDs(req.SkillIDs)
	if resolveLeading && len(skillIDs) == 0 {
		if list, err := nhskill.ListEnabled(r.harness.Root); err == nil {
			rest, ids := nhskill.ResolveLeadingCommand(msg, list)
			if len(ids) > 0 {
				skillIDs = ids
				msg = rest
			}
		}
	}

	threadID := strings.TrimSpace(req.ThreadID)
	if threadID == "" {
		threadID = uuid.NewString()
	}
	th := r.getOrCreateThread(threadID, req.Context, firstLineTitle(msg, len(images) > 0))
	th.mu.Lock()
	th.pendingImages = images
	th.mode = NormalizeChatMode(req.Mode)
	if th.mode == "" {
		th.mode = ChatModeAgent
	}
	th.mu.Unlock()

	ctxSnap := turnctx.AttachSSHEndpoints(req.Context, sshEndpointLookup(r.store))
	ff := turnctx.Gather(ctxSnap, msg)
	_ = r.harness.SetBindings(threadID, ctxSnap.Mentions, turnctx.FocusRefFromContext(ctxSnap))

	uiContent := strings.TrimSpace(req.Message)
	if uiContent == "" {
		uiContent = msg
	}
	if uiContent == "" && len(images) > 0 {
		uiContent = imageOnlyPrompt
	}
	prompt := msg
	if prompt == "" {
		prompt = imageOnlyPrompt
	}
	return preparedChat{
		threadID: threadID, prompt: prompt, ff: ff, skillIDs: skillIDs,
		uiContent: uiContent, ctxSnap: ctxSnap, images: images, th: th,
	}, nil
}

func (r *Runner) emitAgentUser(p preparedChat) {
	payload := map[string]interface{}{
		"threadId": p.threadID, "content": p.uiContent, "mentions": p.ctxSnap.Mentions,
	}
	if len(p.images) > 0 {
		payload["images"] = previewImages(p.images)
	}
	if len(p.skillIDs) > 0 {
		payload["skillIds"] = p.skillIDs
	}
	r.emit("agent:user", payload)
}

// Chat 处理用户消息（Lifecycle 异步；Guest 内 Provider 流式）。
func (r *Runner) Chat(req model.AgentChatRequestDO) (string, error) {
	p, err := r.prepareChat(req, true)
	if err != nil {
		return "", err
	}
	r.emitAgentUser(p)
	go r.runTurn(p.th.id, p.prompt, p.ff, false, p.skillIDs)
	return p.threadID, nil
}

// Confirm 用户批准待确认操作并继续对话。
func (r *Runner) Confirm(pendingID string, approved bool) error {
	if r.harness == nil {
		return fmt.Errorf("ningharness 未就绪")
	}
	p, err := r.store.GetAgentPending(pendingID)
	if err != nil {
		return err
	}
	th := r.ensureThread(p.ThreadID)
	if th == nil {
		return fmt.Errorf("对话线程不存在")
	}
	taskID := r.store.GetAgentPendingTaskID(pendingID)
	_ = r.store.DeleteAgentPending(pendingID)
	root := r.harness.Root

	if !approved {
		summary := "用户已拒绝"
		denied := workbenchtools.Fail(summary)
		body, _ := json.Marshal(denied)
		rid, _, _ := r.harness.PutToolResult(p.ThreadID, taskID, pendingID, p.ToolName, string(body))
		ids := history.EncodeResourceIDs([]int64{rid})
		_ = history.Append(root, p.ThreadID, history.Msg{
			Role: "tool", ToolCallID: pendingID, TaskID: taskID,
			Content: formatToolMessage(denied, rid), ResourceIDsJSON: ids,
		})
		r.emit("agent:tool_end", map[string]interface{}{
			"threadId": p.ThreadID, "tool": p.ToolName,
			"status": StatusDenied, "summary": summary, "result": denied,
		})
		go r.runTurn(p.ThreadID, "", "", true, nil)
		return nil
	}

	var result workbenchtools.ToolResult
	switch p.ToolName {
	case "execute_sql":
		result = workbenchtools.ExecuteSQLConfirmed(r.appCtx, r.tools.Deps(), p.ArgsJSON)
	case "execute_http":
		result = workbenchtools.ExecuteHTTPConfirmed(r.appCtx, r.tools.Deps(), p.ArgsJSON)
	case "start_container":
		result = workbenchtools.StartContainerConfirmed(r.appCtx, r.tools.Deps(), p.ArgsJSON)
	case "stop_container":
		result = workbenchtools.StopContainerConfirmed(r.appCtx, r.tools.Deps(), p.ArgsJSON)
	case "remove_container":
		result = workbenchtools.RemoveContainerConfirmed(r.appCtx, r.tools.Deps(), p.ArgsJSON)
	default:
		result = r.harness.CallTool(r.appCtx, p.ToolName, json.RawMessage(p.ArgsJSON))
	}
	st, summary := toolStatus(p.ToolName, result)
	body, _ := json.Marshal(result)
	rid, _, _ := r.harness.PutToolResult(p.ThreadID, taskID, pendingID, p.ToolName, string(body))
	if rid > 0 {
		summary = fmt.Sprintf("%s · #%d", summary, rid)
	}
	_ = history.Append(root, p.ThreadID, history.Msg{
		Role: "tool", ToolCallID: pendingID, TaskID: taskID,
		Content:         formatToolMessage(result, rid),
		ResourceIDsJSON: history.EncodeResourceIDs([]int64{rid}),
	})
	end := map[string]interface{}{
		"threadId": p.ThreadID, "tool": p.ToolName,
		"status": st, "summary": summary, "result": result,
	}
	if rid > 0 {
		end["resourceId"] = rid
	}
	r.emit("agent:tool_end", end)
	go r.runTurn(p.ThreadID, "", "", true, nil)
	return nil
}

// TestConnection 测试 LLM 连接（经 harness guest/model）。
func (r *Runner) TestConnection() (string, error) {
	if r.harness == nil {
		return "", fmt.Errorf("harness 未就绪")
	}
	settings := r.store.GetAgentSettings()
	if !settings.HasAPIKey {
		return "", fmt.Errorf("请先保存 API Key")
	}
	ctx, cancel := context.WithTimeout(r.appCtx, 60*time.Second)
	defer cancel()
	cm, err := r.harness.NewChatModel(ctx, settings.Provider, r.store.AgentAPIKey(), settings.APIBase, settings.Model)
	if err != nil {
		return "", err
	}
	out, err := r.harness.Complete(ctx, cm, []*schema.Message{
		schema.UserMessage("回复 OK 两个字母即可"),
	}, nil)
	if err != nil {
		return "", err
	}
	text := strings.TrimSpace(out.Content)
	if text == "" {
		return "连接成功（模型未返回文本）", nil
	}
	return "连接成功: " + text, nil
}

// ListMessages 列出线程消息（UI；SSOT=ningharness history）。
func (r *Runner) ListMessages(threadID string) []model.AgentMessageDO {
	if r.harness == nil {
		return nil
	}
	msgs, err := history.Load(r.harness.Root, threadID)
	if err != nil {
		return nil
	}
	out := make([]model.AgentMessageDO, 0, len(msgs))
	for _, m := range msgs {
		if !history.IsUIRole(m) {
			continue
		}
		content := history.ContentForUI(m.Content)
		// 兼容旧 ningharness：确认续跑曾落盘 "(context)" 占位。
		content, images := messageImagesFromContent(r.harness.Root, content)
		if m.Role == "user" && (content == "" || content == "(context)") && len(images) == 0 {
			continue
		}
		item := model.AgentMessageDO{
			Role: m.Role, Content: content, Seq: m.Seq,
		}
		if len(images) > 0 {
			item.Images = images
		}
		out = append(out, item)
	}
	return out
}

func (r *Runner) runTurn(threadID, prompt, feedforward string, skipUser bool, skillIDs []string) {
	defer func() {
		if rec := recover(); rec != nil {
			r.emit("agent:done", map[string]interface{}{
				"threadId": threadID, "error": fmt.Sprintf("AI 内部错误: %v", rec),
			})
		}
	}()
	th := r.ensureThread(threadID)
	if th == nil || r.harness == nil {
		r.emit("agent:done", map[string]interface{}{"threadId": threadID, "error": "会话或 harness 不可用"})
		return
	}
	settings := r.store.GetAgentSettings()
	cm, err := r.harness.NewChatModel(r.appCtx, settings.Provider, r.store.AgentAPIKey(), settings.APIBase, settings.Model)
	if err != nil {
		r.emit("agent:done", map[string]interface{}{"threadId": threadID, "error": err.Error()})
		return
	}
	ctx, cancel := context.WithTimeout(r.appCtx, 180*time.Second)
	r.runsMu.Lock()
	if old, ok := r.runs[threadID]; ok {
		old()
	}
	r.runs[threadID] = cancel
	r.runsMu.Unlock()
	defer func() {
		r.runsMu.Lock()
		delete(r.runs, threadID)
		r.runsMu.Unlock()
		cancel()
	}()

	taskID := fmt.Sprintf("chat:%d", time.Now().UnixMilli())
	th.mu.Lock()
	th.taskID = taskID
	ctxSnap := th.context
	pending := th.pendingImages
	th.pendingImages = nil
	mode := NormalizeChatMode(th.mode)
	th.mu.Unlock()

	if !skipUser && len(pending) > 0 && r.harness.Root != "" {
		refs, putErr := putUserImages(r.harness.Root, threadID, taskID, pending)
		if putErr != nil {
			r.emit("agent:done", map[string]interface{}{"threadId": threadID, "error": putErr.Error()})
			return
		}
		prompt = history.EncodeImageHead(refs) + prompt
	}

	g := &workbenchGuest{
		r: r, threadID: threadID, taskID: taskID,
		ctxSnap: ctxSnap, cm: cm, mode: mode,
	}
	r.harness.RT.SetGuest(g)

	_, err = r.harness.RunTurn(ctx, harness.TurnInput{
		SessionKey:     threadID,
		Prompt:         prompt,
		Feedforward:    feedforward,
		SkipUserAppend: skipUser,
		TaskID:         taskID,
		SkillIDs:       trimSkillIDs(skillIDs),
		OnDelta: func(delta string) {
			if delta == "" {
				return
			}
			r.emit("agent:assistant_delta", map[string]interface{}{
				"threadId": threadID, "delta": delta,
			})
		},
	})
	if err != nil {
		if ctx.Err() != nil {
			r.emit("agent:done", map[string]interface{}{"threadId": threadID, "stopped": true})
			return
		}
		if g.waiting {
			return
		}
		r.emit("agent:done", map[string]interface{}{"threadId": threadID, "error": err.Error()})
	}
}

/** trimSkillIDs 去空白 skill id。 */
func trimSkillIDs(in []string) []string {
	if len(in) == 0 {
		return nil
	}
	out := make([]string, 0, len(in))
	seen := map[string]struct{}{}
	for _, id := range in {
		id = strings.TrimSpace(id)
		if id == "" {
			continue
		}
		if _, ok := seen[id]; ok {
			continue
		}
		seen[id] = struct{}{}
		out = append(out, id)
	}
	return out
}

func (r *Runner) getOrCreateThread(id string, ctx model.AgentContextDO, firstMsg string) *threadState {
	if th := r.ensureThread(id); th != nil {
		th.mu.Lock()
		th.context = ctx
		th.mu.Unlock()
		return th
	}
	title := firstMsg
	if utf8.RuneCountInString(title) > 24 {
		title = string([]rune(title)[:24]) + "…"
	}
	_ = r.harness.EnsureSession(id, title)
	_ = r.harness.SetBindings(id, ctx.Mentions, turnctx.FocusRefFromContext(ctx))
	th := &threadState{id: id, title: title, context: ctx}
	r.mu.Lock()
	r.threads[id] = th
	r.mu.Unlock()
	return th
}

func (r *Runner) getThread(id string) *threadState {
	r.mu.Lock()
	defer r.mu.Unlock()
	return r.threads[id]
}

func (r *Runner) ensureThread(id string) *threadState {
	if th := r.getThread(id); th != nil {
		return th
	}
	if r.harness == nil {
		return nil
	}
	info, mentions, _, err := r.harness.GetSession(id)
	if err != nil {
		return nil
	}
	th := &threadState{
		id:      info.ID,
		title:   info.Title,
		context: model.AgentContextDO{Mentions: mentions},
	}
	r.mu.Lock()
	r.threads[id] = th
	r.mu.Unlock()
	return th
}

func (r *Runner) listToolDefs(perms map[string]bool, mode string) []workbenchtools.ToolDef {
	mode = NormalizeChatMode(mode)
	if mode == ChatModeAsk {
		return nil
	}
	defs := r.tools.ListDefsFiltered(perms)
	if r.harness != nil {
		for _, d := range harness.MemoryToolDefs() {
			if perms != nil && !workbenchtools.IsToolEnabled(perms, d.Name) {
				continue
			}
			defs = append(defs, d)
		}
		for _, d := range harness.SkillToolDefs() {
			if perms != nil && !workbenchtools.IsToolEnabled(perms, d.Name) {
				continue
			}
			defs = append(defs, d)
		}
	}
	if mode != ChatModePlan {
		return defs
	}
	out := make([]workbenchtools.ToolDef, 0, len(defs))
	for _, d := range defs {
		if agentcap.RiskOf(d.Name) != agentcap.RiskRead {
			continue
		}
		out = append(out, d)
	}
	return out
}

func toolStatus(toolName string, result workbenchtools.ToolResult) (status, summary string) {
	if result.NeedsConfirm {
		return StatusNeedConfirm, meaningfulSummary(toolName, result)
	}
	if result.OK {
		return StatusOK, meaningfulSummary(toolName, result)
	}
	return StatusError, meaningfulSummary(toolName, result)
}

func (r *Runner) systemPrompt(mode string) string {
	locale, _ := r.store.GetAppSetting(store.SettingLocale)
	langRule := "【语言】对用户可见的全部文字必须使用简体中文（含工具调用之间的说明）；不要用英文自言自语。工具名与代码标识符可保持原文。"
	if locale == "en" {
		langRule = "[Language] All user-visible text must be in English (including brief notes between tool calls)."
	}
	mode = NormalizeChatMode(mode)
	if mode == ChatModeAsk {
		return langRule + `

你是 WWorkbench 内置助手，当前是 Ask 模式。
只讲解、答疑、给思路；禁止调用工具，禁止声称已经执行了操作。
每轮可能带有「本轮工作台现状」前馈（界面焦点、中栏标签、@ 绑定、当前连接、当前笔记 noteId）——先读再答，不要空猜。终端输出不在前馈里，请用户切 Agent 后用 get_shell_output 查看。
笔记正文不在前馈里；若要读全文请用户切到 Agent（get_note）。
用户若要动手：请他切到 Plan（先出方案，自己也能做）或 Agent（执行，变更会确认）。`
	}

	toolRules := `

你是 WWorkbench 内置助手，只能通过提供的工具操作工作台。
规则：
1. 每轮用户消息可能带有「本轮工作台现状」前馈（含界面焦点、中栏标签、@ 绑定、当前连接、当前笔记 noteId）。用户说「这个 / 这张表 / 这个库 / 这个主机 / 这个请求 / 这篇笔记」且没给出新地址时，优先指界面焦点，不要空猜；优先使用其中的 ID，不要编造。用户消息里出现 ssh -p / user@host 时，那是权威地址，优先于 @ 绑定：地址不同就是新机器，save_ssh_host 必须用命令里的 host/port，禁止沿用绑定资产的 host，shell_probe 不要用旧 hostId。问终端输出、报错、是否装好用 get_shell_output 按需分页拉取（offsetFromEnd=0 为最新），不要编造，不要为了看屏幕乱 shell_probe。
2. 用户问「有哪些连接/链接」时，必须同时调用 list_connections（数据库）与 list_ssh_hosts（SSH），分开展示。
3. Shell 合同：人看得见的工作（pip、下载、训练、写脚本、管道）必须 shell_run 注入可见 PTY，本轮不返回 stdout，禁止编造输出；注入后用 get_shell_output 看新输出。shell_probe 只做只读短探针（uptime / free / df / nvidia-smi / pip show / python -c print / ls / cat），另开会话、等结果、默认 30s；装包/下载/训练/跑脚本会被拒绝。看磁盘文件用 cat，不要 sed/awk。用户 PTY 正忙时不要用探针抢同一台的交互。问「跑完了吗」用 get_shell_output，不要为了看屏幕再跑一遍。
4. 容器启停/删除必须用 start_container / stop_container / remove_container（会弹确认），禁止 docker rm/start/stop 走 shell_probe。
5. 查库：database_open 或 open_database_session + execute_sql；默认 readonly=true。
6. 禁止 DROP DATABASE；不要输出或猜测密码。
7. 需要图表时用 echarts 围栏代码块（合法 ECharts option JSON）。
8. 巡检/报告：收集数据后可用 notebook_append_content 存档。当前打开的笔记常是无关草稿，禁止把前馈 noteId 当成默认写入目标；list_notes 按标题定位或新建明确 title，再 appendToNoteId。
8b. 读笔记：正文在工作台库里。list_notes 浏览，search_notes(query) 按标题/正文搜，get_note(noteId) 取全文。用户说「这篇」才用前馈 noteId 去读。禁止 cat 文件路径，禁止用 recall_resource 当笔记（那是工具结果 resource#N）。
9. Docker：远端先 save_docker_context(sshHostId)，再 list_containers；变更用 start/stop/remove_container；日志：新源先 save_log_source，再用 fetch_logs(logSourceId) 或 get_container_logs。
9b. 工作台是资产容器——凡要可复现的配置必须落盘：HTTP→save_http_request + save_http_environment；SSH→save_ssh_host / save_ssh_forward；数据库→save_connection；日志→save_log_source；Docker→save_docker_context。禁止只临时候参数打完就结束；笔记本是报告旁路，主资产在各产品树。
10. 本轮工具返回已在上下文中，直接基于其内容作答；不要为本轮结果调用 recall_resource。跨轮或历史被挤出窗口后，用 recall_resource（resource#N / resource_id）取回全文；可用 search_session / get_task_summary 定位。
11. 技能：用户 / 挂载或消息带 skillIds 时，首轮必须先 get_skill 加载 SKILL.md 与经验；scripts 用 read_file 读 system/skills/<id>/scripts/…，不要臆造流程。编辑技能正文请到「技能」产品线或 create_project_skill / publish_agent_skill。
11b. 需要用户拍板（选库/选操作/可选下一步）时：在回复末尾挂 fenced 代码块，语言标记 agent-choice（或 desk-choice），JSON 示例：
   {"n":1,"mode":"single","prompt":"可选下一步","options":[{"key":"a","label":"列出表"},{"key":"b","label":"查慢查询"}]}
用户点选后会直接发送选项原文；也可手打选项文案。mode 可为 single / multi / text。勿只写 Markdown 列表代替（对方只能手打）。禁止向用户描述工具管道内部细节或自言自语。禁止在回复中复述用户密码。`

	if mode == ChatModePlan {
		return langRule + `

你是 WWorkbench 内置助手，当前是 Plan 模式。
产品目标是让用户自己能做，而不是你代劳。
用只读/探查工具摸清现状，然后给出计划：目标、现状判断、分步（每步人能做或交给 Agent）、风险与需确认的点。
禁止变更：save_*、启停/删容器、写入 SQL、变更类 HTTP、往笔记本落盘。
末尾可用 agent-choice 问用户「切到 Agent 执行」还是「我自己按步骤做」。
` + toolRules + `

【Plan 覆盖】本轮禁止执行变更与资产落盘；只读探查后写计划。`
	}

	return langRule + toolRules
}

func sshEndpointLookup(st *store.Store) func(id string) (user, host string, port int, ok bool) {
	return func(id string) (string, string, int, bool) {
		if st == nil || strings.TrimSpace(id) == "" {
			return "", "", 0, false
		}
		h, err := st.GetSSHHost(id)
		if err != nil || h == nil {
			return "", "", 0, false
		}
		return h.User, h.Host, h.Port, true
	}
}
