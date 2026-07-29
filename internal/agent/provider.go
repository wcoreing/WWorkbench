package agent

import (
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"strings"
	"time"

	"WWorkbench/internal/workbenchtools"
)

// chatMessage OpenAI 风格消息。
type chatMessage struct {
	Role       string     `json:"role"`
	Content    *string    `json:"content"`
	ToolCalls  []toolCall `json:"tool_calls,omitempty"`
	ToolCallID string     `json:"tool_call_id,omitempty"`
	Name       string     `json:"name,omitempty"`
}

type toolCall struct {
	ID       string `json:"id"`
	Type     string `json:"type"`
	Function struct {
		Name      string `json:"name"`
		Arguments string `json:"arguments"`
	} `json:"function"`
}

type toolDefPayload struct {
	Type     string `json:"type"`
	Function struct {
		Name        string                 `json:"name"`
		Description string                 `json:"description"`
		Parameters  map[string]interface{} `json:"parameters"`
	} `json:"function"`
}

type chatRequest struct {
	Model       string           `json:"model"`
	Messages    []chatMessage    `json:"messages"`
	Tools       []toolDefPayload `json:"tools,omitempty"`
	ToolChoice  string           `json:"tool_choice,omitempty"`
}

type chatResponse struct {
	Choices []struct {
		Message struct {
			Role      string     `json:"role"`
			Content   *string    `json:"content"`
			ToolCalls []toolCall `json:"tool_calls"`
		} `json:"message"`
		FinishReason string `json:"finish_reason"`
	} `json:"choices"`
	Error *struct {
		Message string `json:"message"`
		Type    string `json:"type"`
		Code    string `json:"code"`
	} `json:"error"`
	Code    string `json:"code"`
	Message string `json:"message"`
}

// Provider LLM 调用接口。
type Provider struct {
	baseURL string
	apiKey  string
	model   string
	client  *http.Client
}

// NewProvider 创建 OpenAI 兼容 Provider。
func NewProvider(baseURL, apiKey, model string) *Provider {
	baseURL = strings.TrimRight(strings.TrimSpace(baseURL), "/")
	baseURL = strings.TrimSuffix(baseURL, "/chat/completions")
	baseURL = strings.TrimSuffix(baseURL, "/")
	if baseURL == "" {
		baseURL = "https://dashscope.aliyuncs.com/compatible-mode/v1"
	}
	return &Provider{
		baseURL: baseURL,
		apiKey:  strings.TrimSpace(apiKey),
		model:   strings.TrimSpace(model),
		client:  &http.Client{Timeout: 120 * time.Second},
	}
}

// Complete 非流式完成一轮（支持 tool_calls）。
func (p *Provider) Complete(ctx context.Context, messages []chatMessage, tools []workbenchtools.ToolDef) (chatMessage, error) {
	payload := chatRequest{Model: p.model, Messages: sanitizeMessages(messages)}
	if len(tools) > 0 {
		payload.ToolChoice = "auto"
		for _, t := range tools {
			var td toolDefPayload
			td.Type = "function"
			td.Function.Name = t.Name
			td.Function.Description = t.Description
			params := t.Parameters
			if params == nil {
				params = map[string]interface{}{"type": "object", "properties": map[string]interface{}{}}
			}
			td.Function.Parameters = params
			payload.Tools = append(payload.Tools, td)
		}
	}
	body, err := json.Marshal(payload)
	if err != nil {
		return chatMessage{}, err
	}
	req, err := http.NewRequestWithContext(ctx, http.MethodPost, p.baseURL+"/chat/completions", bytes.NewReader(body))
	if err != nil {
		return chatMessage{}, err
	}
	req.Header.Set("Content-Type", "application/json")
	req.Header.Set("Authorization", "Bearer "+p.apiKey)
	resp, err := p.client.Do(req)
	if err != nil {
		return chatMessage{}, fmt.Errorf("网络请求失败: %w", err)
	}
	defer resp.Body.Close()
	raw, _ := io.ReadAll(resp.Body)
	if resp.StatusCode >= 400 {
		return chatMessage{}, fmt.Errorf("LLM HTTP %d: %s", resp.StatusCode, parseLLMErrorBody(raw))
	}
	var out chatResponse
	if err := json.Unmarshal(raw, &out); err != nil {
		return chatMessage{}, fmt.Errorf("解析 LLM 响应失败: %w", err)
	}
	if msg := extractAPIError(&out); msg != "" {
		return chatMessage{}, fmt.Errorf("%s", msg)
	}
	if len(out.Choices) == 0 {
		return chatMessage{}, fmt.Errorf("LLM 无响应: %s", truncateBytes(raw, 200))
	}
	m := out.Choices[0].Message
	role := m.Role
	if role == "" {
		role = "assistant"
	}
	for i := range m.ToolCalls {
		if m.ToolCalls[i].Type == "" {
			m.ToolCalls[i].Type = "function"
		}
		if m.ToolCalls[i].Function.Arguments == "" {
			m.ToolCalls[i].Function.Arguments = "{}"
		}
	}
	return chatMessage{Role: role, Content: m.Content, ToolCalls: m.ToolCalls}, nil
}

// sanitizeMessages 规范化消息体以兼容百炼/OpenAI。
func sanitizeMessages(msgs []chatMessage) []chatMessage {
	out := make([]chatMessage, 0, len(msgs))
	for _, m := range msgs {
		role := m.Role
		if role == "" {
			continue
		}
		if role == "tool" {
			if m.ToolCallID == "" {
				continue
			}
			if m.Name == "" {
				m.Name = "tool"
			}
		}
		if role == "assistant" && len(m.ToolCalls) > 0 && m.Content == nil {
			empty := ""
			m.Content = &empty
		}
		if role != "assistant" && m.Content == nil && m.ToolCallID == "" {
			empty := ""
			m.Content = &empty
		}
		out = append(out, m)
	}
	return out
}

func parseLLMErrorBody(raw []byte) string {
	if len(raw) == 0 {
		return "空响应"
	}
	var out chatResponse
	if err := json.Unmarshal(raw, &out); err == nil {
		if msg := extractAPIError(&out); msg != "" {
			return msg
		}
	}
	var generic map[string]interface{}
	if err := json.Unmarshal(raw, &generic); err == nil {
		if errObj, ok := generic["error"].(map[string]interface{}); ok {
			if msg, _ := errObj["message"].(string); msg != "" {
				return msg
			}
		}
		if msg, _ := generic["message"].(string); msg != "" {
			return msg
		}
	}
	return truncateBytes(raw, 300)
}

func extractAPIError(out *chatResponse) string {
	if out == nil {
		return ""
	}
	if out.Error != nil && out.Error.Message != "" {
		if out.Error.Code != "" {
			return out.Error.Message + " (" + out.Error.Code + ")"
		}
		return out.Error.Message
	}
	if out.Message != "" {
		if out.Code != "" {
			return out.Message + " (" + out.Code + ")"
		}
		return out.Message
	}
	return ""
}

func truncateBytes(b []byte, n int) string {
	if len(b) <= n {
		return string(b)
	}
	return string(b[:n]) + "…"
}

func strPtr(s string) *string {
	return &s
}
