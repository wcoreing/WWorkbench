package environment

import (
	"encoding/json"
	"fmt"
	"os"
	"path/filepath"
	"strings"
	"sync"
	"time"

	"WWorkbench/internal/errno"
	"WWorkbench/internal/model"
)

type goDlEntry struct {
	Version string `json:"version"`
	Stable  bool   `json:"stable"`
	Files   []struct {
		Filename string `json:"filename"`
		OS       string `json:"os"`
		Arch     string `json:"arch"`
		Kind     string `json:"kind"`
		SHA256   string `json:"sha256"`
	} `json:"files"`
}

// detectGoWorkbench 检测自管 / 系统 Go。
func detectGoWorkbench() model.RuntimeDO {
	row := model.RuntimeDO{
		Lang: langGo, Label: "Go",
		Manager: managerWorkbench, ManagerLabel: managerLabelWB,
		CanInstall: true,
	}
	if ver := readToolchainCurrent(langGo); ver != "" {
		if dir, err := toolchainVersionDir(langGo, ver); err == nil {
			bin := filepath.Join(dir, "bin", goExeName())
			if fileExists(bin) {
				row.Binary = bin
				row.Version = ver
				out := runBinaryOK(bin, "version")
				if m := goVersionRe.FindStringSubmatch(out); len(m) > 1 {
					row.Version = m[1]
				}
				row.Available = row.Version != ""
				return row
			}
		}
	}
	sys := detectSystemRuntime(langGo, "Go", "go", []string{"version"}, func(raw string) string {
		if m := goVersionRe.FindStringSubmatch(raw); len(m) > 1 {
			return m[1]
		}
		return ""
	})
	row.Binary = sys.Binary
	row.Version = sys.Version
	row.Available = sys.Available
	if !row.Available {
		row.ManagerLabel = managerLabelWB
	}
	return row
}

// listGoWorkbenchVersions 已安装 + 官方可选稳定版。
func listGoWorkbenchVersions() []model.RuntimeVersionDO {
	current := detectGoWorkbench().Version
	installed := map[string]bool{}
	for _, id := range listInstalledToolchainIDs(langGo) {
		installed[id] = true
	}
	seen := map[string]bool{}
	var out []model.RuntimeVersionDO
	for ver := range installed {
		out = append(out, model.RuntimeVersionDO{
			Version: ver, Label: managerLabelWB, Installed: true, Active: ver == current,
		})
		seen[ver] = true
	}
	for _, ver := range fetchGoStableVersions() {
		if seen[ver] {
			continue
		}
		seen[ver] = true
		out = append(out, model.RuntimeVersionDO{
			Version: ver, Label: "go.dev", Installed: false, Active: false,
		})
	}
	if current != "" && !seen[current] {
		out = append(out, model.RuntimeVersionDO{
			Version: current, Label: "系统", Installed: true, Active: true,
		})
	}
	sortRuntimeVersions(out)
	return out
}

// fetchGoStableVersions 拉取近期稳定版（最多 36 个）。
func fetchGoStableVersions() []string {
	if cached := getCachedGoCatalog(); len(cached) > 0 {
		return cached
	}
	goos, goarch := goOSArch()
	urls := []string{
		"https://golang.google.cn/dl/?mode=json&include=all",
		"https://go.dev/dl/?mode=json&include=all",
		"https://golang.google.cn/dl/?mode=json",
		"https://go.dev/dl/?mode=json",
	}
	var data []byte
	var err error
	for _, u := range urls {
		data, err = httpGetOK(u)
		if err == nil && len(data) > 0 {
			break
		}
	}
	if err != nil || len(data) == 0 {
		return []string{"1.26.6", "1.25.13", "1.24.5", "1.23.11", "1.22.12"}
	}
	var entries []goDlEntry
	if err := json.Unmarshal(data, &entries); err != nil {
		return nil
	}
	var out []string
	for _, e := range entries {
		if !e.Stable {
			continue
		}
		ver := strings.TrimPrefix(e.Version, "go")
		ok := false
		for _, f := range e.Files {
			if f.Kind == "archive" && f.OS == goos && f.Arch == goarch {
				ok = true
				break
			}
		}
		if !ok {
			continue
		}
		out = append(out, ver)
		if len(out) >= 36 {
			break
		}
	}
	setCachedGoCatalog(out)
	return out
}

var (
	goCatalogMu    sync.Mutex
	goCatalogCache []string
	goCatalogAt    time.Time
)

func getCachedGoCatalog() []string {
	goCatalogMu.Lock()
	defer goCatalogMu.Unlock()
	if time.Since(goCatalogAt) < 30*time.Minute && len(goCatalogCache) > 0 {
		out := make([]string, len(goCatalogCache))
		copy(out, goCatalogCache)
		return out
	}
	return nil
}

func setCachedGoCatalog(vers []string) {
	if len(vers) == 0 {
		return
	}
	goCatalogMu.Lock()
	defer goCatalogMu.Unlock()
	goCatalogCache = append([]string{}, vers...)
	goCatalogAt = time.Now()
}

// resolveGoWorkbenchVersion 将 go.mod 风格版本解析为可安装的完整版本。
func resolveGoWorkbenchVersion(req string) (string, error) {
	req = strings.TrimSpace(strings.TrimPrefix(req, "go"))
	req = strings.TrimPrefix(req, "v")
	if req == "" {
		return "", errInvalidVersion
	}
	if _, err := quoteShellVersion(req); err != nil {
		return "", err
	}
	// 已安装中取最高匹配
	bestInstalled := ""
	for _, id := range listInstalledToolchainIDs(langGo) {
		if id == req || strings.HasPrefix(id, req+".") {
			if bestInstalled == "" || compareVersionTags(id, bestInstalled) > 0 {
				bestInstalled = id
			}
		}
	}
	if bestInstalled != "" {
		return bestInstalled, nil
	}
	bestCatalog := ""
	for _, v := range fetchGoStableVersions() {
		if v == req || strings.HasPrefix(v, req+".") {
			if bestCatalog == "" || compareVersionTags(v, bestCatalog) > 0 {
				bestCatalog = v
			}
		}
	}
	if bestCatalog != "" {
		return bestCatalog, nil
	}
	// 完整三方版本号允许直接下载
	parts := strings.Split(req, ".")
	if len(parts) >= 3 {
		return req, nil
	}
	return "", errno.New(errno.CodeInvalidArg, "找不到匹配的 Go 版本，请指定完整版本如 1.22.12", req)
}

// installGoWorkbench 下载并安装 Go。
func installGoWorkbench(version string, emit func(string)) error {
	ver, err := resolveGoWorkbenchVersion(version)
	if err != nil {
		return err
	}
	if ver != strings.TrimPrefix(strings.TrimSpace(version), "go") {
		emit("解析版本 " + version + " → " + ver)
	}
	dest, err := toolchainVersionDir(langGo, ver)
	if err != nil {
		return err
	}
	if fileExists(filepath.Join(dest, "bin", goExeName())) {
		emit("已安装 " + ver)
		return nil
	}
	goos, goarch := goOSArch()
	ext := ".tar.gz"
	if goos == "windows" {
		ext = ".zip"
	}
	filename := fmt.Sprintf("go%s.%s-%s%s", ver, goos, goarch, ext)
	urls := []string{
		"https://mirrors.aliyun.com/golang/" + filename,
		"https://golang.google.cn/dl/" + filename,
		"https://go.dev/dl/" + filename,
	}
	tmpRoot, err := os.MkdirTemp("", "wwb-go-*")
	if err != nil {
		return err
	}
	defer os.RemoveAll(tmpRoot)
	archive := filepath.Join(tmpRoot, filename)
	var lastErr error
	for _, u := range urls {
		emit("下载 " + u)
		if err := downloadFile(u, archive, emit); err != nil {
			lastErr = err
			emit("失败: " + err.Error())
			continue
		}
		lastErr = nil
		break
	}
	if lastErr != nil {
		return errno.Wrap(errno.CodeConnFailed, "下载 Go 失败", lastErr)
	}
	staging := filepath.Join(tmpRoot, "extract")
	if err := extractArchive(archive, staging, emit); err != nil {
		return errno.Wrap(errno.CodeConnFailed, "解压 Go 失败", err)
	}
	// 官方包解压后为 go/bin/...
	src := staging
	if fileExists(filepath.Join(staging, "go", "bin", goExeName())) {
		src = filepath.Join(staging, "go")
	}
	_ = os.RemoveAll(dest)
	if err := os.Rename(src, dest); err != nil {
		if err := copyDir(src, dest); err != nil {
			return err
		}
	}
	emit("已安装到 " + dest)
	emit("正在切换到 " + ver)
	if err := activateGoToolchain(ver); err != nil {
		return errno.Wrap(errno.CodeConnFailed, "已安装但切换失败", err)
	}
	emit("已切换到 " + ver + "（请新开终端生效；系统自带 Go 会被 shell 钩子覆盖）")
	return nil
}

// useGoWorkbench 切换自管 Go。
func useGoWorkbench(version string) error {
	ver, err := resolveGoWorkbenchVersion(version)
	if err != nil {
		return err
	}
	dir, err := toolchainVersionDir(langGo, ver)
	if err != nil {
		return err
	}
	if !fileExists(filepath.Join(dir, "bin", goExeName())) {
		return errno.New(errno.CodeInvalidArg, "该 Go 版本尚未安装，请先安装", ver)
	}
	return activateGoToolchain(ver)
}

// uninstallGoWorkbench 卸载自管 Go。
func uninstallGoWorkbench(version string, emit func(string)) error {
	ver, err := quoteShellVersion(strings.TrimPrefix(strings.TrimSpace(version), "go"))
	if err != nil {
		return err
	}
	if readToolchainCurrent(langGo) == ver {
		return errno.New(errno.CodeInvalidArg, "不能卸载当前正在使用的版本，请先切换到其它版本", ver)
	}
	dir, err := toolchainVersionDir(langGo, ver)
	if err != nil {
		return err
	}
	emit("删除 " + dir)
	return os.RemoveAll(dir)
}

// copyDir 递归复制目录。
func copyDir(src, dst string) error {
	return filepath.Walk(src, func(path string, info os.FileInfo, err error) error {
		if err != nil {
			return err
		}
		rel, err := filepath.Rel(src, path)
		if err != nil {
			return err
		}
		target := filepath.Join(dst, rel)
		if info.IsDir() {
			return os.MkdirAll(target, 0o755)
		}
		data, err := os.ReadFile(path)
		if err != nil {
			return err
		}
		return os.WriteFile(target, data, info.Mode())
	})
}
