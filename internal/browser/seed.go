package browser

import (
	"embed"
	"io/fs"
	"os"
	"path/filepath"

	"WWorkbench/internal/errno"
)

//go:embed all:ext
var extFS embed.FS

const seedMarker = ".ww-browser-ext-version"
const seedVersion = "0.3.8"

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
