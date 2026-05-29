package environment

import (
	"os"
	"path/filepath"
	"strings"
	"time"

	"WNavicat/internal/errno"
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
		if err := appendShellSnippet(shellProfilePath(), "# wnavicat-nvm", nvmShellBlock()); err != nil {
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
		if err := appendShellSnippet(shellProfilePath(), "# wnavicat-goenv", goenvShellBlock()); err != nil {
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
	return appendShellSnippet(shellProfilePath(), "# wnavicat-goenv", goenvShellBlock())
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
func installSdkmanManager(emit func(string)) error {
	if hasSdkman() {
		emit("sdkman 已存在，跳过")
		return nil
	}
	emit("下载并安装 sdkman…")
	_, err := runLoginShellStream(
		`curl -fsSL https://get.sdkman.io | bash`,
		15*time.Minute,
		emit,
	)
	return err
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
