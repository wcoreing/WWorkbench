package notebook

import (
	"embed"
	"io/fs"
	"os"
	"path/filepath"
	"strings"
)

//go:embed all:viewtemplate
var viewTemplateFiles embed.FS

const viewTemplateToken = "__WWB_NOTE_TITLE__"

// ensureViewTemplate 把初始 Vue 工程补进 view/。已有文件不覆盖。
func ensureViewTemplate(viewAbs, title string) (bool, error) {
	if err := os.MkdirAll(viewAbs, 0o700); err != nil {
		return false, errnoNotebook("创建 Vue 工程失败")
	}
	title = htmlText(strings.TrimSpace(title))
	if title == "" {
		title = "笔记"
	}
	seeded := false
	err := fs.WalkDir(viewTemplateFiles, "viewtemplate", func(path string, d fs.DirEntry, err error) error {
		if err != nil {
			return err
		}
		rel := strings.TrimPrefix(path, "viewtemplate")
		rel = strings.TrimPrefix(rel, "/")
		if rel == "" {
			return nil
		}
		dest := filepath.Join(viewAbs, filepath.FromSlash(rel))
		if d.IsDir() {
			return os.MkdirAll(dest, 0o700)
		}
		if _, statErr := os.Stat(dest); statErr == nil {
			return nil
		}
		raw, readErr := viewTemplateFiles.ReadFile(path)
		if readErr != nil {
			return errnoNotebook("初始模板缺失")
		}
		body := strings.ReplaceAll(string(raw), viewTemplateToken, title)
		if writeErr := os.WriteFile(dest, []byte(body), 0o600); writeErr != nil {
			return errnoNotebook("写入初始模板失败")
		}
		seeded = true
		return nil
	})
	if err != nil {
		return false, err
	}
	return seeded, nil
}
