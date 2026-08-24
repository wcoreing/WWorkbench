package environment

import (
	"os"
	"path/filepath"
	"strings"
)

// workbenchEnvDir 确保并返回本机 ~/.wworkbench 目录（仅本机 toolchain 落盘用）。
func workbenchEnvDir() (string, error) {
	home, err := os.UserHomeDir()
	if err != nil {
		return "", err
	}
	dir := filepath.Join(home, ".wworkbench")
	if err := os.MkdirAll(dir, 0o755); err != nil {
		return "", err
	}
	return dir, nil
}

// applyWorkbenchEnvFile 经当前 Runner 写入 ~/.wworkbench/<file>，并确保登录 shell 加载（兼容 SSH）。
func applyWorkbenchEnvFile(marker, envFileName, envContent string) error {
	if isWindows() {
		return nil
	}
	if strings.Contains(envFileName, "/") || strings.Contains(envFileName, "..") {
		return errInvalidVersion
	}
	if !strings.HasSuffix(envContent, "\n") {
		envContent += "\n"
	}
	script := `mkdir -p "$HOME/.wworkbench" && cat > "$HOME/.wworkbench/` + envFileName + `" <<'WW_ENV_EOF'
` + envContent + `WW_ENV_EOF`
	if _, err := runLoginShell(script); err != nil {
		return err
	}
	loader := `[ -f "$HOME/.wworkbench/` + envFileName + `" ] && . "$HOME/.wworkbench/` + envFileName + `"`
	return appendShellSnippet("", marker, loader)
}

// syncGoShellEnv 将 goenv 环境写入 ~/.wworkbench/go.env。
func syncGoShellEnv() error {
	ensureGoenvRCFile()
	return applyWorkbenchEnvFile("# wworkbench-go", "go.env", goenvShellBlock())
}

// ensureGoenvRCFile 确保 ~/.goenvrc 含 GOENV_PATH_ORDER=front（经 Runner）。
func ensureGoenvRCFile() {
	if isWindows() {
		return
	}
	_, _ = runLoginShell(`
f="$HOME/.goenvrc"
if [ -f "$f" ] && grep -qF 'GOENV_PATH_ORDER' "$f" 2>/dev/null; then
  exit 0
fi
printf 'export GOENV_PATH_ORDER=front\n' >> "$f"
`)
}

// LocalTerminalInitScript 返回内置终端启动脚本（先加载 ~/.wworkbench/*.env）。
// zsh 默认 NOMATCH：目录下无 *.env 时裸 glob 会直接失败并结束会话，故先开 nullglob。
func LocalTerminalInitScript(shell string) string {
	sh := filepath.Base(shell)
	if sh == "" {
		sh = "zsh"
	}
	return `setopt NULL_GLOB 2>/dev/null || true; shopt -s nullglob 2>/dev/null || true; for f in "$HOME"/.wworkbench/*.env; do [ -f "$f" ] && . "$f"; done; exec -l ` + sh
}

// syncNodeShellEnv 将当前 nvm Node 路径写入 ~/.wworkbench/node.env。
func syncNodeShellEnv() error {
	if !hasNvm() {
		return nil
	}
	binDir := strings.TrimSpace(runLoginShellOK(nvmScript() + ` && dirname "$(command -v node 2>/dev/null)"`))
	if binDir == "" || binDir == "." {
		return nil
	}
	content := `export PATH="` + shellQuotePath(binDir) + `:$PATH"`
	return applyWorkbenchEnvFile("# wworkbench-node", "node.env", content)
}

// shellQuotePath 转义路径以便嵌入双引号字符串。
func shellQuotePath(path string) string {
	r := strings.NewReplacer(`\`, `\\`, `"`, `\"`, `$`, `\$`, "`", "\\`")
	return r.Replace(path)
}
