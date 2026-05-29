package environment

import (
	"os"
	"path/filepath"
	"strings"
)

// wnavicatEnvDir 确保并返回 ~/.wnavicat 目录。
func wnavicatEnvDir() (string, error) {
	home, err := os.UserHomeDir()
	if err != nil {
		return "", err
	}
	dir := filepath.Join(home, ".wnavicat")
	if err := os.MkdirAll(dir, 0o755); err != nil {
		return "", err
	}
	return dir, nil
}

// applyWNavicatEnvFile 写入 env 文件并确保 shell 加载。
func applyWNavicatEnvFile(marker, envFileName, envContent string) error {
	dir, err := wnavicatEnvDir()
	if err != nil {
		return err
	}
	if !strings.HasSuffix(envContent, "\n") {
		envContent += "\n"
	}
	if err := os.WriteFile(filepath.Join(dir, envFileName), []byte(envContent), 0o644); err != nil {
		return err
	}
	loader := `[ -f "$HOME/.wnavicat/` + envFileName + `" ] && . "$HOME/.wnavicat/` + envFileName + `"`
	return appendShellSnippet(shellProfilePath(), marker, loader)
}

// syncGoShellEnv 将 goenv 环境写入 ~/.wnavicat/go.env。
func syncGoShellEnv() error {
	ensureGoenvRCFile()
	return applyWNavicatEnvFile("# wnavicat-go", "go.env", goenvShellBlock())
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

// LocalTerminalInitScript 返回内置终端启动脚本（先加载 ~/.wnavicat/*.env）。
func LocalTerminalInitScript(shell string) string {
	sh := filepath.Base(shell)
	if sh == "" {
		sh = "zsh"
	}
	return `for f in "$HOME"/.wnavicat/*.env; do [ -f "$f" ] && . "$f"; done; exec -l ` + sh
}

// syncNodeShellEnv 将当前 nvm Node 路径写入 ~/.wnavicat/node.env。
func syncNodeShellEnv() error {
	if !hasNvm() {
		return nil
	}
	binDir := strings.TrimSpace(runLoginShellOK(nvmScript() + ` && dirname "$(command -v node 2>/dev/null)"`))
	if binDir == "" || binDir == "." {
		return nil
	}
	content := `export PATH="` + shellQuotePath(binDir) + `:$PATH"`
	return applyWNavicatEnvFile("# wnavicat-node", "node.env", content)
}

// shellQuotePath 转义路径以便嵌入双引号字符串。
func shellQuotePath(path string) string {
	r := strings.NewReplacer(`\`, `\\`, `"`, `\"`, `$`, `\$`, "`", "\\`")
	return r.Replace(path)
}
