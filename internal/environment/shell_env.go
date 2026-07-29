package environment

import (
	"os"
	"path/filepath"
	"strings"
)

// workbenchEnvDir 确保并返回 ~/.wworkbench 目录。
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

// applyWorkbenchEnvFile 写入 env 文件并确保 shell 加载。
func applyWorkbenchEnvFile(marker, envFileName, envContent string) error {
	dir, err := workbenchEnvDir()
	if err != nil {
		return err
	}
	if !strings.HasSuffix(envContent, "\n") {
		envContent += "\n"
	}
	if err := os.WriteFile(filepath.Join(dir, envFileName), []byte(envContent), 0o644); err != nil {
		return err
	}
	loader := `[ -f "$HOME/.wworkbench/` + envFileName + `" ] && . "$HOME/.wworkbench/` + envFileName + `"`
	return appendShellSnippet(shellProfilePath(), marker, loader)
}

// syncGoShellEnv 将 goenv 环境写入 ~/.wworkbench/go.env。
func syncGoShellEnv() error {
	ensureGoenvRCFile()
	return applyWorkbenchEnvFile("# wworkbench-go", "go.env", goenvShellBlock())
}

// ensureGoenvRCFile 确保 ~/.goenvrc 含 GOENV_PATH_ORDER=front。
func ensureGoenvRCFile() {
	path := expandHome("~/.goenvrc")
	data, err := os.ReadFile(path)
	content := ""
	if err == nil {
		content = string(data)
	} else if !os.IsNotExist(err) {
		return
	}
	if strings.Contains(content, "GOENV_PATH_ORDER") {
		return
	}
	f, err := os.OpenFile(path, os.O_APPEND|os.O_CREATE|os.O_WRONLY, 0o644)
	if err != nil {
		return
	}
	defer f.Close()
	_, _ = f.WriteString("export GOENV_PATH_ORDER=front\n")
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
