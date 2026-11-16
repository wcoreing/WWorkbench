package workbenchtools

import (
	"context"
	"encoding/base64"
	"encoding/json"
	"fmt"
	"os"
	"path/filepath"
	"strings"
	"time"

	"WWorkbench/internal/browser"
	"WWorkbench/internal/model"
	"WWorkbench/internal/store"
)

func saveBrowserShot(dataURL, preferFormat string) (path string, size int, format string, err error) {
	comma := strings.Index(dataURL, ",")
	if comma < 0 {
		return "", 0, "", errStr("截图 dataUrl 格式错误")
	}
	raw, decErr := base64.StdEncoding.DecodeString(dataURL[comma+1:])
	if decErr != nil {
		return "", 0, "", errStr("截图解码失败: " + decErr.Error())
	}
	dataDir, dirErr := store.DataDir()
	if dirErr != nil {
		return "", 0, "", errStr("数据目录不可用: " + dirErr.Error())
	}
	dir := filepath.Join(dataDir, "browser-shots")
	if mkErr := os.MkdirAll(dir, 0o755); mkErr != nil {
		return "", 0, "", errStr("创建截图目录失败: " + mkErr.Error())
	}
	format = strings.ToLower(strings.TrimSpace(preferFormat))
	if format != "png" {
		format = "jpeg"
	}
	if strings.Contains(dataURL[:comma], "png") {
		format = "png"
	}
	ext := "jpg"
	if format == "png" {
		ext = "png"
	}
	name := fmt.Sprintf("shot-%s.%s", time.Now().Format("20060102-150405.000"), ext)
	path = filepath.Join(dir, name)
	if wErr := os.WriteFile(path, raw, 0o644); wErr != nil {
		return "", 0, "", errStr("写入截图失败: " + wErr.Error())
	}
	return path, len(raw), format, nil
}

// browserClient 经任务网关调用执行器（wwb/kimi/agent-browser）；替代直连 Bridge。
type browserClient struct {
	d            *Deps
	executorHint string
	session      string
	lastProvider string
}

func (c *browserClient) Call(ctx context.Context, action string, args interface{}) (json.RawMessage, error) {
	if c == nil {
		return nil, errBrowserMissing
	}
	data, prov, err := browserCall(ctx, c.d, c.session, c.executorHint, action, args)
	c.lastProvider = prov
	return data, err
}

func (c *browserClient) CallSession(ctx context.Context, action string, args interface{}, session string) (json.RawMessage, error) {
	if c == nil {
		return nil, errBrowserMissing
	}
	data, prov, err := browserCall(ctx, c.d, session, c.executorHint, action, args)
	c.lastProvider = prov
	return data, err
}

func (c *browserClient) Provider() string {
	if c == nil {
		return model.TaskProviderWWB
	}
	return providerOrWWB(c.lastProvider)
}

func requireBrowser(d *Deps) (*browserClient, error) {
	return requireBrowserExec(d, "", "")
}

func requireBrowserExec(d *Deps, executorHint, session string) (*browserClient, error) {
	if d == nil {
		return nil, errBrowserMissing
	}
	ctx := context.Background()
	if _, _, err := browser.ResolveExecutorForAction(ctx, executorHint, "", browserExecutors(d)...); err != nil {
		return nil, err
	}
	return &browserClient{d: d, executorHint: executorHint, session: session}, nil
}

// withExecutorPreview 把 raw 里的 executor 拷进确认预览，避免确认后丢失执行器。
func withExecutorPreview(raw json.RawMessage, preview map[string]interface{}) map[string]interface{} {
	if preview == nil {
		preview = map[string]interface{}{}
	}
	if ex := peekExecutor(raw); ex != "" {
		preview["executor"] = ex
	}
	if sess := peekSession(raw); sess != "" {
		preview["session"] = sess
	}
	return preview
}

// copyWaitForArgs 把 waitFor* 透传给扩展（内联短等，省掉单独 browser_wait）。
func copyWaitForArgs(argsJSON string, args map[string]interface{}) {
	if args == nil {
		return
	}
	var raw map[string]interface{}
	if json.Unmarshal([]byte(argsJSON), &raw) != nil || raw == nil {
		return
	}
	for k, v := range raw {
		if k == "waitFor" || strings.HasPrefix(k, "waitFor") {
			args[k] = v
		}
	}
}

func requireBrowserRaw(d *Deps, raw json.RawMessage) (*browserClient, error) {
	return requireBrowserExec(d, peekExecutor(raw), peekSession(raw))
}

var errBrowserMissing = errStr("浏览器执行器未就绪（连接 WWorkbench 扩展、启动 Kimi WebBridge，或安装 agent-browser）")

type errStr string

func (e errStr) Error() string { return string(e) }

func stageBrowser(d *Deps, label string) {
	if d == nil || d.UIActions == nil {
		return
	}
	d.UIActions.Dispatch(UIActionBrowserOpen, map[string]interface{}{
		"stageLabel": "MCP · 浏览器 · " + label,
	})
}
