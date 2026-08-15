package environment

import (
	"encoding/json"
	"fmt"
	"os"
	"path/filepath"
	"strconv"
	"strings"

	"WWorkbench/internal/errno"
	"WWorkbench/internal/model"
)

// detectJavaWorkbench 检测自管 / 系统 Java。
func detectJavaWorkbench() model.RuntimeDO {
	row := model.RuntimeDO{
		Lang: langJava, Label: "Java",
		Manager: managerWorkbench, ManagerLabel: managerLabelWB,
		CanInstall: true,
	}
	if ver := readToolchainCurrent(langJava); ver != "" {
		if dir, err := toolchainVersionDir(langJava, ver); err == nil {
			bin := filepath.Join(dir, "bin", javaExeName())
			if fileExists(bin) {
				row.Binary = bin
				row.Version = parseJavaVersionOutput(runBinaryOK(bin, "-version"))
				if row.Version == "" {
					row.Version = ver
				}
				row.Available = row.Version != ""
				return row
			}
		}
	}
	sys := detectSystemRuntime(langJava, "Java", "java", []string{"-version"}, parseJavaVersionOutput)
	row.Binary = sys.Binary
	row.Version = sys.Version
	row.Available = sys.Available
	return row
}

// listJavaWorkbenchVersions 已安装 + 常见 LTS。
func listJavaWorkbenchVersions() []model.RuntimeVersionDO {
	currentID := readToolchainCurrent(langJava)
	currentVer := detectJavaWorkbench().Version
	installed := map[string]bool{}
	var out []model.RuntimeVersionDO
	for _, id := range listInstalledToolchainIDs(langJava) {
		installed[id] = true
		ver := id
		if dir, err := toolchainVersionDir(langJava, id); err == nil {
			bin := filepath.Join(dir, "bin", javaExeName())
			if fileExists(bin) {
				if v := parseJavaVersionOutput(runBinaryOK(bin, "-version")); v != "" {
					ver = v
				}
			}
		}
		out = append(out, model.RuntimeVersionDO{
			Version: ver, Label: "Temurin", Formula: id,
			Installed: true, Active: id == currentID,
		})
	}
	for _, major := range fetchJavaLTSMajors() {
		id := strconv.Itoa(major)
		if installed[id] {
			continue
		}
		out = append(out, model.RuntimeVersionDO{
			Version: id, Label: "Temurin LTS", Formula: id,
			Installed: false, Active: false,
		})
	}
	if currentVer != "" && currentID == "" {
		out = append(out, model.RuntimeVersionDO{
			Version: currentVer, Label: "系统", Installed: true, Active: true,
		})
	}
	sortJavaVersions(out)
	return out
}

// fetchJavaLTSMajors 返回推荐 LTS 主版本。
func fetchJavaLTSMajors() []int {
	// 固定 LTS + 尝试从 Adoptium 拉最新可用
	defaults := []int{25, 21, 17, 11, 8}
	osName, arch := javaOSArch()
	url := fmt.Sprintf(
		"https://api.adoptium.net/v3/info/available_releases",
	)
	data, err := httpGetOK(url)
	if err != nil || len(data) == 0 {
		return defaults
	}
	var info struct {
		AvailableLTSReleases []int `json:"available_lts_releases"`
	}
	if err := json.Unmarshal(data, &info); err != nil || len(info.AvailableLTSReleases) == 0 {
		return defaults
	}
	_ = osName
	_ = arch
	// 降序
	out := append([]int{}, info.AvailableLTSReleases...)
	for i := 0; i < len(out); i++ {
		for j := i + 1; j < len(out); j++ {
			if out[j] > out[i] {
				out[i], out[j] = out[j], out[i]
			}
		}
	}
	if len(out) > 8 {
		out = out[:8]
	}
	return out
}

// normalizeJavaInstallID 规范化安装 id（主版本号）。
func normalizeJavaInstallID(version string) (string, error) {
	version = strings.TrimSpace(version)
	version = strings.TrimPrefix(version, "java")
	// 支持 21、21.0.6、17.0.11-tem
	if i := strings.IndexAny(version, ".-+"); i > 0 {
		major := version[:i]
		if _, err := strconv.Atoi(major); err == nil {
			return major, nil
		}
	}
	if _, err := strconv.Atoi(version); err == nil {
		return version, nil
	}
	return quoteShellVersion(version)
}

// installJavaWorkbench 通过 Adoptium 安装 JDK。
func installJavaWorkbench(version string, emit func(string)) error {
	id, err := normalizeJavaInstallID(version)
	if err != nil {
		return err
	}
	dest, err := toolchainVersionDir(langJava, id)
	if err != nil {
		return err
	}
	if fileExists(filepath.Join(dest, "bin", javaExeName())) {
		emit("已安装 Java " + id)
		return nil
	}
	osName, arch := javaOSArch()
	ext := "tar.gz"
	if isWindows() {
		ext = "zip"
	}
	url := fmt.Sprintf(
		"https://api.adoptium.net/v3/binary/latest/%s/ga/%s/%s/jdk/hotspot/normal/eclipse?project=jdk",
		id, osName, arch,
	)
	tmpRoot, err := os.MkdirTemp("", "wwb-jdk-*")
	if err != nil {
		return err
	}
	defer os.RemoveAll(tmpRoot)
	archive := filepath.Join(tmpRoot, "jdk."+ext)
	emit("下载 Temurin JDK " + id + " …")
	emit(url)
	if err := downloadFile(url, archive, emit); err != nil {
		return errno.Wrap(errno.CodeConnFailed, "下载 JDK 失败", err)
	}
	staging := filepath.Join(tmpRoot, "extract")
	if err := extractArchive(archive, staging, emit); err != nil {
		return errno.Wrap(errno.CodeConnFailed, "解压 JDK 失败", err)
	}
	src := staging
	if !fileExists(filepath.Join(staging, "bin", javaExeName())) {
		// 偶发未剥顶层时再找一层
		entries, _ := os.ReadDir(staging)
		for _, ent := range entries {
			if ent.IsDir() && fileExists(filepath.Join(staging, ent.Name(), "bin", javaExeName())) {
				src = filepath.Join(staging, ent.Name())
				break
			}
		}
	}
	if !fileExists(filepath.Join(src, "bin", javaExeName())) {
		return errno.New(errno.CodeConnFailed, "解压后未找到 java 可执行文件", id)
	}
	_ = os.RemoveAll(dest)
	if err := os.Rename(src, dest); err != nil {
		if err := copyDir(src, dest); err != nil {
			return err
		}
	}
	emit("已安装到 " + dest)
	emit("正在切换到 " + id)
	if err := activateJavaToolchain(id); err != nil {
		return errno.Wrap(errno.CodeConnFailed, "已安装但切换失败", err)
	}
	emit("已切换到 Java " + id + "（请新开终端生效）")
	return nil
}

// useJavaWorkbench 切换自管 Java。
func useJavaWorkbench(version string) error {
	id, err := normalizeJavaInstallID(version)
	if err != nil {
		return err
	}
	// Formula 可能是 id；也可能传入完整版本号，尝试匹配已安装
	dir, err := toolchainVersionDir(langJava, id)
	if err != nil {
		return err
	}
	if !fileExists(filepath.Join(dir, "bin", javaExeName())) {
		// 按完整版本匹配目录
		for _, installed := range listInstalledToolchainIDs(langJava) {
			d, _ := toolchainVersionDir(langJava, installed)
			bin := filepath.Join(d, "bin", javaExeName())
			if !fileExists(bin) {
				continue
			}
			v := parseJavaVersionOutput(runBinaryOK(bin, "-version"))
			if v == version || strings.HasPrefix(v, id+".") || installed == version {
				id = installed
				dir = d
				break
			}
		}
	}
	if !fileExists(filepath.Join(dir, "bin", javaExeName())) {
		return errno.New(errno.CodeInvalidArg, "该 Java 版本尚未安装，请先安装", version)
	}
	return activateJavaToolchain(id)
}

// uninstallJavaWorkbench 卸载自管 Java。
func uninstallJavaWorkbench(version string, emit func(string)) error {
	id, err := normalizeJavaInstallID(version)
	if err != nil {
		return err
	}
	if readToolchainCurrent(langJava) == id || readToolchainCurrent(langJava) == version {
		return errno.New(errno.CodeInvalidArg, "不能卸载当前正在使用的版本，请先切换到其它版本", version)
	}
	// 也允许用 formula/完整 id
	target := id
	if fileExists(mustToolchainDir(langJava, version)) {
		target = version
	}
	dir, err := toolchainVersionDir(langJava, target)
	if err != nil {
		return err
	}
	emit("删除 " + dir)
	return os.RemoveAll(dir)
}

func mustToolchainDir(lang, version string) string {
	d, _ := toolchainVersionDir(lang, version)
	return d
}
