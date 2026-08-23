package harness

import (
	"context"
	"encoding/json"
	"fmt"
	"strings"

	"WWorkbench/internal/workbenchtools"

	"github.com/wcoreing/ningharness/history"
	"github.com/wcoreing/ningharness/toolgateway"
)

// 工作台 Agent 需要的 ningharness 记忆/召回工具（不暴露 AgentDesk 文件/队列全家桶）。
var memoryToolSet = map[string]struct{}{
	"recall_resource":  {},
	"search_session":   {},
	"get_task_summary": {},
}

// IsMemoryTool 是否为 harness 核侧记忆工具。
func IsMemoryTool(name string) bool {
	_, ok := memoryToolSet[strings.TrimSpace(name)]
	return ok
}

// SkillToolDefs 供 LLM 的 ningharness Skill 工具定义。
func SkillToolDefs() []workbenchtools.ToolDef {
	return []workbenchtools.ToolDef{
		{
			Name:        "list_skills",
			Description: "列出项目 system/skills/*/SKILL.md（id / name / description / hasLessons）。/ 菜单或选技能前可先调本工具。",
			Parameters:  map[string]interface{}{"type": "object", "properties": map[string]interface{}{}},
		},
		{
			Name:        "get_skill",
			Description: "读取某 skill 的 SKILL.md 正文，并附 lesson_entry 经验。用户 / 挂载或你要按技能流程执行时，首轮必须先调本工具；scripts 用 read_file 读 system/skills/<id>/scripts/…。",
			Parameters: map[string]interface{}{
				"type": "object",
				"required": []string{"skill"},
				"properties": map[string]interface{}{
					"skill": map[string]interface{}{"type": "string", "description": "skill id 或 frontmatter name"},
				},
			},
		},
		{
			Name:        "read_file",
			Description: "读取项目内文本（相对 ningharness 根）。读 skill 脚本示例 {\"rel_path\":\"system/skills/<id>/scripts/probe.sh\"}。",
			Parameters: map[string]interface{}{
				"type": "object",
				"required": []string{"rel_path"},
				"properties": map[string]interface{}{
					"rel_path": map[string]interface{}{"type": "string", "description": "相对项目根路径"},
				},
			},
		},
	}
}

// MemoryToolDefs 供 LLM 的 harness 记忆工具定义。
func MemoryToolDefs() []workbenchtools.ToolDef {
	return []workbenchtools.ToolDef{
		{
			Name:        "recall_resource",
			Description: "跨轮召回外置资源全文（工具结果等）。本轮刚返回的结果已在上下文中，勿对本轮结果调用。优先 resource_id（摘要里 resource#N）；也可 tool_call_id / query。",
			Parameters: map[string]interface{}{
				"type": "object",
				"properties": map[string]interface{}{
					"resource_id":  map[string]interface{}{"type": "number", "description": "resource 数字 id"},
					"tool_call_id": map[string]interface{}{"type": "string", "description": "工具 call id"},
					"query":        map[string]interface{}{"type": "string", "description": "关键词（搜 summary/body）"},
					"phase":        map[string]interface{}{"type": "string", "description": "call | result | diff，可空"},
					"kind":         map[string]interface{}{"type": "string", "description": "tool_call | tool_result | diff，可空"},
					"limit":        map[string]interface{}{"type": "number", "description": "列表命中数，默认 12"},
				},
			},
		},
		{
			Name:        "search_session",
			Description: "按关键词检索历史对话；查「上次说过什么」。工具返回全文用 recall_resource。",
			Parameters: map[string]interface{}{
				"type":     "object",
				"required": []string{"query"},
				"properties": map[string]interface{}{
					"query":      map[string]interface{}{"type": "string", "description": "关键词"},
					"limit":      map[string]interface{}{"type": "number", "description": "最多命中条数，默认 12"},
					"session_id": map[string]interface{}{"type": "string", "description": "限定会话 id，空=全部"},
				},
			},
		},
		{
			Name:        "get_task_summary",
			Description: "单轮执行台账短摘要（不含工具全文）；task_id 空=最近用户轮。全文用 recall_resource。",
			Parameters: map[string]interface{}{
				"type": "object",
				"properties": map[string]interface{}{
					"task_id": map[string]interface{}{"type": "string", "description": "任务 id，空=最近一轮"},
				},
			},
		},
	}
}

type confirmWire struct {
	WWConfirm bool            `json:"ww_confirm"`
	Summary   string          `json:"summary"`
	Preview   json.RawMessage `json:"preview"`
}

type choiceWire struct {
	WWChoice bool            `json:"ww_choice"`
	Summary  string          `json:"summary"`
	Preview  json.RawMessage `json:"preview"`
}

// CallTool 经 Gateway 执行任意已注册工具（产品 + 核）。
func (h *Host) CallTool(ctx context.Context, name string, args json.RawMessage) workbenchtools.ToolResult {
	if h == nil {
		return workbenchtools.Fail("harness 未打开")
	}
	gw := h.Gateway()
	if gw == nil {
		return workbenchtools.Fail("harness gateway 不可用")
	}
	name = strings.TrimSpace(name)
	if name == "" {
		return workbenchtools.Fail("工具名为空")
	}
	var m map[string]any
	if len(args) > 0 {
		if err := json.Unmarshal(args, &m); err != nil {
			return workbenchtools.Fail("参数无效: " + err.Error())
		}
	}
	if m == nil {
		m = map[string]any{}
	}
	res, err := gw.CallNamedTool(ctx, name, m)
	if err != nil {
		return workbenchtools.Fail(err.Error())
	}
	text := toolgateway.FormatToolResult(res)
	if res != nil && res.IsError {
		msg := strings.TrimSpace(strings.TrimPrefix(text, "error:"))
		if msg == "" {
			msg = "tool error"
		}
		return workbenchtools.Fail(msg)
	}
	if strings.HasPrefix(strings.ToLower(strings.TrimSpace(text)), "error:") {
		return workbenchtools.Fail(strings.TrimSpace(strings.TrimPrefix(text, "error:")))
	}
	var wire confirmWire
	if json.Unmarshal([]byte(text), &wire) == nil && wire.WWConfirm {
		return workbenchtools.Confirm("", wire.Summary, json.RawMessage(wire.Preview))
	}
	var choice choiceWire
	if json.Unmarshal([]byte(text), &choice) == nil && choice.WWChoice {
		return workbenchtools.Choice(choice.Summary, json.RawMessage(choice.Preview))
	}
	return workbenchtools.OKData(text)
}

// InvokeTool 兼容旧名：记忆工具或任意 Gateway 工具。
func (h *Host) InvokeTool(ctx context.Context, name string, args json.RawMessage) workbenchtools.ToolResult {
	return h.CallTool(ctx, name, args)
}

// RewindHistory 按 seq 截断 ningharness history。
func (h *Host) RewindHistory(sessionKey string, keepSeq int) error {
	if h == nil || h.Root == "" {
		return fmt.Errorf("harness: not open")
	}
	if keepSeq < 0 {
		keepSeq = 0
	}
	if keepSeq == 0 {
		return history.ClearSession(h.Root, sessionKey)
	}
	return rewindBySeq(h.Root, sessionKey, keepSeq)
}
