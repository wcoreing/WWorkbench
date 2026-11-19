package workbenchtools

import (
	"context"
	"encoding/json"
	"strings"

	"WWorkbench/internal/workbench"
)

// Teach 教人信封：失败/成功都可带，Agent 必须转述给人。
type Teach struct {
	Summary    string   `json:"summary"`
	NextSteps  []string `json:"nextSteps,omitempty"`
	Highlights []string `json:"highlights,omitempty"`
	Raw        string   `json:"raw,omitempty"`
}

// SuggestedSkill 技能沉淀建议；AskHuman=true 时禁止未确认就 update_skill。
type SuggestedSkill struct {
	Name        string `json:"name"`
	Lessons     string `json:"lessons"`
	AskHuman    bool   `json:"askHuman"`
	OfferPrompt string `json:"offerPrompt"`
	Domain      string `json:"domain,omitempty"`
}

// FailTeach 失败结果并附带教人下一步。
func FailTeach(msg string, teach Teach) ToolResult {
	b, _ := json.Marshal(map[string]interface{}{
		"ok": false, "error": msg, "teach": teach,
	})
	return ToolResult{OK: false, Error: msg, Data: b}
}

// TeachMap / SkillMap 供仍拼 map 的调用方使用。
func TeachMap(t Teach) map[string]interface{} {
	m := map[string]interface{}{"summary": t.Summary}
	if len(t.NextSteps) > 0 {
		m["nextSteps"] = t.NextSteps
	}
	if len(t.Highlights) > 0 {
		m["highlights"] = t.Highlights
	}
	if strings.TrimSpace(t.Raw) != "" {
		m["raw"] = t.Raw
	}
	return m
}

func SkillMap(s SuggestedSkill) map[string]interface{} {
	return map[string]interface{}{
		"name": s.Name, "lessons": s.Lessons, "askHuman": s.AskHuman,
		"offerPrompt": s.OfferPrompt, "domain": s.Domain,
	}
}

// NewSuggestedSkill 默认 askHuman=true 的沉淀建议。
func NewSuggestedSkill(domain, name, lessons, offerPrompt string) SuggestedSkill {
	return SuggestedSkill{
		Name: name, Lessons: lessons, AskHuman: true,
		OfferPrompt: offerPrompt, Domain: domain,
	}
}

// AttachTeachEnvelope 在工具终态结果上补齐 teach / suggestedSkill（已有则不覆盖）。
// 挂在 Registry.Invoke：所有动手路径统一「教人 + 人审沉淀」契约。
func AttachTeachEnvelope(ctx context.Context, tool string, args json.RawMessage, res ToolResult) ToolResult {
	if res.NeedsConfirm || res.NeedsChoice {
		return res
	}
	if !res.OK {
		return ensureFailTeach(tool, res)
	}
	return ensureOKTeach(ctx, tool, args, res)
}

func ensureFailTeach(tool string, res ToolResult) ToolResult {
	if hasTeach(res.Data) {
		return res
	}
	teach := TeachFromError(tool, res.Error)
	return mergeEnvelope(res, &teach, nil)
}

func ensureOKTeach(ctx context.Context, tool string, args json.RawMessage, res ToolResult) ToolResult {
	var teach *Teach
	var skill *SuggestedSkill
	bound := strings.TrimSpace(CallerSkillAssets(ctx)) != ""

	if bound && isHandsOnTool(tool) && !hasTeach(res.Data) {
		t := Teach{
			Summary: "本步已完成",
			NextSteps: []string{
				"目标跑通后用 update_skill 把经验写回当前 Skill（人已挂载）",
				"禁止机械把 log 逐步贴进 Skill，先归纳再落盘",
			},
		}
		teach = &t
	}

	if !hasSuggestedSkill(res.Data) {
		if s, ok := milestoneSuggestedSkill(tool, args, res); ok {
			skill = &s
		} else if bound && isHandsOnTool(tool) {
			// 已挂 Skill：不新建路径，只靠 teach 提醒收口
		}
	}

	if teach == nil && skill == nil {
		return res
	}
	return mergeEnvelope(res, teach, skill)
}

func milestoneSuggestedSkill(tool string, args json.RawMessage, res ToolResult) (SuggestedSkill, bool) {
	intent := strings.TrimSpace(extractIntent(args))
	switch tool {
	case workbench.CapBrowserRun:
		lessons := "网页宏已跑通。收口时把稳定 browser_run(mode=macro) 写成 Skill 一步；探索期单步不要整段贴进 Skill。"
		if intent != "" {
			lessons = intent + "。\n" + lessons
		}
		return NewSuggestedSkill(
			"browser",
			"工作流/网页宏",
			lessons,
			"这段网页宏已经跑通。要沉淀成 Skill，下次直接复用吗？",
		), true
	case workbench.CapRunBackup:
		return NewSuggestedSkill(
			"backup",
			"运维/备份策略",
			"备份已用 run_backup 无头执行。策略用 save_backup_policy；发现资产用 host_health_scan → ensure_host_backup_policies。",
			"要把这次备份做法写进运维 Skill 吗？",
		), true
	case workbench.CapDesktopAct:
		// 单步点击噪声大；仅在 intent 像「收口/发送/完成」时建议
		if !looksLikeGoalClose(intent) {
			return SuggestedSkill{}, false
		}
		lessons := "桌面操作已完成关键一步。桌面 Skill 用 desktop_*；截图点选须带 windowId。发送类先 offer_choices。"
		if intent != "" {
			lessons = intent + "。\n" + lessons
		}
		return NewSuggestedSkill(
			"desktop",
			"工作流/桌面操作",
			lessons,
			"关键桌面步骤已完成。要归纳进 Skill 吗？（人审后 update_skill）",
		), true
	case workbench.CapSyncSSHSecurityGroup, workbench.CapConfigureSSHSGSync:
		// 云工具自身已带 suggestedSkill
		return SuggestedSkill{}, false
	default:
		_ = res
		return SuggestedSkill{}, false
	}
}

func looksLikeGoalClose(intent string) bool {
	intent = strings.ToLower(strings.TrimSpace(intent))
	if intent == "" {
		return false
	}
	keys := []string{"完成", "发送", "提交", "收口", "发给", "发布", "保存并", "搞定", "done", "send", "submit"}
	for _, k := range keys {
		if strings.Contains(intent, k) {
			return true
		}
	}
	return false
}

func isHandsOnTool(tool string) bool {
	switch tool {
	case workbench.CapDesktopAct, workbench.CapDesktopLaunch,
		workbench.CapBrowserClick, workbench.CapBrowserFill, workbench.CapBrowserKeys,
		workbench.CapBrowserNavigate, workbench.CapBrowserRun, workbench.CapBrowserUpload,
		workbench.CapBrowserSelectOption, workbench.CapBrowserDrag,
		workbench.CapShellRun, workbench.CapRunBackup,
		workbench.CapSyncSSHSecurityGroup, workbench.CapConfigureSSHSGSync,
		workbench.CapExecuteSQL, "execute_http",
		"start_container", "stop_container", "remove_container":
		return true
	default:
		return strings.HasPrefix(tool, "browser_") || strings.HasPrefix(tool, "desktop_")
	}
}

// TeachFromError 按工具域把错误翻成可执行下一步。
func TeachFromError(tool, errMsg string) Teach {
	errMsg = strings.TrimSpace(errMsg)
	low := strings.ToLower(errMsg)
	teach := Teach{
		Summary:   "操作失败",
		NextSteps: []string{"把错误原话转述给人，并给出可执行的下一步", "不要静默重试刷权限或重复弹授权"},
		Raw:       errMsg,
	}
	switch {
	case strings.Contains(errMsg, "已在 AI 权限设置中关闭"):
		teach.Summary = "该能力在设置里被关掉了"
		teach.NextSteps = []string{"打开设置 → AI 能力权限，打开对应开关", "说明为何需要该能力，等人打开后再继续"}
	case strings.Contains(errMsg, "用户已在工作台拒绝") || strings.Contains(errMsg, "用户拒绝"):
		teach.Summary = "人拒绝了这次操作"
		teach.NextSteps = []string{"尊重拒绝，改方案或问清顾虑", "不要立刻用同一参数再弹确认"}
	case strings.Contains(errMsg, "授权") || strings.Contains(low, "grant"):
		teach.Summary = "还缺应用/目录授权"
		teach.NextSteps = []string{"说明要读/操作哪个应用或目录", "等人在弹窗里授权；被拒后换思路"}
	case strings.HasPrefix(tool, "desktop_") || tool == workbench.CapDesktopAct:
		teach.Summary = "桌面操作失败"
		teach.NextSteps = []string{
			"无障碍树空时改用 desktop_screenshot + 图上坐标（带 windowId）",
			"确认应用已获「操作」授权；微信等多窗须带正确 windowId",
		}
	case strings.HasPrefix(tool, "browser_") || tool == workbench.CapBrowserRun:
		teach.Summary = "浏览器步骤失败"
		teach.NextSteps = []string{
			"重新 browser_snapshot / find 再点，勿复用过期 ref",
			"同域 iframe 用 frame=#fN；写操作需人确认",
		}
	case tool == workbench.CapShellRun || tool == workbench.CapShellProbe:
		teach.Summary = "Shell 执行失败"
		teach.NextSteps = []string{
			"断线先 terminal_reconnect",
			"改机器用 shell_run（可见），只读短探针才用 shell_probe",
		}
	case tool == workbench.CapSyncSSHSecurityGroup || tool == workbench.CapConfigureSSHSGSync || tool == workbench.CapGetECSMonitor:
		teach.Summary = "云运维失败"
		teach.NextSteps = []string{
			"核对主机是否绑了 ECS；改安全组需要 Authorize/Revoke 权限",
			"详见 get_agent_rules(domain=cloud)",
		}
	case strings.Contains(low, "timeout") || strings.Contains(errMsg, "超时"):
		teach.Summary = "等待超时"
		teach.NextSteps = []string{"加大 wait / waitMs", "先确认页面或进程是否已到预期状态"}
	case errMsg != "":
		teach.Summary = "操作失败：" + truncateRunes(errMsg, 80)
	}
	_ = tool
	return teach
}

func hasTeach(data json.RawMessage) bool {
	return jsonHasKey(data, "teach")
}

func hasSuggestedSkill(data json.RawMessage) bool {
	return jsonHasKey(data, "suggestedSkill")
}

func jsonHasKey(data json.RawMessage, key string) bool {
	if len(data) == 0 {
		return false
	}
	var m map[string]json.RawMessage
	if json.Unmarshal(data, &m) != nil {
		return false
	}
	_, ok := m[key]
	return ok
}

func mergeEnvelope(res ToolResult, teach *Teach, skill *SuggestedSkill) ToolResult {
	m := map[string]interface{}{}
	if len(res.Data) > 0 {
		_ = json.Unmarshal(res.Data, &m)
	}
	if m == nil {
		m = map[string]interface{}{}
	}
	if !res.OK {
		m["ok"] = false
		if res.Error != "" {
			m["error"] = res.Error
		}
	} else if _, ok := m["ok"]; !ok {
		m["ok"] = true
	}
	if teach != nil {
		if _, exists := m["teach"]; !exists {
			m["teach"] = *teach
		}
	}
	if skill != nil {
		if _, exists := m["suggestedSkill"]; !exists {
			m["suggestedSkill"] = *skill
			m["note"] = "沉淀须人点头：offer_choices → update_skill。禁止未问人就落盘。"
		}
	}
	b, _ := json.Marshal(m)
	res.Data = b
	return res
}

// SafeSkillPathSegment 用于 Skill 目录名，去掉路径分隔符。
func SafeSkillPathSegment(name string) string {
	name = strings.TrimSpace(name)
	if name == "" {
		return "未命名"
	}
	repl := strings.NewReplacer("/", "-", "\\", "-", ":", "-", "\n", " ")
	return repl.Replace(name)
}
