package browser

import (
	"encoding/json"
	"fmt"
	"strings"
	"time"
)

// KimiCapabilities Kimi WebBridge 常见能力（扩展版本不同可能缺 wait）。
var KimiCapabilities = []string{
	"snapshot", "click", "fill", "find", "navigate", "find_tab", "list_tabs",
	"screenshot", "evaluate", "read_page", "upload", "network", "send_keys",
	"mouse_click", "close_tab", "close_session", "attach_tab", "cdp",
}

// WWBCapabilities 自有扩展能力。
var WWBCapabilities = []string{
	"snapshot", "ax_snapshot", "click", "fill", "find", "wait", "pointer", "keys", "send_keys",
	"mouse_click", "screenshot", "iframe", "open_frame", "find_tab", "run",
	"evaluate", "read_page", "upload", "network", "shadow_dom", "closed_shadow",
	"select", "select_option", "drag", "ref_retry", "session", "tab_group",
	"close_session", "workflow", "popup", "record",
}

// NormalizeArgsForKimi 把 WWB MCP 入参转成 Kimi /command 习惯。
func NormalizeArgsForKimi(action string, args json.RawMessage) (json.RawMessage, error) {
	action = strings.TrimSpace(action)
	if len(args) == 0 || string(args) == "null" {
		args = json.RawMessage(`{}`)
	}
	var m map[string]interface{}
	if err := json.Unmarshal(args, &m); err != nil {
		return args, nil
	}
	if m == nil {
		m = map[string]interface{}{}
	}

	// click/fill/keys：ref=@eN 时同步 selector，避免「selector is required」
	ref, _ := m["ref"].(string)
	sel, _ := m["selector"].(string)
	ref = strings.TrimSpace(ref)
	sel = strings.TrimSpace(sel)
	if ref != "" && sel == "" && strings.HasPrefix(ref, "@e") {
		m["selector"] = ref
	}
	if sel != "" && ref == "" && strings.HasPrefix(sel, "@e") {
		m["ref"] = sel
	}

	switch action {
	case "wait":
		// WWB: textGone/timeoutMs/nameIncludes/readyState → Kimi: text_gone/timeout_ms
		if v, ok := m["textGone"]; ok {
			if _, has := m["text_gone"]; !has {
				m["text_gone"] = v
			}
			delete(m, "textGone")
		}
		if v, ok := m["timeoutMs"]; ok {
			if _, has := m["timeout_ms"]; !has {
				m["timeout_ms"] = v
			}
			delete(m, "timeoutMs")
		}
		// nameIncludes / readyState：Kimi 旧扩展可能不支持，保留原字段；polyfill 会兜底
	case "keys", "send_keys":
		// 统一 action 名由调用方处理；此处只保证 keys 字段存在
		if _, ok := m["keys"]; !ok {
			if k, ok := m["key"].(string); ok {
				m["keys"] = k
			}
		}
	case "snapshot":
		// 默认要 aria，便于产出 tree_text
		if _, ok := m["format"]; !ok {
			m["format"] = "aria"
		}
		if v, ok := m["maxChars"]; ok {
			if _, has := m["max_chars"]; !has {
				m["max_chars"] = v
			}
		}
		if v, ok := m["maxNodes"]; ok {
			if _, has := m["max_nodes"]; !has {
				m["max_nodes"] = v
			}
		}
	}
	return json.Marshal(m)
}

// NormalizeResultFromKimi 统一出参：截图 path、快照 tree_text。
func NormalizeResultFromKimi(action string, data json.RawMessage) json.RawMessage {
	if len(data) == 0 || string(data) == "null" {
		return json.RawMessage(`{}`)
	}
	var m map[string]interface{}
	if err := json.Unmarshal(data, &m); err != nil || m == nil {
		return data
	}
	changed := false

	switch strings.TrimSpace(action) {
	case "screenshot":
		// Kimi 直接返回 path；WWB 工具以前只认 dataUrl
		if path, _ := m["path"].(string); strings.TrimSpace(path) != "" {
			if _, ok := m["dataUrl"]; !ok {
				// 保留 path，供上层直接使用；加标记避免再走 base64 落盘
				m["source"] = "kimi-path"
				changed = true
			}
		}
		if note, _ := m["note"].(string); note == "" {
			m["note"] = "用系统看图打开 path 核对页面；不要把整张图 base64 回灌对话"
			changed = true
		}
	case "snapshot":
		if _, has := m["tree_text"]; !has {
			if flat := flattenKimiTree(m["tree"]); flat != "" {
				m["tree_text"] = flat
				m["format"] = "aria"
				changed = true
			} else if t, ok := m["tree"].(string); ok && strings.TrimSpace(t) != "" {
				m["tree_text"] = t
				m["format"] = "aria"
				changed = true
			}
		}
	case "wait":
		// 统一 timedOut 字段
		if _, ok := m["timedOut"]; !ok {
			if v, ok := m["timed_out"]; ok {
				m["timedOut"] = v
				changed = true
			}
		}
	}

	if !changed {
		return data
	}
	out, err := json.Marshal(m)
	if err != nil {
		return data
	}
	return out
}

func flattenKimiTree(v interface{}) string {
	var lines []string
	var walk func(interface{})
	walk = func(n interface{}) {
		switch t := n.(type) {
		case map[string]interface{}:
			ref, _ := t["ref"].(string)
			role, _ := t["role"].(string)
			name, _ := t["name"].(string)
			if strings.TrimSpace(ref) != "" {
				line := strings.TrimSpace(ref)
				if role != "" {
					line += " " + role
				}
				if name != "" {
					line += " " + strconvQuote(name)
				}
				lines = append(lines, line)
			}
			if kids, ok := t["children"]; ok {
				walk(kids)
			}
			// 部分返回把子节点直接铺在数组值里
			for k, child := range t {
				if k == "children" || k == "ref" || k == "role" || k == "name" {
					continue
				}
				switch child.(type) {
				case map[string]interface{}, []interface{}:
					walk(child)
				}
			}
		case []interface{}:
			for _, item := range t {
				walk(item)
			}
		}
	}
	walk(v)
	if len(lines) == 0 {
		return ""
	}
	// 去重保序
	seen := map[string]struct{}{}
	out := make([]string, 0, len(lines))
	for _, ln := range lines {
		if _, ok := seen[ln]; ok {
			continue
		}
		seen[ln] = struct{}{}
		out = append(out, ln)
	}
	return strings.Join(out, "\n")
}

func strconvQuote(s string) string {
	b, _ := json.Marshal(s)
	return string(b)
}

// IsKimiUnknownTool 判断是否「扩展不支持该 action」。
func IsKimiUnknownTool(err error) bool {
	if err == nil {
		return false
	}
	msg := strings.ToLower(err.Error())
	return strings.Contains(msg, "unknown tool") || strings.Contains(msg, "please update the kimi")
}

// WaitPolyfillTimeout 从 wait 参数解析超时。
func WaitPolyfillTimeout(args json.RawMessage) time.Duration {
	var m map[string]interface{}
	_ = json.Unmarshal(args, &m)
	ms := 8000.0
	for _, k := range []string{"timeout_ms", "timeoutMs"} {
		switch v := m[k].(type) {
		case float64:
			ms = v
		case int:
			ms = float64(v)
		case json.Number:
			if f, err := v.Float64(); err == nil {
				ms = f
			}
		}
	}
	if ms < 500 {
		ms = 500
	}
	if ms > 40000 {
		ms = 40000
	}
	return time.Duration(ms) * time.Millisecond
}

// WaitConditionMatched 用 snapshot/evaluate 粗匹配 wait 条件（Kimi 无 wait 时兜底）。
func WaitConditionMatched(args json.RawMessage, snapshotText string) bool {
	var m map[string]interface{}
	_ = json.Unmarshal(args, &m)
	text := strings.ToLower(snapshotText)
	if want, _ := m["text"].(string); strings.TrimSpace(want) != "" {
		if strings.Contains(text, strings.ToLower(want)) {
			return true
		}
	}
	if gone, _ := m["text_gone"].(string); strings.TrimSpace(gone) != "" {
		if !strings.Contains(text, strings.ToLower(gone)) {
			return true
		}
	}
	if gone, _ := m["textGone"].(string); strings.TrimSpace(gone) != "" {
		if !strings.Contains(text, strings.ToLower(gone)) {
			return true
		}
	}
	if name, _ := m["nameIncludes"].(string); strings.TrimSpace(name) != "" {
		if strings.Contains(text, strings.ToLower(name)) {
			return true
		}
	}
	if ref, _ := m["ref"].(string); strings.TrimSpace(ref) != "" {
		if strings.Contains(snapshotText, strings.TrimSpace(ref)) {
			return true
		}
	}
	if sel, _ := m["selector"].(string); strings.TrimSpace(sel) != "" {
		if strings.Contains(text, strings.ToLower(sel)) {
			return true
		}
	}
	return false
}

// FormatWaitPolyfillResult 构造与 WWB wait 接近的返回。
func FormatWaitPolyfillResult(matched bool, waitedMs int64, observation map[string]interface{}) json.RawMessage {
	out := map[string]interface{}{
		"matched":  matched,
		"timedOut": !matched,
		"waitedMs": waitedMs,
	}
	if observation != nil {
		out["observation"] = observation
	}
	raw, _ := json.Marshal(out)
	return raw
}

// SnapshotTextFromResult 从 snapshot 结果提取可匹配正文。
func SnapshotTextFromResult(data json.RawMessage) string {
	var m map[string]interface{}
	if json.Unmarshal(data, &m) != nil {
		return string(data)
	}
	if t, ok := m["tree_text"].(string); ok && t != "" {
		return t
	}
	if flat := flattenKimiTree(m["tree"]); flat != "" {
		return flat
	}
	return fmt.Sprintf("%v", m)
}
