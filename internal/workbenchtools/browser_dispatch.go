package workbenchtools

import (
	"context"
	"encoding/json"
	"strings"

	"WWorkbench/internal/browser"
	"WWorkbench/internal/model"
)

// browserCall 经执行器网关调用浏览器动作；返回 data 与实际 provider（wwb|kimi）。
func browserCall(ctx context.Context, d *Deps, session, executorHint, action string, args interface{}) (json.RawMessage, string, error) {
	wwb := &browser.WWBExecutor{}
	if d != nil {
		wwb.Bridge = d.Browser
	}
	kimi := browser.NewKimiExecutor("")
	ex, provider, err := browser.ResolveExecutor(ctx, executorHint, wwb, kimi)
	if err != nil {
		return nil, "", err
	}
	argsRaw, err := json.Marshal(args)
	if err != nil {
		return nil, provider, err
	}
	session = strings.TrimSpace(session)
	if session == "" {
		session = CurrentTaskSession()
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
	wwb := &browser.WWBExecutor{}
	if d != nil {
		wwb.Bridge = d.Browser
	}
	return browser.ExecutorsStatus(ctx, wwb, browser.NewKimiExecutor(""))
}
