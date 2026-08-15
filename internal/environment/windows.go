package environment

import (
	"os"
	"os/exec"
	"path/filepath"
	"regexp"
	"strings"

	"WWorkbench/internal/errno"
	"WWorkbench/internal/model"
)

var nvmWinCurrentRe = regexp.MustCompile(`(?i)currently using.*?v?([0-9]+\.[0-9]+\.[0-9]+)`)

// hasNvmWindows 是否已安装 nvm-windows。
func hasNvmWindows() bool {
	if !isWindows() {
		return false
	}
	if p := strings.TrimSpace(os.Getenv("NVM_HOME")); p != "" {
		if fileExists(filepath.Join(p, "nvm.exe")) {
			return true
		}
	}
	home, _ := os.UserHomeDir()
	candidates := []string{
		`C:\nvm4w`,
		filepath.Join(os.Getenv("ProgramFiles"), "nvm"),
		filepath.Join(home, "AppData", "Roaming", "nvm"),
	}
	for _, dir := range candidates {
		if dir != "" && fileExists(filepath.Join(dir, "nvm.exe")) {
			return true
		}
	}
	_, err := exec.LookPath("nvm")
	return err == nil
}

// nvmWindowsExe 返回 nvm-windows 可执行路径。
func nvmWindowsExe() string {
	if p := strings.TrimSpace(os.Getenv("NVM_HOME")); p != "" {
		exe := filepath.Join(p, "nvm.exe")
		if fileExists(exe) {
			return exe
		}
	}
	if p, err := exec.LookPath("nvm"); err == nil {
		return p
	}
	home, _ := os.UserHomeDir()
	for _, dir := range []string{`C:\nvm4w`, filepath.Join(home, "AppData", "Roaming", "nvm")} {
		exe := filepath.Join(dir, "nvm.exe")
		if fileExists(exe) {
			return exe
		}
	}
	return ""
}

// detectNodeWindows 检测 Windows 上的 Node（nvm-windows 或系统 PATH）。
func detectNodeWindows() model.RuntimeDO {
	row := model.RuntimeDO{Lang: langNode, Label: "Node.js"}
	if hasNvmWindows() {
		row.Manager = "nvm-windows"
		row.ManagerLabel = "nvm-windows"
		row.CanInstall = true
		nvm := nvmWindowsExe()
		if nvm != "" {
			out := runBinaryOK(nvm, "list")
			if m := nvmWinCurrentRe.FindStringSubmatch(out); len(m) > 1 {
				row.Version = m[1]
			}
		}
		if bin, err := lookPathWindows("node", windowsBinaryCandidates("node")...); err == nil {
			row.Binary = bin
			if row.Version == "" {
				row.Version = normalizeNodeVersion(runBinaryOK(bin, "-v"))
			}
		}
		row.Available = row.Version != ""
		return row
	}
	row.Manager = "system"
	row.ManagerLabel = "系统"
	bin, err := lookPathWindows("node", windowsBinaryCandidates("node")...)
	if err != nil {
		row.NeedsManager = false
		row.CanInstallManager = true
		row.ManagerLabel = "nvm-windows"
		return row
	}
	row.Binary = bin
	row.Version = normalizeNodeVersion(runBinaryOK(bin, "-v"))
	row.Available = row.Version != ""
	return row
}

// listNodeVersionsWindows 列出 Windows Node 版本。
func listNodeVersionsWindows(current string) []model.RuntimeVersionDO {
	if hasNvmWindows() {
		nvm := nvmWindowsExe()
		if nvm == "" {
			return systemOnlyVersions(current, "nvm-windows")
		}
		seen := map[string]bool{}
		var out []model.RuntimeVersionDO
		for _, line := range linesNonEmpty(runBinaryOK(nvm, "list")) {
			ver := normalizeNodeVersion(line)
			if !nodeSemverRe.MatchString(ver) || seen[ver] {
				continue
			}
			seen[ver] = true
			out = append(out, model.RuntimeVersionDO{
				Version: ver, Label: "nvm-windows", Installed: true, Active: ver == current,
			})
		}
		if len(out) > 0 {
			return out
		}
	}
	return systemOnlyVersions(current, "系统")
}

// useNodeVersionWindows 切换 nvm-windows 版本。
func useNodeVersionWindows(version string) error {
	if !hasNvmWindows() {
		return errno.New(errno.CodeInvalidArg, "未检测到 nvm-windows，请先安装或把 node 加入 PATH", version)
	}
	ver, err := quoteShellVersion(normalizeNodeVersion(version))
	if err != nil {
		return err
	}
	nvm := nvmWindowsExe()
	if nvm == "" {
		return errno.New(errno.CodeInvalidArg, "找不到 nvm.exe", version)
	}
	_, err = runBinary(nvm, "use", ver)
	return err
}

// installNodeVersionWindows 用 nvm-windows 安装 Node。
func installNodeVersionWindows(version string, emit func(string)) error {
	if !hasNvmWindows() {
		return errno.New(errno.CodeInvalidArg, "未检测到 nvm-windows", version)
	}
	ver, err := quoteShellVersion(normalizeNodeVersion(version))
	if err != nil {
		return err
	}
	nvm := nvmWindowsExe()
	emit("执行 nvm install " + ver)
	_, err = runBinary(nvm, "install", ver)
	if err != nil {
		return err
	}
	_, _ = runBinary(nvm, "use", ver)
	return nil
}

// detectSystemRuntime 用 PATH 二进制填充运行时（Windows 友好）。
func detectSystemRuntime(lang, label, binName string, versionArgs []string, parse func(string) string) model.RuntimeDO {
	row := model.RuntimeDO{
		Lang: lang, Label: label, Manager: "system", ManagerLabel: "系统",
	}
	bin, err := lookPathWindows(binName, windowsBinaryCandidates(binName)...)
	if err != nil {
		if isWindows() {
			row.NeedsManager = false
			row.CanInstallManager = true
		}
		return row
	}
	row.Binary = bin
	raw := runBinaryOK(bin, versionArgs...)
	row.Version = parse(raw)
	row.Available = row.Version != ""
	return row
}

// lookPathWindows 先 LookPath，再回退到常见安装路径。
func lookPathWindows(name string, candidates ...string) (string, error) {
	if p, err := execLookPath(name); err == nil {
		return p, nil
	}
	if !isWindows() {
		return "", os.ErrNotExist
	}
	for _, c := range candidates {
		if c != "" && fileExists(c) {
			return c, nil
		}
	}
	return "", os.ErrNotExist
}

// windowsBinaryCandidates 返回 Windows 常见安装路径。
func windowsBinaryCandidates(binName string) []string {
	pf := os.Getenv("ProgramFiles")
	pf86 := os.Getenv("ProgramFiles(x86)")
	home, _ := os.UserHomeDir()
	local := filepath.Join(home, "AppData", "Local")
	switch strings.ToLower(binName) {
	case "node":
		return []string{
			`C:\nvm4w\nodejs\node.exe`,
			filepath.Join(pf, "nodejs", "node.exe"),
			filepath.Join(local, "Programs", "node", "node.exe"),
		}
	case "go":
		return []string{
			filepath.Join(pf, "Go", "bin", "go.exe"),
			filepath.Join(home, "sdk", "go", "bin", "go.exe"),
			filepath.Join(local, "Programs", "Go", "bin", "go.exe"),
		}
	case "php":
		return []string{
			filepath.Join(pf, "PHP", "php.exe"),
			filepath.Join(pf86, "PHP", "php.exe"),
			filepath.Join(home, "scoop", "apps", "php", "current", "php.exe"),
		}
	case "java":
		javaHome := strings.TrimSpace(os.Getenv("JAVA_HOME"))
		var out []string
		if javaHome != "" {
			out = append(out, filepath.Join(javaHome, "bin", "java.exe"))
		}
		out = append(out,
			filepath.Join(pf, "Microsoft", "jdk-21", "bin", "java.exe"),
			filepath.Join(pf, "Java", "jdk-21", "bin", "java.exe"),
			filepath.Join(pf, "Eclipse Adoptium", "jdk-21", "bin", "java.exe"),
		)
		return out
	default:
		return nil
	}
}

// systemOnlyVersions 仅返回当前系统版本。
func systemOnlyVersions(current, label string) []model.RuntimeVersionDO {
	if current == "" {
		return nil
	}
	return []model.RuntimeVersionDO{{
		Version: current, Label: label, Installed: true, Active: true,
	}}
}

// windowsManagerUnsupported 返回 Windows 上安装 Unix 管理器的明确错误。
func windowsManagerUnsupported(lang string) error {
	switch lang {
	case langNode:
		return errno.New(errno.CodeInvalidArg,
			"Windows 请安装 nvm-windows（https://github.com/coreybutler/nvm-windows/releases），或确保 node 已在 PATH", "")
	case langGo:
		return errno.New(errno.CodeInvalidArg,
			"Windows 请从 https://go.dev/dl/ 安装 Go，或执行: winget install GoLang.Go", "")
	case langPHP:
		return errno.New(errno.CodeInvalidArg,
			"Windows 暂不支持 Homebrew PHP。请用 scoop/chocolatey 安装 php，或把 php.exe 加入 PATH", "")
	case langJava:
		return errno.New(errno.CodeInvalidArg,
			"Windows 暂不支持 sdkman。请安装 JDK 并配置 JAVA_HOME，或执行: winget install Microsoft.OpenJDK.21", "")
	default:
		return errno.New(errno.CodeInvalidArg, "Windows 上不支持该语言版本管理器自动安装", lang)
	}
}
