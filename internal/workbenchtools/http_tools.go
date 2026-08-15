package workbenchtools

import (
	"context"
	"encoding/json"
	"fmt"
	"net/http"
	"net/url"
	"strings"

	"WWorkbench/internal/httpclient"
	"WWorkbench/internal/model"
	"WWorkbench/internal/store"
	"WWorkbench/internal/workbench"

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

type saveHTTPRequestArgs struct {
	ID          string `json:"id"`
	Name        string `json:"name"`
	Method      string `json:"method"`
	URL         string `json:"url"`
	Body        string `json:"body"`
	FolderID    string `json:"folderId"`
	Notes       string `json:"notes"`
	HeadersJSON string `json:"headersJson"`
	ParamsJSON  string `json:"paramsJson"`
	CookiesJSON string `json:"cookiesJson"`
	Reveal      *bool  `json:"reveal"`
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

// toolSaveHTTPRequest 保存 HTTP 请求模板为工作台资产，并广播雷达刷新 UI。
func toolSaveHTTPRequest(_ context.Context, d *Deps, raw json.RawMessage) ToolResult {
	var in saveHTTPRequestArgs
	if err := json.Unmarshal(raw, &in); err != nil {
		return Fail("参数无效")
	}
	u := strings.TrimSpace(in.URL)
	if u == "" {
		return Fail("请填写 url")
	}
	method := strings.ToUpper(strings.TrimSpace(in.Method))
	if method == "" {
		method = http.MethodGet
	}
	name := strings.TrimSpace(in.Name)
	if name == "" {
		name = deriveHTTPRequestName(method, u)
	}
	op := workbench.RadarOpUpdate
	id := strings.TrimSpace(in.ID)
	if id == "" {
		op = workbench.RadarOpCreate
	}
	saved, err := d.Store.SaveHTTPRequest(model.HTTPSavedRequestDO{
		ID:          id,
		FolderID:    strings.TrimSpace(in.FolderID),
		Name:        name,
		Method:      method,
		URL:         u,
		Body:        in.Body,
		Notes:       strings.TrimSpace(in.Notes),
		HeadersJSON: defaultJSONArray(in.HeadersJSON),
		ParamsJSON:  defaultJSONArray(in.ParamsJSON),
		CookiesJSON: defaultJSONArray(in.CookiesJSON),
	})
	if err != nil {
		return Fail(err.Error())
	}
	reveal := true
	if in.Reveal != nil {
		reveal = *in.Reveal
	}
	label := saved.Method + " " + saved.Name
	if d.Radar != nil {
		d.Radar.EmitHTTPRequest(op, saved.ID, "agent-http-save", label, reveal)
	}
	return OKData(map[string]interface{}{
		"ok": true, "op": op, "id": saved.ID, "name": saved.Name,
		"method": saved.Method, "url": saved.URL,
		"note": "已写入 HTTP 资产；界面将刷新并可聚焦该请求。后续请用 requestId 调用 execute_http。",
	})
}

func defaultJSONArray(s string) string {
	if strings.TrimSpace(s) == "" {
		return "[]"
	}
	return s
}

func deriveHTTPRequestName(method, rawURL string) string {
	u, err := url.Parse(rawURL)
	if err != nil || u.Host == "" {
		return method + " " + truncate(rawURL, 40)
	}
	path := u.Path
	if path == "" || path == "/" {
		return method + " " + u.Host
	}
	return method + " " + u.Host + path
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
