package environment

import (
	"os"
	"path/filepath"
	"regexp"
	"strings"
	"time"

	"WNavicat/internal/errno"
	"WNavicat/internal/model"
)

var goVersionRe = regexp.MustCompile(`go([0-9]+\.[0-9]+(?:\.[0-9]+)?)`)

// goenvScript 返回 goenv 初始化脚本前缀。
func goenvScript() string {
	order := `export GOENV_PATH_ORDER=front`
	if prefix := brewPrefix("goenv"); prefix != "" {
		bin := filepath.Join(prefix, "bin")
		if fileExists(filepath.Join(bin, "goenv")) {
			return `export GOENV_ROOT="` + prefix + `" && ` + order + ` && export PATH="` + bin + `:$PATH" && eval "$(goenv init -)"`
		}
	}
	return `export GOENV_ROOT="$HOME/.goenv" && ` + order + ` && export PATH="$GOENV_ROOT/bin:$PATH" && eval "$(goenv init -)"`
}

// detectGo 检测 Go 运行时。
func detectGo() model.RuntimeDO {
	row := model.RuntimeDO{Lang: langGo, Label: "Go", ManagerLabel: managerLabelGo()}
	if hasGoenv() {
		row.Manager = managerGoenv
		row.CanInstall = true
		ver := strings.TrimSpace(runLoginShellOK(goenvScript() + ` && goenv version-name`))
		row.Binary = strings.TrimSpace(runLoginShellOK(goenvScript() + ` && goenv which go 2>/dev/null`))
		if ver != "" && ver != "system" {
			row.Version = ver
			row.Available = true
			if row.Binary == "" {
				row.Binary = strings.TrimSpace(runLoginShellOK(goenvScript() + ` && command -v go`))
			}
			return row
		}
		fillSystemGo(&row)
		return row
	}
	row.Manager = "system"
	row.NeedsManager = true
	row.CanInstallManager = true
	fillSystemGo(&row)
	return row
}

// fillSystemGo 用系统 go 填充版本信息。
func fillSystemGo(row *model.RuntimeDO) {
	bin, err := execLookPath("go")
	if err != nil {
		return
	}
	if row.Binary == "" {
		row.Binary = bin
	}
	out := runLoginShellOK(bin + ` version`)
	if m := goVersionRe.FindStringSubmatch(out); len(m) > 1 {
		row.Version = m[1]
	}
	row.Available = row.Version != ""
}

// listGoVersions 列出 Go 可切换版本（goenv catalog）。
func listGoVersions() []model.RuntimeVersionDO {
	return listGoCatalogVersions()
}

// useGoVersion 切换 Go 版本。
func useGoVersion(version string) error {
	if hasGoenv() {
		ver, err := quoteShellVersion(version)
		if err != nil {
			return err
		}
		_, err = runLoginShell(goenvScript() + ` && goenv global ` + ver)
		if err != nil {
			return err
		}
		if err := syncGoShellEnv(); err != nil {
			return errno.Wrap(errno.CodeConnFailed, "已切换但写入 shell 配置失败", err)
		}
		return nil
	}
	return errno.New(errno.CodeInvalidArg, "未检测到 goenv，请先安装 goenv", version)
}

// installGoVersion 安装 Go 版本。
func installGoVersion(version string, emit func(string)) error {
	if !hasGoenv() {
		return errno.New(errno.CodeInvalidArg, "未检测到 goenv，请先安装 goenv", version)
	}
	ver, err := quoteShellVersion(version)
	if err != nil {
		return err
	}
	emit("执行 goenv install -q " + ver + "（使用国内镜像）")
	_, err = runLoginShellStream(goenvInstallScript(ver), 20*time.Minute, filterEmit(emit))
	return err
}

// goenvInstallScript 返回 goenv 安装命令（静默 + 镜像）。
func goenvInstallScript(version string) string {
	return goenvScript() + ` && export GO_BUILD_MIRROR_URL=https://mirrors.aliyun.com/golang && goenv install -q -s ` + version
}

// listPHPVersions 列出 PHP 版本（Homebrew catalog + 已安装状态）。
func listPHPVersions() []model.RuntimeVersionDO {
	if hasBrew() {
		if catalog := listPHPCatalogVersions(); len(catalog) > 0 {
			return catalog
		}
	}
	current, _ := detectPHPFromBrew()
	if current == "" {
		current = detectPHP().Version
	}
	if current != "" {
		return []model.RuntimeVersionDO{{Version: current, Installed: true, Active: true}}
	}
	return nil
}

// detectPHP 检测 PHP 运行时。
func detectPHP() model.RuntimeDO {
	row := model.RuntimeDO{Lang: langPHP, Label: "PHP", ManagerLabel: "Homebrew"}
	if ver, bin := detectPHPFromBrew(); ver != "" {
		row.Manager = managerBrew
		row.CanInstall = hasBrew()
		row.Version = ver
		row.Binary = bin
		row.Available = true
		return row
	}
	if hasBrew() {
		row.CanInstall = true
	}
	bin, err := execLookPath("php")
	if err != nil {
		if !hasBrew() {
			row.Manager = "system"
			row.NeedsManager = true
			row.CanInstallManager = true
		} else {
			row.Manager = managerBrew
		}
		return row
	}
	row.Manager = "system"
	row.Binary = bin
	out := runLoginShellOK(bin + ` -r 'echo PHP_VERSION;'`)
	row.Version = strings.TrimSpace(out)
	row.Available = row.Version != ""
	return row
}

// usePHPVersion 切换 PHP 版本（brew link）。
func usePHPVersion(version string) error {
	brew, err := execLookPath("brew")
	if err != nil {
		return err
	}
	formula, err := phpBrewFormula(version)
	if err != nil {
		return err
	}
	if phpInstalledFormula(version) == "" {
		installed := brewPHPInstalledMap()
		if installed[formula] == "" {
			return errno.New(errno.CodeInvalidArg, "该 PHP 版本尚未安装，请先安装", version)
		}
	}
	qf := quoteBrewFormula(formula)
	out, err := runLoginShell(phpUnlinkScript(brew) + brew + ` link --force --overwrite ` + qf)
	if err != nil {
		msg := strings.TrimSpace(out)
		if msg == "" {
			msg = err.Error()
		}
		return errno.New(errno.CodeConnFailed, "切换 PHP 版本失败: "+msg, version)
	}
	if ver, _ := detectPHPFromBrew(); ver == "" {
		return errno.New(errno.CodeConnFailed, "brew link 完成但未检测到 php 链接", version)
	}
	if err := syncPhpShellEnv(formula); err != nil {
		return errno.Wrap(errno.CodeConnFailed, "已 link 但写入 shell 配置失败", err)
	}
	return nil
}

// installPHPVersion 安装 PHP 版本（brew install）。
func installPHPVersion(version string, emit func(string)) error {
	if !hasBrew() {
		return errno.New(errno.CodeInvalidArg, "未检测到 Homebrew", version)
	}
	formula, err := phpBrewFormula(version)
	if err != nil {
		return err
	}
	return brewInstallFormula(formula, emit)
}

// sdkmanScript 返回 sdkman 初始化脚本。
func sdkmanScript() string {
	home, _ := os.UserHomeDir()
	return `source "` + filepath.Join(home, ".sdkman", "bin", "sdkman-init.sh") + `"`
}

// detectJava 检测 Java 运行时。
func detectJava() model.RuntimeDO {
	row := model.RuntimeDO{Lang: langJava, Label: "Java", ManagerLabel: "sdkman"}
	if hasSdkman() {
		row.Manager = managerSdkman
		row.CanInstall = true
		cur := runLoginShellOK(sdkmanScript() + ` && sdk current java`)
		parts := strings.Fields(strings.TrimSpace(cur))
		if len(parts) > 0 {
			row.Version = parts[len(parts)-1]
		}
		if row.Version != "" && row.Version != "none" {
			row.Binary = runLoginShellOK(sdkmanScript() + ` && sdk home java ` + row.Version)
			row.Available = true
			return row
		}
		fillSystemJava(&row)
		return row
	}
	row.Manager = "system"
	row.NeedsManager = true
	row.CanInstallManager = true
	fillSystemJava(&row)
	return row
}

// fillSystemJava 用系统 java 填充版本信息。
func fillSystemJava(row *model.RuntimeDO) {
	bin, err := execLookPath("java")
	if err != nil {
		return
	}
	row.Binary = bin
	out := runLoginShellOK(bin + ` -version 2>&1`)
	if idx := strings.Index(out, `"`); idx >= 0 {
		rest := out[idx+1:]
		if end := strings.Index(rest, `"`); end > 0 {
			row.Version = rest[:end]
		}
	}
	row.Available = row.Version != ""
}

// listJavaVersions 列出 Java 可切换版本（sdkman catalog）。
func listJavaVersions() []model.RuntimeVersionDO {
	return listJavaCatalogVersions()
}

// useJavaVersion 切换 Java 版本。
func useJavaVersion(version string) error {
	if !hasSdkman() {
		return errno.New(errno.CodeInvalidArg, "未检测到 sdkman，请先安装 sdkman", version)
	}
	ver, err := quoteShellVersion(version)
	if err != nil {
		return err
	}
	_, err = runLoginShell(sdkmanScript() + ` && sdk default java ` + ver)
	return err
}

// installJavaVersion 安装 Java 版本。
func installJavaVersion(version string, emit func(string)) error {
	if !hasSdkman() {
		return errno.New(errno.CodeInvalidArg, "未检测到 sdkman，请先安装 sdkman", version)
	}
	ver, err := quoteShellVersion(version)
	if err != nil {
		return err
	}
	emit("执行 sdk install java " + ver)
	_, err = runLoginShellStream(sdkmanScript()+` && sdk install java `+ver, 20*time.Minute, filterEmit(emit))
	return err
}

// uninstallGoVersion 卸载 Go 版本。
func uninstallGoVersion(version string, emit func(string)) error {
	if !hasGoenv() {
		return errno.New(errno.CodeInvalidArg, "未检测到 goenv", version)
	}
	ver, err := quoteShellVersion(version)
	if err != nil {
		return err
	}
	emit("执行 goenv uninstall -f " + ver)
	_, err = runLoginShellStream(goenvScript()+` && goenv uninstall -f `+ver, 10*time.Minute, filterEmit(emit))
	return err
}

// uninstallJavaVersion 卸载 Java 版本。
func uninstallJavaVersion(identifier string, emit func(string)) error {
	if !hasSdkman() {
		return errno.New(errno.CodeInvalidArg, "未检测到 sdkman", identifier)
	}
	ver, err := quoteShellVersion(identifier)
	if err != nil {
		return err
	}
	emit("执行 sdk uninstall java " + ver)
	_, err = runLoginShellStream(sdkmanScript()+` && sdk uninstall java `+ver, 10*time.Minute, filterEmit(emit))
	return err
}
