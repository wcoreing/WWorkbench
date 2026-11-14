package browser

import (
	"embed"
	"io/fs"
	"os"
	"path/filepath"
	"strings"

	"WWorkbench/internal/errno"
)

//go:embed all:ext
var extFS embed.FS

const seedMarker = ".ww-browser-ext-version"
const seedVersion = "0.3.16"

// BridgeTokenPlaceholder 扩展 offscreen.js 中的 token 占位符（启动时注入真值）。
const BridgeTokenPlaceholder = "__WW_BRIDGE_TOKEN__"

// SeedVersion 当前内置/释放到磁盘的扩展版本（与 Chrome 里正在跑的 SW 可能不一致）。
func SeedVersion() string { return seedVersion }

// SeedExtDir 将内置扩展释放到 dataDir/browser-ext（版本变更时覆盖）。
func SeedExtDir(dataDir string) (string, error) {
	if dataDir == "" {
		return "", errno.New(errno.CodeInvalidArg, "数据目录为空", "")
	}
	dest := filepath.Join(dataDir, "browser-ext")
	if err := os.MkdirAll(dest, 0o755); err != nil {
		return "", errno.Wrap(errno.CodeStoreFailed, "创建扩展目录失败", err)
	}
	marker := filepath.Join(dest, seedMarker)
	if b, err := os.ReadFile(marker); err == nil && string(b) == seedVersion {
		if _, err := os.Stat(filepath.Join(dest, "manifest.json")); err == nil {
			return dest, nil
		}
	}
	if err := fs.WalkDir(extFS, "ext", func(path string, d fs.DirEntry, err error) error {
		if err != nil {
			return err
		}
		rel, err := filepath.Rel("ext", path)
		if err != nil {
			return err
		}
		if rel == "." {
			return nil
		}
		target := filepath.Join(dest, rel)
		if d.IsDir() {
			return os.MkdirAll(target, 0o755)
		}
		data, err := extFS.ReadFile(path)
		if err != nil {
			return err
		}
		if err := os.MkdirAll(filepath.Dir(target), 0o755); err != nil {
			return err
		}
		return os.WriteFile(target, data, 0o644)
	}); err != nil {
		return "", errno.Wrap(errno.CodeStoreFailed, "释放浏览器扩展失败", err)
	}
	if err := os.WriteFile(marker, []byte(seedVersion), 0o644); err != nil {
		return "", errno.Wrap(errno.CodeStoreFailed, "写入扩展版本标记失败", err)
	}
	return dest, nil
}

// InjectBridgeToken 把鉴权 token 写入扩展 offscreen.js（替换占位符；每次启动可调用）。
func InjectBridgeToken(extDir, token string) error {
	extDir = strings.TrimSpace(extDir)
	token = strings.TrimSpace(token)
	if extDir == "" || token == "" {
		return errno.New(errno.CodeInvalidArg, "扩展目录或 token 为空", "")
	}
	path := filepath.Join(extDir, "offscreen.js")
	raw, err := os.ReadFile(path)
	if err != nil {
		return errno.Wrap(errno.CodeStoreFailed, "读取 offscreen.js 失败", err)
	}
	body := string(raw)
	if !strings.Contains(body, BridgeTokenPlaceholder) && !strings.Contains(body, "BRIDGE_TOKEN") {
		// 旧版扩展无占位符：在 BRIDGE_URL 行注入 query
		body = strings.Replace(body,
			`var BRIDGE_URL = "ws://127.0.0.1:18765/ext";`,
			`var BRIDGE_TOKEN = "`+token+`";`+"\n"+
				`  var BRIDGE_URL = "ws://127.0.0.1:18765/ext?token=" + encodeURIComponent(BRIDGE_TOKEN);`,
			1)
	} else {
		// 先还原到占位符再写入，避免重复叠加
		if i := strings.Index(body, `var BRIDGE_TOKEN = "`); i >= 0 {
			j := strings.Index(body[i+len(`var BRIDGE_TOKEN = "`):], `"`)
			if j >= 0 {
				old := body[i : i+len(`var BRIDGE_TOKEN = "`)+j+1]
				body = strings.Replace(body, old, `var BRIDGE_TOKEN = "`+BridgeTokenPlaceholder+`"`, 1)
			}
		}
		body = strings.ReplaceAll(body, BridgeTokenPlaceholder, token)
	}
	if err := os.WriteFile(path, []byte(body), 0o644); err != nil {
		return errno.Wrap(errno.CodeStoreFailed, "写入 offscreen.js token 失败", err)
	}
	return nil
}
