package agent

import (
	"bufio"
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"strings"

	"WWorkbench/internal/workbenchtools"
)

type chatRequestStream struct {
	Model      string           `json:"model"`
	Messages   []chatMessage    `json:"messages"`
	Tools      []toolDefPayload `json:"tools,omitempty"`
	ToolChoice string           `json:"tool_choice,omitempty"`
	Stream     bool             `json:"stream"`
}

type streamDelta struct {
	Choices []struct {
		Delta struct {
			Content   *string `json:"content"`
			Role      string  `json:"role"`
			ToolCalls []struct {
				Index    int     `json:"index"`
				ID       string  `json:"id"`
				Type     string  `json:"type"`
				Function *struct {
					Name      string `json:"name"`
					Arguments string `json:"arguments"`
				} `json:"function"`
			} `json:"tool_calls"`
		} `json:"delta"`
		FinishReason string `json:"finish_reason"`
	} `json:"choices"`
}

type toolCallAcc struct {
	id        string
	typ       string
	name      string
	args      strings.Builder
}

// StreamDeltaHandler 流式文本增量回调。
type StreamDeltaHandler func(delta string)

// CompleteStream 流式完成一轮；onDelta 仅推送文本增量（tool_calls 时不推送）。
func (p *Provider) CompleteStream(
	ctx context.Context,
	messages []chatMessage,
	tools []workbenchtools.ToolDef,
	onDelta StreamDeltaHandler,
) (chatMessage, error) {
	payload := chatRequestStream{Model: p.model, Messages: sanitizeMessages(messages), Stream: true}
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
	req.Header.Set("Accept", "text/event-stream")
	resp, err := p.client.Do(req)
	if err != nil {
		return chatMessage{}, fmt.Errorf("网络请求失败: %w", err)
	}
	defer resp.Body.Close()
	if resp.StatusCode >= 400 {
		raw, _ := io.ReadAll(resp.Body)
		return chatMessage{}, fmt.Errorf("LLM HTTP %d: %s", resp.StatusCode, parseLLMErrorBody(raw))
	}

	var contentBuf strings.Builder
	toolAcc := map[int]*toolCallAcc{}
	finishReason := ""
	seenTool := false

	sc := bufio.NewScanner(resp.Body)
	sc.Buffer(make([]byte, 0, 64*1024), 1024*1024)
	for sc.Scan() {
		if ctx.Err() != nil {
			return chatMessage{}, ctx.Err()
		}
		line := strings.TrimSpace(sc.Text())
		if line == "" || !strings.HasPrefix(line, "data:") {
			continue
		}
		data := strings.TrimSpace(strings.TrimPrefix(line, "data:"))
		if data == "[DONE]" {
			break
		}
		var chunk streamDelta
		if err := json.Unmarshal([]byte(data), &chunk); err != nil {
			continue
		}
		if len(chunk.Choices) == 0 {
			continue
		}
		ch := chunk.Choices[0]
		if ch.FinishReason != "" {
			finishReason = ch.FinishReason
		}
		d := ch.Delta
		if d.Content != nil && *d.Content != "" {
			contentBuf.WriteString(*d.Content)
			if onDelta != nil && !seenTool {
				onDelta(*d.Content)
			}
		}
		for _, tc := range d.ToolCalls {
			seenTool = true
			idx := tc.Index
			acc, ok := toolAcc[idx]
			if !ok {
				acc = &toolCallAcc{}
				toolAcc[idx] = acc
			}
			if tc.ID != "" {
				acc.id = tc.ID
			}
			if tc.Type != "" {
				acc.typ = tc.Type
			}
			if tc.Function != nil {
				if tc.Function.Name != "" {
					acc.name = tc.Function.Name
				}
				if tc.Function.Arguments != "" {
					acc.args.WriteString(tc.Function.Arguments)
				}
			}
		}
	}
	if err := sc.Err(); err != nil {
		return chatMessage{}, fmt.Errorf("读取流式响应失败: %w", err)
	}

	full := contentBuf.String()
	var toolCalls []toolCall
	if len(toolAcc) > 0 || finishReason == "tool_calls" {
		maxIdx := -1
		for k := range toolAcc {
			if k > maxIdx {
				maxIdx = k
			}
		}
		for i := 0; i <= maxIdx; i++ {
			acc, ok := toolAcc[i]
			if !ok {
				continue
			}
			id := acc.id
			if id == "" {
				id = fmt.Sprintf("call_%d", i)
			}
			typ := acc.typ
			if typ == "" {
				typ = "function"
			}
			args := acc.args.String()
			if args == "" {
				args = "{}"
			}
			toolCalls = append(toolCalls, toolCall{
				ID: id, Type: typ,
				Function: struct {
					Name      string `json:"name"`
					Arguments string `json:"arguments"`
				}{Name: acc.name, Arguments: args},
			})
		}
	}
	msg := chatMessage{Role: "assistant", ToolCalls: toolCalls}
	if full != "" {
		msg.Content = &full
	} else if len(toolCalls) > 0 {
		empty := ""
		msg.Content = &empty
	}
	return msg, nil
}
