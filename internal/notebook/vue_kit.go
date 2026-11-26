package notebook

import (
	"context"
	"embed"
	"os"
	"os/exec"
	"path/filepath"
)

//go:embed vuekit/package.json vuekit/package-lock.json vuekit/vite.config.mjs
var vueKitFiles embed.FS

// ensureVueKit 把共用的 Vite / Vue 放到数据目录。每个笔记的 view 不再各自安装依赖。
func (s *Service) ensureVueKit(ctx context.Context) (string, error) {
	if _, err := exec.LookPath("npm"); err != nil {
		return "", errnoNotebook("本机没有 npm。共用的 Vue 构建需要 Node.js")
	}
	kitDir := filepath.Join(s.dataDir, vueKitDirName)
	if err := os.MkdirAll(kitDir, 0o700); err != nil {
		return "", errnoNotebook("创建共用构建目录失败")
	}
	changed, err := syncVueKitFiles(kitDir)
	if err != nil {
		return "", err
	}
	viteBin := filepath.Join(kitDir, "node_modules", ".bin", "vite")
	if changed {
		_ = os.RemoveAll(filepath.Join(kitDir, "node_modules"))
	}
	if st, err := os.Stat(viteBin); err != nil || st.IsDir() {
		installCtx, cancel := context.WithTimeout(ctx, vueInstallWait)
		defer cancel()
		cmd := exec.CommandContext(installCtx, "npm", "ci", "--no-audit", "--no-fund")
		cmd.Dir = kitDir
		cmd.Env = os.Environ()
		out, err := cmd.CombinedOutput()
		if err != nil {
			return "", errnoNotebook("安装共用 Vue 构建失败：" + trimBuildLog(string(out)))
		}
	}
	return kitDir, nil
}

func syncVueKitFiles(kitDir string) (bool, error) {
	changed := false
	for _, name := range []string{"package.json", "package-lock.json", "vite.config.mjs"} {
		raw, err := vueKitFiles.ReadFile("vuekit/" + name)
		if err != nil {
			return false, errnoNotebook("共用构建文件缺失")
		}
		dest := filepath.Join(kitDir, name)
		old, readErr := os.ReadFile(dest)
		if readErr != nil || string(old) != string(raw) {
			if err := os.WriteFile(dest, raw, 0o600); err != nil {
				return false, errnoNotebook("写入共用构建文件失败")
			}
			changed = true
		}
	}
	return changed, nil
}
