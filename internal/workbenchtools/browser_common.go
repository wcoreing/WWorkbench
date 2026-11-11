package workbenchtools

import (
	"encoding/base64"
	"fmt"
	"os"
	"path/filepath"
	"strings"
	"time"

	"WWorkbench/internal/browser"
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

func requireBrowser(d *Deps) (*browser.Bridge, error) {
	if d == nil || d.Browser == nil {
		return nil, errBrowserMissing
	}
	return d.Browser, nil
}

var errBrowserMissing = errStr("浏览器桥未就绪（请重启 WWorkbench）")

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
