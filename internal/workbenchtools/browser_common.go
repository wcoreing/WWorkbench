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

// browserClient 经任务网关调用执行器（wwb/kimi）；替代直连 Bridge。
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
	if _, _, err := browser.ResolveExecutor(ctx, executorHint, &browser.WWBExecutor{Bridge: d.Browser}, browser.NewKimiExecutor("")); err != nil {
		return nil, err
	}
	return &browserClient{d: d, executorHint: executorHint, session: session}, nil
}

func requireBrowserRaw(d *Deps, raw json.RawMessage) (*browserClient, error) {
	return requireBrowserExec(d, peekExecutor(raw), peekSession(raw))
}

var errBrowserMissing = errStr("浏览器执行器未就绪（连接 WWorkbench 扩展或启动 Kimi WebBridge）")

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
