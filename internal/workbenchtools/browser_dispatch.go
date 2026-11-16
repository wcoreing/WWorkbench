package workbenchtools

import (
	"context"
	"encoding/json"
	"strings"

	"WWorkbench/internal/browser"
	"WWorkbench/internal/model"
)

// browserExecutors 浏览器执行器有序列表；顺序即 auto 的优先级（wwb → kimi → agent-browser）。
func browserExecutors(d *Deps) []browser.Executor {
	wwb := &browser.WWBExecutor{}
	if d != nil {
		wwb.Bridge = d.Browser
	}
	execs := []browser.Executor{wwb, browser.NewKimiExecutor("")}
	if d != nil && d.AgentBrowser != nil {
		execs = append(execs, d.AgentBrowser)
	}
	return execs
}

// browserCall 经执行器网关调用浏览器动作；返回 data 与实际 provider（wwb|kimi|agent-browser）。
func browserCall(ctx context.Context, d *Deps, session, executorHint, action string, args interface{}) (json.RawMessage, string, error) {
	ex, provider, err := browser.ResolveExecutorForAction(ctx, executorHint, action, browserExecutors(d)...)
	if err != nil {
		return nil, "", err
	}
	argsRaw, err := json.Marshal(args)
	if err != nil {
		return nil, provider, err
	}
	session = strings.TrimSpace(session)
	if session == "" {
		session = CurrentTaskSession(ctx)
	}
	data, err := ex.Call(ctx, action, argsRaw, session)
	return data, provider, err
}

func peekExecutor(raw json.RawMessage) string {
	var in struct {
		Executor string `json:"executor"`
		Backend  string `json:"backend"`
	}
	_ = json.Unmarshal(raw, &in)
	if s := strings.TrimSpace(in.Executor); s != "" {
		return s
	}
	return strings.TrimSpace(in.Backend)
}

func peekSession(raw json.RawMessage) string {
	var in struct {
		Session string `json:"session"`
	}
	_ = json.Unmarshal(raw, &in)
	return strings.TrimSpace(in.Session)
}

func providerOrWWB(p string) string {
	p = strings.TrimSpace(p)
	if p == "" {
		return model.TaskProviderWWB
	}
	return p
}

func executorsSnapshot(ctx context.Context, d *Deps) map[string]interface{} {
	return browser.ExecutorsStatus(ctx, browserExecutors(d)...)
}
