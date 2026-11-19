package workbenchtools

import (
	"context"
	"encoding/json"
	"strings"
	"unicode/utf8"

	"WWorkbench/internal/workbench"
)

const (
	intentMinRunes     = 4
	intentMaxStore     = 40
	intentTitleMaxRune = 72
	errNeedIntent      = "动手操作须填写 intent（人话：要干什么、影响谁）。确认弹窗与舞台回放会展示该声明。"
)

// IntentCard 意图声明卡（可审计；get_workbench_context.intentCards 回放）。
type IntentCard struct {
	At       int64  `json:"at"`
	Tool     string `json:"tool"`
	Intent   string `json:"intent"`
	Risk     string `json:"risk,omitempty"`
	Summary  string `json:"summary,omitempty"`
	Approved *bool  `json:"approved,omitempty"` // nil=仅声明/未拍板；确认后写入
}

// extractIntent 从工具参数读取 intent。
func extractIntent(raw json.RawMessage) string {
	if len(raw) == 0 {
		return ""
	}
	var in struct {
		Intent string `json:"intent"`
	}
	if json.Unmarshal(raw, &in) != nil {
		return ""
	}
	return strings.TrimSpace(in.Intent)
}

// validateIntent 校验意图声明质量；返回空表示通过（调用方缺省时改合成，不拒绝）。
func validateIntent(intent string) string {
	intent = strings.TrimSpace(intent)
	if intent == "" {
		return errNeedIntent
	}
	if utf8.RuneCountInString(intent) < intentMinRunes {
		return "intent 过短，请用一句话说明目的与影响面（至少 4 字）"
	}
	low := strings.ToLower(intent)
	for _, bad := range []string{"test", "asdf", "xxx", "todo", "intent", "测试", "试试", "1234", "...."} {
		if low == bad {
			return "请填写真实意图，不要用占位词"
		}
	}
	return ""
}

// synthesizeIntent 缺省 intent 时从参数合成可见摘要（前馈，不阻断）。
func synthesizeIntent(name string, args json.RawMessage) string {
	var m map[string]interface{}
	_ = json.Unmarshal(args, &m)
	pick := func(keys ...string) string {
		for _, k := range keys {
			if v, ok := m[k]; ok {
				s := strings.TrimSpace(fmtString(v))
				if s != "" {
					return truncateRunes(s, 48)
				}
			}
		}
		return ""
	}
	if s := pick("initialCommand", "command", "sql", "url", "path", "title", "summary"); s != "" {
		return "未声明意图 · " + s
	}
	if name == "" {
		return "未声明意图"
	}
	return "未声明意图 · " + name
}

// injectIntentArg 把合成/规范化后的 intent 写回参数 JSON（供确认预览与下游）。
func injectIntentArg(raw json.RawMessage, intent string) json.RawMessage {
	intent = strings.TrimSpace(intent)
	if intent == "" {
		return raw
	}
	var m map[string]interface{}
	if len(raw) == 0 || json.Unmarshal(raw, &m) != nil || m == nil {
		m = map[string]interface{}{}
	}
	m["intent"] = intent
	b, err := json.Marshal(m)
	if err != nil {
		return raw
	}
	return b
}

// requiresIntent 是否必须带意图声明（只读 SQL / 空命令开终端除外）。
func requiresIntent(name string, args json.RawMessage) bool {
	if !requiresAgentRulesAck(name) {
		return false
	}
	switch name {
	case workbench.CapShellRun:
		var in openTerminalArgs
		_ = json.Unmarshal(args, &in)
		return strings.TrimSpace(in.InitialCommand) != ""
	case workbench.CapExecuteSQL:
		var in executeSQLArgs
		_ = json.Unmarshal(args, &in)
		kind := ClassifySQL(strings.TrimSpace(in.SQL))
		if kind == SQLWrite || kind == SQLBlocked {
			return true
		}
		if in.Readonly != nil && !*in.Readonly {
			return true
		}
		return false
	case "execute_http":
		var in struct {
			Method string `json:"method"`
		}
		_ = json.Unmarshal(args, &in)
		m := strings.ToUpper(strings.TrimSpace(in.Method))
		if m == "" || m == "GET" || m == "HEAD" {
			return false
		}
		return true
	case workbench.CapBrowserAttach, workbench.CapBrowserFind, workbench.CapBrowserWait,
		workbench.CapBrowserStatus, workbench.CapBrowserListTabs, workbench.CapBrowserSnapshot,
		workbench.CapBrowserScreenshot, workbench.CapBrowserOpen:
		return false // 只读/定位，可不填 intent
	case workbench.CapPinDirVersion, workbench.CapPinSkillVersion, workbench.CapEnableDirVersion:
		return false // 启用/创建版本不改正稿内容；message 可选
	case workbench.CapBrowserClick, workbench.CapBrowserFill, workbench.CapBrowserNavigate,
		workbench.CapBrowserKeys, workbench.CapBrowserOpenFrame, workbench.CapRunSkill:
		return true
	default:
		return true
	}
}

// intentProp Schema 片段：意图声明字段。
func intentProp() map[string]interface{} {
	return map[string]interface{}{
		"type":        "string",
		"description": "意图声明（动手建议填写）：人话说明要干什么、影响谁。缺省时系统合成「未声明意图」卡片，不阻断。",
	}
}

// executorProp Schema 片段：浏览器执行器（wwb 扩展 / kimi / agent-browser）。
func executorProp() map[string]interface{} {
	return map[string]interface{}{
		"type":        "string",
		"description": "执行器 wwb|kimi|agent-browser|auto；auto/默认：wwb → kimi → agent-browser 取第一个可用。agent-browser 是独立浏览器（免装扩展、登录态独立）。同一任务固定一个执行器。禁止直连插件端口。",
	}
}

// enrichConfirmWithIntent 确认预览植入意图，标题优先用人话意图。
func enrichConfirmWithIntent(ctx context.Context, toolName string, args json.RawMessage, res ToolResult) ToolResult {
	intent := extractIntent(args)
	if intent == "" || !res.NeedsConfirm {
		return res
	}
	preview := map[string]interface{}{}
	if len(res.Data) > 0 {
		_ = json.Unmarshal(res.Data, &preview)
	}
	preview["intent"] = intent
	if risk, _ := preview["risk"].(string); risk != "" {
		// keep
	}
	raw, err := json.Marshal(preview)
	if err == nil {
		res.Data = raw
	}
	res.ConfirmSummary = truncateRunes(intent, intentTitleMaxRune)
	RecordIntentCard(ctx, IntentCard{
		Tool:    toolName,
		Intent:  intent,
		Risk:    stringFromPreview(preview, "risk"),
		Summary: res.ConfirmSummary,
	})
	return res
}

func stringFromPreview(preview map[string]interface{}, key string) string {
	if preview == nil {
		return ""
	}
	if v, ok := preview[key]; ok && v != nil {
		return strings.TrimSpace(fmtString(v))
	}
	return ""
}

func fmtString(v interface{}) string {
	switch t := v.(type) {
	case string:
		return t
	default:
		b, _ := json.Marshal(t)
		return string(b)
	}
}

// RecordIntentCard 写入当前调用方的舞台回放环（最新在前）。
func RecordIntentCard(ctx context.Context, c IntentCard) {
	stateOf(ctx).recordIntent(c)
}

// MarkLatestIntentApproved 将最近一张同 tool+intent 的卡片标为通过/拒绝。
func MarkLatestIntentApproved(ctx context.Context, toolName, intent string, approved bool) {
	stateOf(ctx).markIntentApproved(toolName, intent, approved)
}

// ListIntentCards 当前调用方回放用副本。
func ListIntentCards(ctx context.Context, limit int) []IntentCard {
	return stateOf(ctx).listIntents(limit)
}

func truncateRunes(s string, max int) string {
	if max <= 0 || utf8.RuneCountInString(s) <= max {
		return s
	}
	runes := []rune(s)
	return string(runes[:max]) + "…"
}
