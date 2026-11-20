package agent

import (
	"encoding/json"
	"fmt"
	"strings"
	"unicode/utf8"

	"WWorkbench/internal/workbenchtools"
)

// 与 ningharness Gateway 本轮可见上限对齐：本轮工具正文直接进上下文。
const maxToolMsgRunes = 16000

// formatToolMessage 本轮工具结果进模正文（全文优先；仅超长才截断并附 resource 提示）。
func formatToolMessage(result workbenchtools.ToolResult, resourceID int64) string {
	body, err := json.Marshal(result)
	if err != nil {
		body = []byte(`{"ok":false,"error":"marshal tool result"}`)
	}
	text := string(body)
	n := utf8.RuneCountInString(text)
	if n <= maxToolMsgRunes {
		if resourceID > 0 {
			return text + fmt.Sprintf("\n〔resource#%d〕", resourceID)
		}
		return text
	}
	runes := []rune(text)
	head := string(runes[:maxToolMsgRunes])
	if resourceID > 0 {
		return fmt.Sprintf("%s\n…(已截断 %d 字，跨轮全文用 harness recall_resource resource_id=%d)", head, n, resourceID)
	}
	return fmt.Sprintf("%s\n…(已截断 %d 字)", head, n)
}

// meaningfulSummary 落盘/UI 用短摘要（禁止一律 "ok"）。
func meaningfulSummary(toolName string, result workbenchtools.ToolResult) string {
	if result.NeedsConfirm {
		if result.ConfirmSummary != "" {
			return result.ConfirmSummary
		}
		return toolName + " 待确认"
	}
	if result.NeedsChoice {
		if result.ConfirmSummary != "" {
			return result.ConfirmSummary
		}
		return toolName + " 待选择"
	}
	if !result.OK {
		if teachSum, _, _ := peekTeachFields(result.Data); teachSum != "" {
			if result.Error != "" {
				return teachSum + " · " + result.Error
			}
			return teachSum
		}
		if result.Error != "" {
			return result.Error
		}
		return toolName + " 失败"
	}
	if teachSum, next, skill := peekTeachFields(result.Data); teachSum != "" {
		s := teachSum
		if next != "" {
			s += " → " + next
		}
		if skill != "" {
			s += " · 可沉淀 " + skill
		}
		return trimRunes(s, 160)
	}
	n := utf8.RuneCountInString(string(result.Data))
	if n == 0 {
		return toolName + " ok"
	}
	if n <= 80 {
		return toolName + " · " + string(result.Data)
	}
	return fmt.Sprintf("%s · %d字", toolName, n)
}

func peekTeachFields(data json.RawMessage) (summary, firstNext, skillName string) {
	if len(data) == 0 {
		return "", "", ""
	}
	var m map[string]interface{}
	if json.Unmarshal(data, &m) != nil {
		return "", "", ""
	}
	if t, ok := m["teach"].(map[string]interface{}); ok {
		summary, _ = t["summary"].(string)
		if arr, ok := t["nextSteps"].([]interface{}); ok && len(arr) > 0 {
			firstNext, _ = arr[0].(string)
		}
	}
	if sk, ok := m["suggestedSkill"].(map[string]interface{}); ok {
		skillName, _ = sk["name"].(string)
	}
	return strings.TrimSpace(summary), strings.TrimSpace(firstNext), strings.TrimSpace(skillName)
}

func trimRunes(s string, max int) string {
	s = strings.TrimSpace(s)
	if max <= 0 || utf8.RuneCountInString(s) <= max {
		return s
	}
	r := []rune(s)
	return string(r[:max]) + "…"
}

// teachPayloadFromResult 从工具 Data 抽出 teach / suggestedSkill，供侧栏展示。
func teachPayloadFromResult(result workbenchtools.ToolResult) (teach map[string]interface{}, skill map[string]interface{}) {
	if len(result.Data) == 0 {
		return nil, nil
	}
	var m map[string]interface{}
	if json.Unmarshal(result.Data, &m) != nil {
		return nil, nil
	}
	if t, ok := m["teach"].(map[string]interface{}); ok && len(t) > 0 {
		teach = t
	}
	if sk, ok := m["suggestedSkill"].(map[string]interface{}); ok && len(sk) > 0 {
		skill = sk
	}
	return teach, skill
}

func attachTeachToEnd(end map[string]interface{}, result workbenchtools.ToolResult) {
	teach, skill := teachPayloadFromResult(result)
	if teach != nil {
		end["teach"] = teach
	}
	if skill != nil {
		end["suggestedSkill"] = skill
	}
}
