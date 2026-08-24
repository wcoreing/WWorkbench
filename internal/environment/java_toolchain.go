package environment

import (
	"encoding/json"
	"fmt"
	"os"
	"path/filepath"
	"strconv"
	"strings"
	"time"

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

// installJavaWorkbench 通过 Adoptium 安装 JDK（本机落盘或 SSH 远端 curl|tar）。
func installJavaWorkbench(version string, emit func(string)) error {
	id, err := normalizeJavaInstallID(version)
	if err != nil {
		return err
	}
	if !runnerIsLocal() {
		return installJavaWorkbenchRemote(id, emit)
	}
	dest, err := toolchainVersionDir(langJava, id)
	if err != nil {
		return err
	}
	if localFileExists(filepath.Join(dest, "bin", javaExeName())) {
		emit("已安装 Java " + id)
		return activateJavaToolchain(id)
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
	if !localFileExists(filepath.Join(staging, "bin", javaExeName())) {
		entries, _ := os.ReadDir(staging)
		for _, ent := range entries {
			if ent.IsDir() && localFileExists(filepath.Join(staging, ent.Name(), "bin", javaExeName())) {
				src = filepath.Join(staging, ent.Name())
				break
			}
		}
	}
	if !localFileExists(filepath.Join(src, "bin", javaExeName())) {
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

// installJavaWorkbenchRemote 在 SSH 目标机上下载并安装 Temurin。
func installJavaWorkbenchRemote(id string, emit func(string)) error {
	osName, arch := javaOSArch()
	script := `set -euo pipefail
id=` + posixSingleQuote(id) + `
os=` + posixSingleQuote(osName) + `
arch=` + posixSingleQuote(arch) + `
dest="$HOME/.wworkbench/toolchains/java/versions/$id"
if [ -x "$dest/bin/java" ]; then
  echo "已安装 Java $id"
  exit 0
fi
url="https://api.adoptium.net/v3/binary/latest/${id}/ga/${os}/${arch}/jdk/hotspot/normal/eclipse?project=jdk"
tmp="$(mktemp -d /tmp/wwb-jdk.XXXXXX)"
trap 'rm -rf "$tmp"' EXIT
echo "下载 Temurin JDK $id …"
echo "$url"
curl -fL --retry 3 -o "$tmp/jdk.tgz" "$url"
mkdir -p "$tmp/extract"
tar -xzf "$tmp/jdk.tgz" -C "$tmp/extract"
src=""
if [ -x "$tmp/extract/bin/java" ]; then
  src="$tmp/extract"
else
  for d in "$tmp/extract"/*; do
    if [ -x "$d/bin/java" ]; then
      src="$d"
      break
    fi
  done
fi
if [ -z "$src" ] || [ ! -x "$src/bin/java" ]; then
  echo "解压后未找到 java 可执行文件" >&2
  exit 1
fi
mkdir -p "$(dirname "$dest")"
rm -rf "$dest"
mv "$src" "$dest"
echo "已安装到 $dest"
`
	emit("在远端安装 Temurin JDK " + id + " …")
	if _, err := runLoginShellStream(script, 20*time.Minute, bindStreamEmit(emit)); err != nil {
		return errno.Wrap(errno.CodeConnFailed, "远端安装 JDK 失败", err)
	}
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
	target := id
	if fileExists(mustToolchainDir(langJava, version)) {
		target = version
	}
	dir, err := toolchainVersionDir(langJava, target)
	if err != nil {
		return err
	}
	emit("删除 " + dir)
	if !runnerIsLocal() {
		_, err = runLoginShell(`rm -rf ` + posixSingleQuote(dir))
		return err
	}
	return os.RemoveAll(dir)
}

func mustToolchainDir(lang, version string) string {
	d, _ := toolchainVersionDir(lang, version)
	return d
}
