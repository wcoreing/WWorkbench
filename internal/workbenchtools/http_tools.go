package workbenchtools

import (
	"context"
	"encoding/json"
	"fmt"
	"net/http"
	"strings"

	"WWorkbench/internal/httpclient"
	"WWorkbench/internal/model"
	"WWorkbench/internal/store"

	"github.com/google/uuid"
)

type httpExecuteArgs struct {
	RequestID string `json:"requestId"`
	Method    string `json:"method"`
	URL       string `json:"url"`
	Body      string `json:"body"`
	EnvID     string `json:"envId"`
	TimeoutMs int    `json:"timeoutMs"`
}

const maxHTTPBodyForAgent = 8000

// resolveHTTPVars 解析 HTTP 环境变量。
func resolveHTTPVars(d *Deps, envID string) map[string]string {
	if envID == "" {
		return nil
	}
	e, err := d.Store.GetHTTPEnvironment(envID)
	if err != nil {
		return nil
	}
	return store.ParseHTTPEnvironmentVars(e.VarsJSON)
}

// buildHTTPExecuteRequest 组装 HTTP 执行请求。
func buildHTTPExecuteRequest(d *Deps, in httpExecuteArgs) (model.HTTPExecuteRequestDO, error) {
	var req model.HTTPExecuteRequestDO
	if id := strings.TrimSpace(in.RequestID); id != "" {
		saved, err := d.Store.GetHTTPRequest(id)
		if err != nil {
			return req, err
		}
		req = model.HTTPExecuteRequestDO{
			Method: saved.Method,
			URL:    saved.URL,
			Body:   saved.Body,
			Headers: store.ParseHTTPHeadersJSON(saved.HeadersJSON),
		}
	}
	if m := strings.TrimSpace(in.Method); m != "" {
		req.Method = m
	}
	if u := strings.TrimSpace(in.URL); u != "" {
		req.URL = u
	}
	if in.Body != "" {
		req.Body = in.Body
	}
	if req.Method == "" {
		req.Method = http.MethodGet
	}
	req.EnvID = strings.TrimSpace(in.EnvID)
	if in.TimeoutMs > 0 {
		req.TimeoutMs = in.TimeoutMs
	}
	if strings.TrimSpace(req.URL) == "" {
		return req, fmt.Errorf("请填写 url 或 requestId")
	}
	vars := resolveHTTPVars(d, req.EnvID)
	return httpclient.ApplyEnvToRequest(req, vars), nil
}

// toolListHTTPRequests 列出已保存 HTTP 请求模板。
func toolListHTTPRequests(ctx context.Context, d *Deps, _ json.RawMessage) ToolResult {
	list, err := d.Store.ListHTTPRequests()
	if err != nil {
		return Fail(err.Error())
	}
	return OKData(list)
}

// toolListHTTPEnvironments 列出 HTTP 环境变量预设。
func toolListHTTPEnvironments(ctx context.Context, d *Deps, _ json.RawMessage) ToolResult {
	list, err := d.Store.ListHTTPEnvironments()
	if err != nil {
		return Fail(err.Error())
	}
	return OKData(list)
}

// toolExecuteHTTP 执行 HTTP 请求（GET/HEAD 直接执行；其它方法需用户确认）。
func toolExecuteHTTP(ctx context.Context, d *Deps, raw json.RawMessage) ToolResult {
	var in httpExecuteArgs
	if err := json.Unmarshal(raw, &in); err != nil {
		return Fail("参数无效")
	}
	req, err := buildHTTPExecuteRequest(d, in)
	if err != nil {
		return Fail(err.Error())
	}
	method := strings.ToUpper(req.Method)
	if method != http.MethodGet && method != http.MethodHead {
		preview := map[string]interface{}{
			"method": method, "url": req.URL, "body": truncate(req.Body, 500),
			"envId": req.EnvID, "requestId": strings.TrimSpace(in.RequestID),
		}
		return Confirm(uuid.NewString(), method+" "+truncate(req.URL, 80), preview)
	}
	return executeHTTPNow(req)
}

// ExecuteHTTPConfirmed 用户确认后执行 HTTP 请求。
func ExecuteHTTPConfirmed(_ context.Context, d *Deps, argsJSON string) ToolResult {
	var in httpExecuteArgs
	if err := json.Unmarshal([]byte(argsJSON), &in); err != nil {
		return Fail("参数无效")
	}
	req, err := buildHTTPExecuteRequest(d, in)
	if err != nil {
		return Fail(err.Error())
	}
	return executeHTTPNow(req)
}

func executeHTTPNow(req model.HTTPExecuteRequestDO) ToolResult {
	resp, err := httpclient.Execute(req)
	if err != nil {
		return Fail(err.Error())
	}
	out := map[string]interface{}{
		"statusCode": resp.StatusCode,
		"status":     resp.Status,
		"elapsedMs":  resp.ElapsedMs,
		"truncated":  resp.Truncated,
		"error":      resp.Error,
	}
	body := resp.Body
	if len(body) > maxHTTPBodyForAgent {
		body = body[len(body)-maxHTTPBodyForAgent:]
		body = "…(响应已截断)\n" + body
	}
	out["body"] = body
	if len(resp.Headers) > 0 && len(resp.Headers) <= 20 {
		out["headers"] = resp.Headers
	}
	return OKData(out)
}
