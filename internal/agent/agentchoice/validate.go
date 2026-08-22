package agentchoice

import (
	"encoding/json"
	"fmt"
	"strings"
	"github.com/wcoreing/ningharness/jsonparse"
)

// ValidationError agent-choice 校验失败（JSON 或 WW 业务 schema）。
type ValidationError struct {
	BlockIndex int
	Phase      string // json | schema
	Err        error
	Snippet    string
}

func (e *ValidationError) Error() string {
	if e == nil || e.Err == nil {
		return "agent-choice: invalid"
	}
	idx := e.BlockIndex + 1
	switch e.Phase {
	case "json":
		return fmt.Sprintf("agent-choice 块 #%d JSON 无法解析: %v", idx, e.Err)
	default:
		return fmt.Sprintf("agent-choice 块 #%d 结构无效: %v", idx, e.Err)
	}
}

func (e *ValidationError) Unwrap() error { return e.Err }

// ValidateContent 校验助手正文里 agent-choice / desk-choice 围栏；无围栏则通过。
func ValidateContent(content string) error {
	blocks := ExtractBlocks(content)
	for i, b := range blocks {
		raw, err := jsonparse.Parse(b.Inner)
		if err != nil {
			return &ValidationError{
				BlockIndex: i,
				Phase:      "json",
				Err:        err,
				Snippet:    tailSnippet(b.Inner, 120),
			}
		}
		if err := validateDoc(raw); err != nil {
			return &ValidationError{BlockIndex: i, Phase: "schema", Err: err}
		}
	}
	return nil
}

func validateDoc(raw json.RawMessage) error {
	var top map[string]any
	if err := json.Unmarshal(raw, &top); err != nil {
		return err
	}
	if top == nil {
		return fmt.Errorf("根节点必须是 JSON 对象")
	}
	if qs, ok := top["questions"]; ok {
		arr, ok := qs.([]any)
		if !ok || len(arr) == 0 {
			return fmt.Errorf("questions 必须是非空数组")
		}
		for i, item := range arr {
			if err := validateQuestion(item, i+1); err != nil {
				return err
			}
		}
		return nil
	}
	return validateQuestion(top, 1)
}

func validateQuestion(raw any, fallbackN int) error {
	m, ok := raw.(map[string]any)
	if !ok {
		return fmt.Errorf("题目 #%d 必须是对象", fallbackN)
	}
	prompt := strings.TrimSpace(strField(m, "prompt", "question"))
	if prompt == "" {
		return fmt.Errorf("题目 #%d 缺少 prompt", fallbackN)
	}
	mode := parseMode(m["mode"])
	if mode == "text" {
		return nil
	}
	opts, err := parseOptions(m["options"])
	if err != nil {
		return fmt.Errorf("题目 #%d options: %w", fallbackN, err)
	}
	if len(opts) == 0 {
		return fmt.Errorf("题目 #%d 至少需要一个 option", fallbackN)
	}
	return nil
}

func parseMode(raw any) string {
	m := strings.ToLower(strings.TrimSpace(fmt.Sprint(raw)))
	if m == "" {
		m = "single"
	}
	if m == "multi" || m == "multiple" {
		return "multi"
	}
	if m == "text" || m == "input" || m == "fill" {
		return "text"
	}
	return "single"
}

func parseOptions(raw any) ([]struct{ key, label string }, error) {
	arr, ok := raw.([]any)
	if !ok {
		return nil, fmt.Errorf("必须是数组")
	}
	var out []struct{ key, label string }
	for _, item := range arr {
		m, ok := item.(map[string]any)
		if !ok {
			continue
		}
		key := normKey(fmt.Sprint(m["key"]))
		label := strings.TrimSpace(fmt.Sprint(m["label"]))
		if key == "" || label == "" {
			continue
		}
		out = append(out, struct{ key, label string }{key, label})
	}
	return out, nil
}

func normKey(k string) string {
	k = strings.TrimSpace(strings.ToLower(k))
	var b strings.Builder
	for _, r := range k {
		if (r >= 'a' && r <= 'z') || (r >= '0' && r <= '9') {
			b.WriteRune(r)
		}
	}
	return b.String()
}

func strField(m map[string]any, keys ...string) string {
	for _, k := range keys {
		if v, ok := m[k]; ok {
			s := strings.TrimSpace(fmt.Sprint(v))
			if s != "" && s != "<nil>" {
				return s
			}
		}
	}
	return ""
}

func tailSnippet(s string, maxRunes int) string {
	s = strings.TrimSpace(s)
	if s == "" {
		return ""
	}
	runes := []rune(s)
	if len(runes) <= maxRunes {
		return s
	}
	return string(runes[len(runes)-maxRunes:])
}
