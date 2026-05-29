package environment

import (
	"os"
	"path/filepath"
	"sort"
	"strconv"
	"strings"

	"WNavicat/internal/model"
)

// listGoCatalogVersions 列出 goenv 可选 Go 版本。
func listGoCatalogVersions() []model.RuntimeVersionDO {
	current := detectGo().Version
	if !hasGoenv() {
		if current != "" {
			return []model.RuntimeVersionDO{{
				Version: current, Label: "goenv", Installed: true, Active: true,
			}}
		}
		return nil
	}
	installed := map[string]bool{}
	for _, ver := range linesNonEmpty(runLoginShellOK(goenvScript() + ` && goenv versions --bare`)) {
		ver = strings.TrimSpace(ver)
		if ver != "" {
			installed[ver] = true
		}
	}
	raw := runLoginShellOK(goenvScript() + ` && goenv install -l 2>/dev/null`)
	seen := map[string]bool{}
	var out []model.RuntimeVersionDO
	for _, line := range linesNonEmpty(raw) {
		ver := strings.TrimSpace(line)
		if ver == "" || seen[ver] {
			continue
		}
		seen[ver] = true
		out = append(out, model.RuntimeVersionDO{
			Version:   ver,
			Label:     "goenv",
			Installed: installed[ver],
			Active:    ver == current,
		})
	}
	for ver := range installed {
		if seen[ver] {
			continue
		}
		out = append(out, model.RuntimeVersionDO{
			Version:   ver,
			Label:     "goenv",
			Installed: true,
			Active:    ver == current,
		})
	}
	sortRuntimeVersions(out)
	return out
}

// listJavaCatalogVersions 列出 sdkman 可选 Java 版本。
func listJavaCatalogVersions() []model.RuntimeVersionDO {
	current := detectJava().Version
	if !hasSdkman() {
		if current != "" {
			return []model.RuntimeVersionDO{{
				Version: current, Label: "system", Installed: true, Active: true,
			}}
		}
		return nil
	}
	installed := javaInstalledMap()
	raw := runLoginShellOK(sdkmanScript() + ` && sdk list java 2>/dev/null`)
	var vendor string
	seen := map[string]bool{}
	var out []model.RuntimeVersionDO
	for _, line := range strings.Split(raw, "\n") {
		v, use, version, dist, status, identifier, ok := parseSDKListLine(line)
		if !ok || seen[identifier] {
			continue
		}
		seen[identifier] = true
		if v != "" {
			vendor = v
		}
		label := javaVendorLabel(vendor, dist)
		isInstalled := installed[identifier] || strings.Contains(status, "installed") || strings.Contains(status, "local only")
		active := identifier == current || strings.Contains(use, ">>>")
		out = append(out, model.RuntimeVersionDO{
			Version:   version,
			Label:     label,
			Formula:   identifier,
			Installed: isInstalled,
			Active:    active,
		})
	}
	if len(out) == 0 {
		return listJavaInstalledOnly(current, installed)
	}
	sortJavaVersions(out)
	return out
}

// listJavaInstalledOnly 仅返回本机已安装 Java。
func listJavaInstalledOnly(current string, installed map[string]bool) []model.RuntimeVersionDO {
	if len(installed) == 0 {
		return nil
	}
	var out []model.RuntimeVersionDO
	for identifier := range installed {
		parts := strings.Split(identifier, "-")
		version := parts[0]
		dist := ""
		if len(parts) > 1 {
			dist = parts[len(parts)-1]
		}
		out = append(out, model.RuntimeVersionDO{
			Version:   version,
			Label:     javaVendorLabel("", dist),
			Formula:   identifier,
			Installed: true,
			Active:    identifier == current,
		})
	}
	sortJavaVersions(out)
	return out
}

// javaInstalledMap 返回已安装 Java identifier 集合。
func javaInstalledMap() map[string]bool {
	m := map[string]bool{}
	home, _ := os.UserHomeDir()
	dir := filepath.Join(home, ".sdkman", "candidates", "java")
	entries, err := os.ReadDir(dir)
	if err != nil {
		return m
	}
	for _, ent := range entries {
		if ent.IsDir() && ent.Name() != "current" {
			m[ent.Name()] = true
		}
	}
	return m
}

// parseSDKListLine 解析 sdk list 表格行。
func parseSDKListLine(line string) (vendor, use, version, dist, status, identifier string, ok bool) {
	if !strings.Contains(line, "|") || strings.Contains(line, "----") {
		return
	}
	parts := strings.Split(line, "|")
	if len(parts) < 6 {
		return
	}
	vendor = strings.TrimSpace(parts[0])
	use = strings.TrimSpace(parts[1])
	version = strings.TrimSpace(parts[2])
	dist = strings.TrimSpace(parts[3])
	status = strings.TrimSpace(parts[4])
	identifier = strings.TrimSpace(parts[5])
	if identifier == "" || identifier == "Identifier" || !strings.Contains(identifier, "-") {
		return
	}
	ok = true
	return
}

// javaVendorLabel 生成 Java 来源显示名。
func javaVendorLabel(vendor, dist string) string {
	vendor = strings.TrimSpace(vendor)
	dist = strings.TrimSpace(dist)
	if vendor != "" && dist != "" {
		return vendor + " (" + dist + ")"
	}
	if vendor != "" {
		return vendor
	}
	if dist != "" {
		return dist
	}
	return "sdkman"
}

// sortRuntimeVersions 按版本号降序排列。
func sortRuntimeVersions(out []model.RuntimeVersionDO) {
	sort.Slice(out, func(i, j int) bool {
		if c := compareVersionTags(out[i].Version, out[j].Version); c != 0 {
			return c > 0
		}
		return out[i].Label < out[j].Label
	})
}

// sortJavaVersions 按 Java 版本降序排列。
func sortJavaVersions(out []model.RuntimeVersionDO) {
	sort.Slice(out, func(i, j int) bool {
		if c := compareJavaVersion(out[i].Version, out[j].Version); c != 0 {
			return c > 0
		}
		return out[i].Label < out[j].Label
	})
}

// compareJavaVersion 比较 Java 版本号（支持 17.0.11、27.ea.22）。
func compareJavaVersion(a, b string) int {
	ap := strings.Split(a, ".")
	bp := strings.Split(b, ".")
	for i := 0; i < 3; i++ {
		ai, bi := 0, 0
		if i < len(ap) {
			ai, _ = strconv.Atoi(strings.TrimLeft(ap[i], "0"))
		}
		if i < len(bp) {
			bi, _ = strconv.Atoi(strings.TrimLeft(bp[i], "0"))
		}
		if ai != bi {
			return ai - bi
		}
	}
	return strings.Compare(a, b)
}
