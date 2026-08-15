package environment

import (
	"os"
	"path/filepath"
	"strings"
	"time"

	"WWorkbench/internal/errno"
)

const (
	managerNvm    = "nvm"
	managerGoenv  = "goenv"
	managerBrew   = "brew"
	managerSdkman = "sdkman"
)

// InstallManager 安装语言对应的版本管理工具。
func (m *Manager) InstallManager(lang string) error {
	emit := m.installEmitter(lang)
	if isWindows() {
		switch lang {
		case langGo, langJava, langPHP:
			emit("WWorkbench 已内置 " + lang + " 版本管理，请直接安装版本即可")
			return nil
		case langNode:
			err := windowsManagerUnsupported(lang)
			emit(err.Error())
			return err
		}
	}
	emit("开始安装版本管理工具…")
	var err error
	switch lang {
	case langNode:
		err = installNvmManager(emit)
	case langGo:
		err = installGoenvManager(emit)
	case langPHP:
		err = installBrewManager(emit)
	case langJava:
		err = installSdkmanManager(emit)
	default:
		return errno.New(errno.CodeInvalidArg, "未知语言运行时", lang)
	}
	if err != nil {
		emit("安装失败")
		return errno.Wrap(errno.CodeConnFailed, "安装版本管理工具失败", err)
	}
	emit("版本管理工具安装完成，请重新打开管理窗口")
	return nil
}

// hasNvm 是否已安装 nvm（含 Homebrew 安装）。
func hasNvm() bool {
	if fileExists("~/.nvm/nvm.sh") {
		return true
	}
	prefix := brewPrefix("nvm")
	return prefix != "" && fileExists(filepath.Join(prefix, "nvm.sh"))
}

// hasGoenv 是否已安装 goenv（含 Homebrew 安装）。
func hasGoenv() bool {
	if fileExists("~/.goenv/bin/goenv") {
		return true
	}
	prefix := brewPrefix("goenv")
	return prefix != "" && fileExists(filepath.Join(prefix, "bin", "goenv"))
}

// hasBrew 是否已安装 Homebrew。
func hasBrew() bool {
	_, err := execLookPath("brew")
	return err == nil
}

// hasSdkman 是否已安装 sdkman。
func hasSdkman() bool {
	return fileExists("~/.sdkman/bin/sdkman-init.sh")
}

// managerLabelGo 返回 Go 版本管理工具展示名。
func managerLabelGo() string {
	if hasBrew() {
		return "Homebrew · goenv"
	}
	return "goenv"
}

// managerLabelNvm 返回 Node 版本管理工具展示名。
func managerLabelNvm() string {
	if hasBrew() {
		return "Homebrew · nvm"
	}
	return "nvm"
}

func installNvmManager(emit func(string)) error {
	if hasNvm() {
		emit("nvm 已存在，跳过")
		return nil
	}
	if !hasBrew() {
		emit("未检测到 Homebrew，尝试安装…")
		if err := ensureBrew(emit); err != nil {
			emit("Homebrew 安装失败，改用官方脚本")
		}
	}
	if hasBrew() {
		if err := brewInstall("nvm", emit); err != nil {
			return err
		}
		_ = runLoginShellOK(`mkdir -p "$HOME/.nvm"`)
		if err := appendShellSnippet(shellProfilePath(), "# wworkbench-nvm", nvmShellBlock()); err != nil {
			emit("写入 shell 配置失败: " + err.Error())
		}
		return nil
	}
	emit("使用官方脚本安装 nvm…")
	_, err := runLoginShellStream(
		`curl -fsSL https://raw.githubusercontent.com/nvm-sh/nvm/v0.40.2/install.sh | bash`,
		15*time.Minute,
		emit,
	)
	return err
}

// installGoenvManager 安装 goenv，优先 Homebrew。
func installGoenvManager(emit func(string)) error {
	if hasGoenv() {
		emit("goenv 已存在，跳过")
		ensureGoenvRC(emit)
		return nil
	}
	if !hasBrew() {
		emit("未检测到 Homebrew，尝试安装…")
		if err := ensureBrew(emit); err != nil {
			emit("Homebrew 安装失败，改用源码编译")
		}
	}
	if hasBrew() {
		if err := brewInstall("goenv", emit); err != nil {
			return err
		}
		if err := appendShellSnippet(shellProfilePath(), "# wworkbench-goenv", goenvShellBlock()); err != nil {
			emit("写入 shell 配置失败: " + err.Error())
		}
		return nil
	}
	home, err := os.UserHomeDir()
	if err != nil {
		return err
	}
	goenvRoot := filepath.Join(home, ".goenv")
	if !fileExists(goenvRoot) {
		emit("克隆 goenv 仓库…")
		_, err = runLoginShellStream(
			`git clone https://github.com/go-nv/goenv.git "`+goenvRoot+`"`,
			15*time.Minute,
			emit,
		)
		if err != nil {
			return err
		}
	}
	emit("编译 goenv（跳过测试）…")
	_, err = runLoginShellStream(`cd "`+goenvRoot+`" && src/configure && make -C src`, 10*time.Minute, emit)
	if err != nil {
		return err
	}
	return appendShellSnippet(shellProfilePath(), "# wworkbench-goenv", goenvShellBlock())
}

// nvmShellBlock 返回 nvm 初始化脚本块。
func nvmShellBlock() string {
	prefix := brewPrefix("nvm")
	if prefix != "" {
		nvmSh := filepath.Join(prefix, "nvm.sh")
		return `export NVM_DIR="$HOME/.nvm"
mkdir -p "$NVM_DIR"
[ -s "` + nvmSh + `" ] && . "` + nvmSh + `"`
	}
	return `export NVM_DIR="$HOME/.nvm"
[ -s "$NVM_DIR/nvm.sh" ] && . "$NVM_DIR/nvm.sh"`
}

// goenvShellBlock 返回 goenv 初始化脚本块。
func goenvShellBlock() string {
	order := "export GOENV_PATH_ORDER=front"
	if prefix := brewPrefix("goenv"); prefix != "" {
		bin := filepath.Join(prefix, "bin")
		return `export GOENV_ROOT="` + prefix + `"
` + order + `
export PATH="` + bin + `:$PATH"
eval "$(goenv init -)"`
	}
	return `export GOENV_ROOT="$HOME/.goenv"
` + order + `
export PATH="$GOENV_ROOT/bin:$PATH"
eval "$(goenv init -)"`
}

// ensureGoenvRC 确保 goenv 优先于系统 go。
func ensureGoenvRC(emit func(string)) {
	ensureGoenvRCFile()
	if emit != nil {
		path := expandHome("~/.goenvrc")
		data, _ := os.ReadFile(path)
		if !strings.Contains(string(data), "GOENV_PATH_ORDER") {
			emit("已配置 ~/.goenvrc：GOENV_PATH_ORDER=front")
		}
	}
}

// installBrewManager 安装 Homebrew。
func installBrewManager(emit func(string)) error {
	if hasBrew() {
		emit("Homebrew 已存在，跳过")
		return nil
	}
	emit("安装 Homebrew（若提示输入密码，请在终端完成）…")
	_, err := runLoginShellStream(
		`NONINTERACTIVE=1 /bin/bash -c "$(curl -fsSL https://raw.githubusercontent.com/Homebrew/install/HEAD/install.sh)"`,
		30*time.Minute,
		emit,
	)
	if err != nil {
		emit("自动安装可能失败，可手动执行: /bin/bash -c \"$(curl -fsSL https://raw.githubusercontent.com/Homebrew/install/HEAD/install.sh)\"")
	}
	return err
}

// installSdkmanManager 安装 sdkman（Java 无 brew formula，保留官方脚本）。
// macOS 自带 Bash 3.2，而 sdkman 安装脚本要求 Bash ≥4，须先用 Homebrew bash。
func installSdkmanManager(emit func(string)) error {
	if hasSdkman() {
		emit("sdkman 已存在，跳过")
		return nil
	}
	bash, err := ensureBash4(emit)
	if err != nil {
		return err
	}
	emit("下载并安装 sdkman（使用 " + bash + "）…")
	script := `set -euo pipefail
tmp="$(mktemp -t sdkman-install.XXXXXX)"
trap 'rm -f "$tmp"' EXIT
curl -fsSL https://get.sdkman.io -o "$tmp"
"` + shellQuotePath(bash) + `" "$tmp"`
	_, err = runLoginShellStream(script, 15*time.Minute, emit)
	if err != nil {
		emit("若仍失败，可在终端执行: brew install bash && curl -fsSL https://get.sdkman.io | $(brew --prefix)/bin/bash")
		return err
	}
	if !hasSdkman() {
		return errno.New(errno.CodeConnFailed, "sdkman 安装脚本已执行，但未检测到 ~/.sdkman；请检查终端日志或代理", "")
	}
	return nil
}

// ensureBash4 返回 Bash ≥4 路径；缺失时尝试 brew install bash。
func ensureBash4(emit func(string)) (string, error) {
	if p := modernBashPath(); p != "" {
		return p, nil
	}
	if !hasBrew() {
		return "", errno.New(errno.CodeInvalidArg,
			"sdkman 需要 Bash 4+（macOS 自带为 3.2）。请先安装 Homebrew，再执行: brew install bash", "")
	}
	emit("sdkman 需要 Bash 4+，正在 brew install bash…")
	_, err := runLoginShellStream(`brew install bash`, 20*time.Minute, emit)
	if err != nil {
		return "", errno.Wrap(errno.CodeConnFailed,
			"brew install bash 失败（请检查 Homebrew 目录权限，或终端执行: brew install bash）", err)
	}
	if p := modernBashPath(); p != "" {
		return p, nil
	}
	return "", errno.New(errno.CodeConnFailed,
		"已尝试 brew install bash，仍未找到 Bash 4+（预期路径: /opt/homebrew/bin/bash 或 /usr/local/bin/bash）", "")
}

// modernBashPath 返回已安装的 Bash ≥4 可执行文件。
func modernBashPath() string {
	for _, p := range []string{"/opt/homebrew/bin/bash", "/usr/local/bin/bash"} {
		if !fileExists(p) {
			continue
		}
		out := strings.TrimSpace(runLoginShellOK(`"` + shellQuotePath(p) + `" -c 'echo ${BASH_VERSINFO[0]}'`))
		major := 0
		for _, c := range out {
			if c < '0' || c > '9' {
				break
			}
			major = major*10 + int(c-'0')
		}
		if major >= 4 {
			return p
		}
	}
	return ""
}

// shellProfilePath 返回当前用户 shell 配置文件路径。
func shellProfilePath() string {
	shell := os.Getenv("SHELL")
	if strings.Contains(shell, "zsh") {
		return expandHome("~/.zshrc")
	}
	return expandHome("~/.bash_profile")
}

// appendShellSnippet 向 shell 配置追加初始化片段（幂等）。
func appendShellSnippet(path, marker, snippet string) error {
	data, err := os.ReadFile(path)
	if err != nil && !os.IsNotExist(err) {
		return err
	}
	content := string(data)
	if strings.Contains(content, marker) {
		return nil
	}
	block := "\n" + marker + "\n" + snippet + "\n"
	f, err := os.OpenFile(path, os.O_APPEND|os.O_CREATE|os.O_WRONLY, 0o644)
	if err != nil {
		return err
	}
	defer f.Close()
	_, err = f.WriteString(block)
	return err
}
