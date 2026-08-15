package environment

import (
	"encoding/json"
	"fmt"
	"os"
	"path/filepath"
	"sort"
	"strings"
	"sync"
	"time"

	"WWorkbench/internal/errno"
	"WWorkbench/internal/model"
)

const (
	phpReleasesJSON = "https://downloads.php.net/~windows/releases/releases.json"
	phpDownloadBase = "https://downloads.php.net/~windows/releases/"
	phpArchiveBase  = "https://downloads.php.net/~windows/releases/archives/"
)

var (
	phpCatalogMu    sync.Mutex
	phpCatalogCache []phpCatalogEntry
	phpCatalogAt    time.Time
)

type phpCatalogEntry struct {
	Branch  string // 8.3 / 5.6
	Version string // 8.3.33
	ZipPath string // php-8.3.33-nts-Win32-vs16-x64.zip
	Variant string
	BaseURL string // 空则用正式 releases 目录
	Label   string
}

// phpLegacyArchiveCatalog PHP 5 / 7 官方归档最终补丁（NTS x64）。
var phpLegacyArchiveCatalog = []phpCatalogEntry{
	{Branch: "7.4", Version: "7.4.33", ZipPath: "php-7.4.33-nts-Win32-vc15-x64.zip", Variant: "nts-vc15-x64", BaseURL: phpArchiveBase, Label: "archive"},
	{Branch: "7.3", Version: "7.3.33", ZipPath: "php-7.3.33-nts-Win32-VC15-x64.zip", Variant: "nts-vc15-x64", BaseURL: phpArchiveBase, Label: "archive"},
	{Branch: "7.2", Version: "7.2.34", ZipPath: "php-7.2.34-nts-Win32-VC15-x64.zip", Variant: "nts-vc15-x64", BaseURL: phpArchiveBase, Label: "archive"},
	{Branch: "7.1", Version: "7.1.33", ZipPath: "php-7.1.33-nts-Win32-VC14-x64.zip", Variant: "nts-vc14-x64", BaseURL: phpArchiveBase, Label: "archive"},
	{Branch: "7.0", Version: "7.0.33", ZipPath: "php-7.0.33-nts-Win32-VC14-x64.zip", Variant: "nts-vc14-x64", BaseURL: phpArchiveBase, Label: "archive"},
	{Branch: "5.6", Version: "5.6.40", ZipPath: "php-5.6.40-nts-Win32-VC11-x64.zip", Variant: "nts-vc11-x64", BaseURL: phpArchiveBase, Label: "archive"},
	{Branch: "5.5", Version: "5.5.38", ZipPath: "php-5.5.38-nts-Win32-VC11-x64.zip", Variant: "nts-vc11-x64", BaseURL: phpArchiveBase, Label: "archive"},
}

// phpExeName 平台 PHP 可执行文件名。
func phpExeName() string {
	if isWindows() {
		return "php.exe"
	}
	return "php"
}

// detectPHPWorkbench 检测自管 / 系统 PHP。
func detectPHPWorkbench() model.RuntimeDO {
	row := model.RuntimeDO{
		Lang: langPHP, Label: "PHP",
		Manager: managerWorkbench, ManagerLabel: managerLabelWB,
		CanInstall: true,
	}
	if ver := readToolchainCurrent(langPHP); ver != "" {
		if dir, err := toolchainVersionDir(langPHP, ver); err == nil {
			bin := filepath.Join(dir, phpExeName())
			if fileExists(bin) {
				row.Binary = bin
				row.Version = strings.TrimSpace(runBinaryOK(bin, "-r", "echo PHP_VERSION;"))
				if row.Version == "" {
					row.Version = ver
				}
				row.Available = row.Version != ""
				return row
			}
		}
	}
	sys := detectSystemRuntime(langPHP, "PHP", "php", []string{"-r", "echo PHP_VERSION;"}, strings.TrimSpace)
	row.Binary = sys.Binary
	row.Version = sys.Version
	row.Available = sys.Available
	return row
}

// listPHPWorkbenchVersions 已安装 + 官方分支最新版。
func listPHPWorkbenchVersions() []model.RuntimeVersionDO {
	currentID := readToolchainCurrent(langPHP)
	currentVer := detectPHPWorkbench().Version
	installed := map[string]bool{}
	var out []model.RuntimeVersionDO
	for _, id := range listInstalledToolchainIDs(langPHP) {
		installed[id] = true
		ver := id
		if dir, err := toolchainVersionDir(langPHP, id); err == nil {
			bin := filepath.Join(dir, phpExeName())
			if fileExists(bin) {
				if v := strings.TrimSpace(runBinaryOK(bin, "-r", "echo PHP_VERSION;")); v != "" {
					ver = v
				}
			}
		}
		out = append(out, model.RuntimeVersionDO{
			Version: ver, Label: managerLabelWB, Formula: id,
			Installed: true, Active: id == currentID || ver == currentVer && currentID == id,
		})
	}
	for _, e := range fetchPHPCatalog() {
		if installed[e.Version] {
			continue
		}
		out = append(out, model.RuntimeVersionDO{
			Version: e.Version, Label: phpCatalogLabel(e), Formula: e.Version,
			Installed: false, Active: false,
		})
	}
	if currentVer != "" && currentID == "" {
		out = append(out, model.RuntimeVersionDO{
			Version: currentVer, Label: "系统", Installed: true, Active: true,
		})
	}
	sortRuntimeVersions(out)
	return out
}

// phpCatalogLabel 目录来源展示名。
func phpCatalogLabel(e phpCatalogEntry) string {
	if e.Label != "" {
		return e.Label
	}
	return "windows.php.net"
}

// fetchPHPCatalog 拉取 Windows PHP 官方分支列表（含 5.x / 7.x 归档）。
func fetchPHPCatalog() []phpCatalogEntry {
	if cached := getCachedPHPCatalog(); len(cached) > 0 {
		return cached
	}
	seen := map[string]bool{}
	var out []phpCatalogEntry
	data, err := httpGetOK(phpReleasesJSON)
	if err == nil && len(data) > 0 {
		var raw map[string]json.RawMessage
		if err := json.Unmarshal(data, &raw); err == nil {
			for branch, body := range raw {
				if !strings.HasPrefix(branch, "8.") && !strings.HasPrefix(branch, "7.") {
					continue
				}
				var meta map[string]json.RawMessage
				if err := json.Unmarshal(body, &meta); err != nil {
					continue
				}
				var version string
				_ = json.Unmarshal(meta["version"], &version)
				if version == "" {
					continue
				}
				zipPath, variant := pickPHPZip(meta)
				if zipPath == "" {
					continue
				}
				out = append(out, phpCatalogEntry{
					Branch: branch, Version: version, ZipPath: zipPath, Variant: variant,
					BaseURL: phpDownloadBase, Label: "windows.php.net",
				})
				seen[version] = true
				seen[branch] = true
			}
		}
	}
	// 并入 PHP 5 / 7 归档最终版（正式目录没有的分支）
	for _, e := range phpLegacyArchiveCatalog {
		if seen[e.Version] || seen[e.Branch] {
			continue
		}
		out = append(out, e)
		seen[e.Version] = true
		seen[e.Branch] = true
	}
	if len(out) == 0 {
		out = append([]phpCatalogEntry{}, phpLegacyArchiveCatalog...)
		out = append(out,
			phpCatalogEntry{Branch: "8.4", Version: "8.4.24"},
			phpCatalogEntry{Branch: "8.3", Version: "8.3.33"},
		)
	}
	sort.Slice(out, func(i, j int) bool {
		return compareVersionTags(out[i].Version, out[j].Version) > 0
	})
	setCachedPHPCatalog(out)
	return out
}

// pickPHPZip 优先 NTS x64（vs17/vs16）。
func pickPHPZip(meta map[string]json.RawMessage) (path, variant string) {
	candidates := []string{
		"nts-vs17-x64", "nts-vs16-x64", "ts-vs17-x64", "ts-vs16-x64",
	}
	for _, key := range candidates {
		raw, ok := meta[key]
		if !ok {
			continue
		}
		var block struct {
			Zip struct {
				Path string `json:"path"`
			} `json:"zip"`
		}
		if err := json.Unmarshal(raw, &block); err != nil || block.Zip.Path == "" {
			continue
		}
		return block.Zip.Path, key
	}
	return "", ""
}

func getCachedPHPCatalog() []phpCatalogEntry {
	phpCatalogMu.Lock()
	defer phpCatalogMu.Unlock()
	if time.Since(phpCatalogAt) < 30*time.Minute && len(phpCatalogCache) > 0 {
		out := make([]phpCatalogEntry, len(phpCatalogCache))
		copy(out, phpCatalogCache)
		return out
	}
	return nil
}

func setCachedPHPCatalog(entries []phpCatalogEntry) {
	if len(entries) == 0 {
		return
	}
	phpCatalogMu.Lock()
	defer phpCatalogMu.Unlock()
	phpCatalogCache = append([]phpCatalogEntry{}, entries...)
	phpCatalogAt = time.Now()
}

// resolvePHPWorkbenchVersion 将 8.3 / 8.3.33 解析为可安装版本。
func resolvePHPWorkbenchVersion(req string) (string, error) {
	req = strings.TrimSpace(strings.TrimPrefix(req, "php@"))
	req = strings.TrimPrefix(req, "php")
	if req == "" {
		return "", errInvalidVersion
	}
	if _, err := quoteShellVersion(req); err != nil {
		return "", err
	}
	bestInstalled := ""
	for _, id := range listInstalledToolchainIDs(langPHP) {
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
	for _, e := range fetchPHPCatalog() {
		if e.Version == req || e.Branch == req || strings.HasPrefix(e.Version, req+".") {
			if bestCatalog == "" || compareVersionTags(e.Version, bestCatalog) > 0 {
				bestCatalog = e.Version
			}
		}
	}
	if bestCatalog != "" {
		return bestCatalog, nil
	}
	parts := strings.Split(req, ".")
	if len(parts) >= 3 {
		return req, nil
	}
	return "", errno.New(errno.CodeInvalidArg, "找不到匹配的 PHP 版本，请指定如 5.6、7.4、8.3 或完整补丁号", req)
}

// findPHPCatalogEntry 按版本查找目录项。
func findPHPCatalogEntry(ver string) (phpCatalogEntry, bool) {
	for _, e := range fetchPHPCatalog() {
		if e.Version == ver {
			return e, true
		}
	}
	for _, e := range phpLegacyArchiveCatalog {
		if e.Version == ver {
			return e, true
		}
	}
	return phpCatalogEntry{}, false
}

// phpZipURL 返回下载地址。
func phpZipURL(ver, zipName string) string {
	if e, ok := findPHPCatalogEntry(ver); ok {
		base := e.BaseURL
		if base == "" {
			base = phpDownloadBase
		}
		if e.ZipPath != "" {
			return base + e.ZipPath
		}
	}
	base, name := guessPHPZip(ver)
	if zipName != "" {
		name = zipName
	}
	return base + name
}

// guessPHPZip 按版本猜测归档包名。
func guessPHPZip(ver string) (base, name string) {
	switch {
	case strings.HasPrefix(ver, "5.6"), strings.HasPrefix(ver, "5.5"):
		return phpArchiveBase, fmt.Sprintf("php-%s-nts-Win32-VC11-x64.zip", ver)
	case strings.HasPrefix(ver, "7.0"), strings.HasPrefix(ver, "7.1"):
		return phpArchiveBase, fmt.Sprintf("php-%s-nts-Win32-VC14-x64.zip", ver)
	case strings.HasPrefix(ver, "7.2"), strings.HasPrefix(ver, "7.3"):
		return phpArchiveBase, fmt.Sprintf("php-%s-nts-Win32-VC15-x64.zip", ver)
	case strings.HasPrefix(ver, "7.4"):
		return phpArchiveBase, fmt.Sprintf("php-%s-nts-Win32-vc15-x64.zip", ver)
	case strings.HasPrefix(ver, "8.4"), strings.HasPrefix(ver, "8.5"):
		return phpDownloadBase, fmt.Sprintf("php-%s-nts-Win32-vs17-x64.zip", ver)
	default:
		return phpDownloadBase, fmt.Sprintf("php-%s-nts-Win32-vs16-x64.zip", ver)
	}
}

// installPHPWorkbench 下载并安装官方 Windows PHP。
func installPHPWorkbench(version string, emit func(string)) error {
	if !isWindows() {
		return errno.New(errno.CodeInvalidArg, "自管 PHP 目前仅支持 Windows；macOS 请使用 Homebrew", version)
	}
	ver, err := resolvePHPWorkbenchVersion(version)
	if err != nil {
		return err
	}
	if ver != version {
		emit("解析版本 " + version + " → " + ver)
	}
	dest, err := toolchainVersionDir(langPHP, ver)
	if err != nil {
		return err
	}
	if fileExists(filepath.Join(dest, phpExeName())) {
		emit("已安装 " + ver)
		emit("正在切换到 " + ver)
		return activatePHPToolchain(ver)
	}
	zipName := ""
	baseURL := phpDownloadBase
	if e, ok := findPHPCatalogEntry(ver); ok {
		zipName = e.ZipPath
		if e.BaseURL != "" {
			baseURL = e.BaseURL
		}
		if strings.HasPrefix(ver, "5.") {
			emit("提示：PHP 5 需要系统已安装 Visual C++ 2012 (VC11) 运行库")
		}
		if strings.HasPrefix(ver, "7.0") || strings.HasPrefix(ver, "7.1") {
			emit("提示：PHP 7.0/7.1 需要 Visual C++ 2015 (VC14) 运行库")
		}
	}
	if zipName == "" {
		baseURL, zipName = guessPHPZip(ver)
	}
	url := baseURL + zipName
	tmpRoot, err := os.MkdirTemp("", "wwb-php-*")
	if err != nil {
		return err
	}
	defer os.RemoveAll(tmpRoot)
	archive := filepath.Join(tmpRoot, filepath.Base(zipName))
	emit("下载 " + url)
	if err := downloadFile(url, archive, emit); err != nil {
		return errno.Wrap(errno.CodeConnFailed, "下载 PHP 失败", err)
	}
	staging := filepath.Join(tmpRoot, "extract")
	if err := extractArchive(archive, staging, emit); err != nil {
		return errno.Wrap(errno.CodeConnFailed, "解压 PHP 失败", err)
	}
	src := staging
	if !fileExists(filepath.Join(staging, phpExeName())) {
		entries, _ := os.ReadDir(staging)
		for _, ent := range entries {
			if ent.IsDir() && fileExists(filepath.Join(staging, ent.Name(), phpExeName())) {
				src = filepath.Join(staging, ent.Name())
				break
			}
		}
	}
	if !fileExists(filepath.Join(src, phpExeName())) {
		return errno.New(errno.CodeConnFailed, "解压后未找到 php.exe", ver)
	}
	_ = os.RemoveAll(dest)
	if err := os.Rename(src, dest); err != nil {
		if err := copyDir(src, dest); err != nil {
			return err
		}
	}
	ensurePHPIni(dest, emit)
	emit("已安装到 " + dest)
	emit("正在切换到 " + ver)
	if err := activatePHPToolchain(ver); err != nil {
		return errno.Wrap(errno.CodeConnFailed, "已安装但切换失败", err)
	}
	emit("已切换到 " + ver + "（请新开终端生效）")
	return nil
}

// ensurePHPIni 若无 php.ini 则从开发模板复制。
func ensurePHPIni(dir string, emit func(string)) {
	ini := filepath.Join(dir, "php.ini")
	if fileExists(ini) {
		return
	}
	for _, name := range []string{"php.ini-development", "php.ini-production"} {
		src := filepath.Join(dir, name)
		if !fileExists(src) {
			continue
		}
		data, err := os.ReadFile(src)
		if err != nil {
			continue
		}
		if err := os.WriteFile(ini, data, 0o644); err == nil && emit != nil {
			emit("已生成 php.ini（来自 " + name + "）")
		}
		return
	}
}

// usePHPWorkbench 切换自管 PHP。
func usePHPWorkbench(version string) error {
	ver, err := resolvePHPWorkbenchVersion(version)
	if err != nil {
		return err
	}
	dir, err := toolchainVersionDir(langPHP, ver)
	if err != nil {
		return err
	}
	if !fileExists(filepath.Join(dir, phpExeName())) {
		return errno.New(errno.CodeInvalidArg, "该 PHP 版本尚未安装，请先安装", ver)
	}
	return activatePHPToolchain(ver)
}

// uninstallPHPWorkbench 卸载自管 PHP。
func uninstallPHPWorkbench(version string, emit func(string)) error {
	ver, err := resolvePHPWorkbenchVersion(version)
	if err != nil {
		return err
	}
	if readToolchainCurrent(langPHP) == ver {
		return errno.New(errno.CodeInvalidArg, "不能卸载当前正在使用的版本，请先切换到其它版本", ver)
	}
	dir, err := toolchainVersionDir(langPHP, ver)
	if err != nil {
		return err
	}
	emit("删除 " + dir)
	return os.RemoveAll(dir)
}
