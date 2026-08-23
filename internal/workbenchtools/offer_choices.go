package workbenchtools

import (
	"context"
	"encoding/json"
	"strings"
	"unicode/utf8"

	"WWorkbench/internal/workbench"
)

type offerChoicesArgs struct {
	Prompt      string              `json:"prompt"`
	Mode        string              `json:"mode"`
	Options     []offerChoiceOption `json:"options"`
	Placeholder string              `json:"placeholder"`
}

type offerChoiceOption struct {
	Key   string `json:"key"`
	Label string `json:"label"`
}

// OfferChoicesPayload 待点选载荷（落 pending.args / 事件 preview）。
type OfferChoicesPayload struct {
	Prompt      string              `json:"prompt"`
	Mode        string              `json:"mode"`
	Options     []offerChoiceOption `json:"options,omitempty"`
	Placeholder string              `json:"placeholder,omitempty"`
}

func toolOfferChoices(_ context.Context, _ *Deps, raw json.RawMessage) ToolResult {
	var args offerChoicesArgs
	if err := json.Unmarshal(raw, &args); err != nil {
		return Fail("参数无效: " + err.Error())
	}
	prompt := strings.TrimSpace(args.Prompt)
	if prompt == "" {
		return Fail("prompt 不能为空")
	}
	mode := strings.ToLower(strings.TrimSpace(args.Mode))
	if mode == "" {
		mode = "single"
	}
	switch mode {
	case "single", "multi", "text":
	default:
		return Fail("mode 须为 single / multi / text")
	}
	opts := make([]offerChoiceOption, 0, len(args.Options))
	seen := map[string]struct{}{}
	for _, o := range args.Options {
		key := normChoiceKey(o.Key)
		label := strings.TrimSpace(o.Label)
		if key == "" || label == "" {
			continue
		}
		if _, ok := seen[key]; ok {
			continue
		}
		seen[key] = struct{}{}
		opts = append(opts, offerChoiceOption{Key: key, Label: label})
	}
	if mode != "text" && len(opts) < 2 {
		return Fail("single/multi 至少需要 2 个 options（key+label）")
	}
	if mode == "text" {
		opts = nil
	}
	summary := prompt
	if utf8.RuneCountInString(summary) > 80 {
		summary = string([]rune(summary)[:80]) + "…"
	}
	return Choice(summary, OfferChoicesPayload{
		Prompt:      prompt,
		Mode:        mode,
		Options:     opts,
		Placeholder: strings.TrimSpace(args.Placeholder),
	})
}

func normChoiceKey(k string) string {
	k = strings.TrimSpace(strings.ToLower(k))
	var b strings.Builder
	for _, r := range k {
		if (r >= 'a' && r <= 'z') || (r >= '0' && r <= '9') {
			b.WriteRune(r)
		}
	}
	return b.String()
}

// ChoiceResultFromPending 把用户点选写成工具结果（进模）。
func ChoiceResultFromPending(argsJSON string, keys []string, text string) (ToolResult, error) {
	var payload OfferChoicesPayload
	if err := json.Unmarshal([]byte(argsJSON), &payload); err != nil {
		var raw offerChoicesArgs
		if err2 := json.Unmarshal([]byte(argsJSON), &raw); err2 != nil {
			return Fail("pending 参数无效"), err
		}
		payload = OfferChoicesPayload{
			Prompt: raw.Prompt, Mode: raw.Mode, Options: raw.Options, Placeholder: raw.Placeholder,
		}
	}
	mode := strings.ToLower(strings.TrimSpace(payload.Mode))
	if mode == "" {
		mode = "single"
	}
	out := map[string]interface{}{
		"prompt": payload.Prompt,
		"mode":   mode,
	}
	if mode == "text" {
		t := strings.TrimSpace(text)
		if t == "" {
			return Fail("请输入内容"), nil
		}
		out["text"] = t
		out["selectedText"] = t
		return OKData(out), nil
	}
	normKeys := make([]string, 0, len(keys))
	seen := map[string]struct{}{}
	for _, k := range keys {
		k = normChoiceKey(k)
		if k == "" {
			continue
		}
		if _, ok := seen[k]; ok {
			continue
		}
		seen[k] = struct{}{}
		normKeys = append(normKeys, k)
	}
	if len(normKeys) == 0 {
		return Fail("请至少选择一项"), nil
	}
	if mode == "single" && len(normKeys) > 1 {
		normKeys = normKeys[:1]
	}
	labels := make([]string, 0, len(normKeys))
	for _, k := range normKeys {
		found := false
		for _, o := range payload.Options {
			if normChoiceKey(o.Key) == k {
				labels = append(labels, strings.TrimSpace(o.Label))
				found = true
				break
			}
		}
		if !found {
			return Fail("未知选项: " + k), nil
		}
	}
	out["keys"] = normKeys
	out["labels"] = labels
	if mode == "multi" {
		out["selectedText"] = strings.Join(labels, "、")
	} else {
		out["selectedText"] = labels[0]
	}
	return OKData(out), nil
}

func offerChoicesToolDef() ToolDef {
	return ToolDef{
		Name: workbench.CapOfferChoices,
		Description: "向用户展示可点选项并等待选择（拍板/选下一步）。需要用户在多条路径中选一时必须调用本工具，禁止只用 Markdown 列表。" +
			"调用后本轮暂停；用户点选后结果会作为本工具返回值续跑。",
		Parameters: map[string]interface{}{
			"type": "object",
			"properties": map[string]interface{}{
				"prompt": map[string]interface{}{
					"type": "string", "description": "题干，如「可选下一步」",
				},
				"mode": map[string]interface{}{
					"type": "string", "description": "single | multi | text，默认 single",
				},
				"options": map[string]interface{}{
					"type": "array",
					"items": map[string]interface{}{
						"type": "object",
						"properties": map[string]interface{}{
							"key":   map[string]interface{}{"type": "string", "description": "短键，如 a/b/c"},
							"label": map[string]interface{}{"type": "string", "description": "展示文案（用户点选后发送的原文）"},
						},
						"required": []interface{}{"key", "label"},
					},
					"description": "single/multi 至少 2 项",
				},
				"placeholder": map[string]interface{}{
					"type": "string", "description": "mode=text 时输入框占位",
				},
			},
			"required": []interface{}{"prompt"},
		},
		Handler: toolOfferChoices,
	}
}
