package environment

import (
	"os"
	"os/exec"
	"path/filepath"
	"regexp"
	"sort"
	"strconv"
	"strings"
	"time"

	"WWorkbench/internal/errno"
	"WWorkbench/internal/model"
)

var nodeVersionRe = regexp.MustCompile(`v?([0-9]+\.[0-9]+\.[0-9]+)`)
var nodeSemverRe = regexp.MustCompile(`^[0-9]+\.[0-9]+\.[0-9]+$`)

// nvmScript 返回 nvm 初始化脚本前缀。
func nvmScript() string {
	if prefix := brewPrefix("nvm"); prefix != "" {
		nvmSh := filepath.Join(prefix, "nvm.sh")
		if fileExists(nvmSh) {
			nvmDir := os.Getenv("NVM_DIR")
			if nvmDir == "" {
				home, _ := os.UserHomeDir()
				nvmDir = filepath.Join(home, ".nvm")
			}
			return `export NVM_DIR="` + nvmDir + `" && [ -s "` + nvmSh + `" ] && . "` + nvmSh + `"`
		}
	}
	nvmDir := os.Getenv("NVM_DIR")
	if nvmDir == "" {
		home, _ := os.UserHomeDir()
		nvmDir = filepath.Join(home, ".nvm")
	}
	return `export NVM_DIR="` + nvmDir + `" && [ -s "$NVM_DIR/nvm.sh" ] && . "$NVM_DIR/nvm.sh"`
}

// detectNode 检测 Node.js 运行时。
func detectNode() model.RuntimeDO {
	if isWindows() {
		return detectNodeWindows()
	}
	row := model.RuntimeDO{Lang: langNode, Label: "Node.js", ManagerLabel: managerLabelNvm()}
	if hasNvm() {
		row.Manager = managerNvm
		row.CanInstall = true
		cur := runLoginShellOK(nvmScript() + ` && nvm current`)
		cur = strings.TrimSpace(strings.TrimPrefix(cur, "v"))
		if cur != "" && cur != "none" && cur != "system" {
			row.Version = normalizeNodeVersion(cur)
			row.Available = true
		}
		bin := runLoginShellOK(nvmScript() + ` && command -v node`)
		row.Binary = bin
		if row.Version == "" && bin != "" {
			row.Version = normalizeNodeVersion(runBinaryOK(bin, "-v"))
			row.Available = row.Version != ""
		}
		return row
	}
	row.Manager = "system"
	row.NeedsManager = true
	row.CanInstallManager = true
	bin, err := execLookPath("node")
	if err != nil {
		return row
	}
	row.Binary = bin
	row.Version = normalizeNodeVersion(runBinaryOK(bin, "-v"))
	row.Available = row.Version != ""
	return row
}

// listNodeVersions 列出 Node 可切换版本。
func listNodeVersions() []model.RuntimeVersionDO {
	current := detectNode().Version
	if isWindows() {
		return listNodeVersionsWindows(current)
	}
	if hasNvm() {
		return listNodeCatalogVersions(current)
	}
	return systemOnlyVersions(current, "system")
}

// listNodeCatalogVersions 合并 nvm 已安装与 LTS 可选版本。
func listNodeCatalogVersions(current string) []model.RuntimeVersionDO {
	installed := map[string]bool{}
	for _, item := range listNvmInstalledVersions(current) {
		installed[item.Version] = true
	}
	seen := map[string]bool{}
	var versions []string
	raw := runLoginShellOK(nvmScript() + ` && nvm ls-remote --lts --no-colors 2>/dev/null`)
	for _, line := range linesNonEmpty(raw) {
		ver := normalizeNodeVersion(line)
		if ver == "" || !nodeSemverRe.MatchString(ver) || seen[ver] {
			continue
		}
		seen[ver] = true
		versions = append(versions, ver)
	}
	for ver := range installed {
		if seen[ver] {
			continue
		}
		seen[ver] = true
		versions = append(versions, ver)
	}
	sort.Slice(versions, func(i, j int) bool {
		return compareNodeSemver(versions[i], versions[j]) > 0
	})
	var out []model.RuntimeVersionDO
	for _, ver := range versions {
		out = append(out, model.RuntimeVersionDO{
			Version:   ver,
			Label:     "nvm",
			Installed: installed[ver],
			Active:    ver == current,
		})
	}
	return out
}

// listNvmInstalledVersions 从 nvm 目录读取已安装版本。
func listNvmInstalledVersions(current string) []model.RuntimeVersionDO {
	home, _ := os.UserHomeDir()
	dir := filepath.Join(home, ".nvm", "versions", "node")
	entries, err := os.ReadDir(dir)
	if err != nil {
		return nil
	}
	var out []model.RuntimeVersionDO
	for _, ent := range entries {
		if !ent.IsDir() {
			continue
		}
		ver := normalizeNodeVersion(ent.Name())
		if ver == "" || !nodeSemverRe.MatchString(ver) {
			continue
		}
		out = append(out, model.RuntimeVersionDO{
			Version:   ver,
			Label:     "nvm",
			Installed: true,
			Active:    ver == current,
		})
	}
	sort.Slice(out, func(i, j int) bool {
		return compareNodeSemver(out[i].Version, out[j].Version) > 0
	})
	return out
}

// compareNodeSemver 比较 Node 语义化版本，返回值同 strings.Compare 语义。
func compareNodeSemver(a, b string) int {
	pa := strings.Split(a, ".")
	pb := strings.Split(b, ".")
	for i := 0; i < 3; i++ {
		ai, bi := 0, 0
		if i < len(pa) {
			ai, _ = strconv.Atoi(pa[i])
		}
		if i < len(pb) {
			bi, _ = strconv.Atoi(pb[i])
		}
		if ai != bi {
			return ai - bi
		}
	}
	return 0
}

// useNodeVersion 切换 Node 版本。
func useNodeVersion(version string) error {
	version = strings.TrimPrefix(strings.TrimSpace(version), "v")
	if isWindows() {
		return useNodeVersionWindows(version)
	}
	if !hasNvm() {
		return errno.New(errno.CodeInvalidArg, "未检测到 nvm，请先安装 nvm", version)
	}
	ver, err := quoteNodeVersion(version)
	if err != nil {
		return err
	}
	_, err = runLoginShell(nvmScript() + ` && nvm use ` + ver + ` && nvm alias default ` + ver)
	if err != nil {
		return err
	}
	if err := syncNodeShellEnv(); err != nil {
		return errno.Wrap(errno.CodeConnFailed, "已切换但写入 shell 配置失败", err)
	}
	return nil
}

// installNodeVersion 安装 Node 版本。
func installNodeVersion(version string, emit func(string)) error {
	if isWindows() {
		return installNodeVersionWindows(version, emit)
	}
	if !hasNvm() {
		return errno.New(errno.CodeInvalidArg, "未检测到 nvm，请先安装 nvm", version)
	}
	ver, err := quoteNodeVersion(version)
	if err != nil {
		return err
	}
	emit("执行 nvm install " + ver)
	_, err = runLoginShellStream(nvmScript()+` && nvm install `+ver, 20*time.Minute, filterEmit(emit))
	return err
}

// uninstallNodeVersion 卸载 Node 版本。
func uninstallNodeVersion(version string, emit func(string)) error {
	if !hasNvm() {
		return errno.New(errno.CodeInvalidArg, "未检测到 nvm", version)
	}
	ver, err := quoteNodeVersion(version)
	if err != nil {
		return err
	}
	emit("执行 nvm uninstall " + ver)
	_, err = runLoginShellStream(nvmScript()+` && nvm uninstall `+ver, 10*time.Minute, filterEmit(emit))
	return err
}

// quoteNodeVersion 校验 Node 版本参数（支持 lts/*）。
func quoteNodeVersion(version string) (string, error) {
	version = strings.TrimSpace(strings.TrimPrefix(version, "v"))
	if version == "" {
		return "", errInvalidVersion
	}
	if !regexp.MustCompile(`^[a-zA-Z0-9._+\-/*]+$`).MatchString(version) {
		return "", errInvalidVersion
	}
	return version, nil
}

// normalizeNodeVersion 规范化 Node 版本号。
func normalizeNodeVersion(raw string) string {
	raw = strings.TrimSpace(strings.TrimPrefix(raw, "v"))
	m := nodeVersionRe.FindStringSubmatch(raw)
	if len(m) < 2 {
		return raw
	}
	return m[1]
}

// execLookPath 查找可执行文件路径。
func execLookPath(name string) (string, error) {
	return exec.LookPath(name)
}
