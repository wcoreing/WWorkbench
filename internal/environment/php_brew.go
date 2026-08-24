package environment

import (
	"encoding/json"
	"path/filepath"
	"sort"
	"strconv"
	"strings"
	"time"

	"WWorkbench/internal/errno"
	"WWorkbench/internal/model"
)

// phpBrewFormula 根据版本号或 formula 解析 brew formula（如 8.3 → php@8.3）。
func phpBrewFormula(version string) (string, error) {
	version = strings.TrimSpace(version)
	if strings.Contains(version, "php@") {
		return version, nil
	}
	ver, err := quoteShellVersion(strings.TrimPrefix(version, "v"))
	if err != nil {
		return "", err
	}
	if formula := phpInstalledFormula(ver); formula != "" {
		return formula, nil
	}
	return resolvePhpBrewFormula(ver)
}

// resolvePhpBrewFormula 解析并校验 PHP brew formula。
func resolvePhpBrewFormula(ver string) (string, error) {
	parts := strings.Split(ver, ".")
	if len(parts) == 0 || parts[0] == "" {
		return "", errInvalidVersion
	}
	var candidates []string
	if len(parts) >= 2 {
		tag := parts[0] + "." + parts[1]
		candidates = append(candidates, "php@"+tag, "shivammathur/php/php@"+tag)
	} else {
		for _, minor := range []string{"4", "3", "2", "1", "0"} {
			tag := parts[0] + "." + minor
			candidates = append(candidates, "php@"+tag, "shivammathur/php/php@"+tag)
		}
	}
	for _, f := range candidates {
		if brewFormulaExists(f) {
			return f, nil
		}
	}
	if len(parts) >= 2 {
		return "php@" + parts[0] + "." + parts[1], nil
	}
	return "", errno.New(errno.CodeInvalidArg, "未找到匹配的 PHP formula，请指定如 8.3", ver)
}

// phpInstalledFormula 从 brew 已安装列表中查找匹配版本的 formula。
func phpInstalledFormula(version string) string {
	brew, err := execLookPath("brew")
	if err != nil {
		return ""
	}
	raw := runLoginShellOK(brew + ` list --versions 2>/dev/null`)
	for _, line := range linesNonEmpty(raw) {
		parts := strings.Fields(line)
		if len(parts) < 2 {
			continue
		}
		name := parts[0]
		if !strings.Contains(name, "php") {
			continue
		}
		tag := phpFormulaTag(name)
		if tag == "" {
			continue
		}
		if phpVersionActive(parts[1], version) || tag == version || strings.HasPrefix(version, tag) {
			return name
		}
	}
	return ""
}

// phpFormulaTag 从 formula 名提取版本标签（php@8.3 → 8.3）。
func phpFormulaTag(formula string) string {
	if idx := strings.LastIndex(formula, "php@"); idx >= 0 {
		return formula[idx+4:]
	}
	return ""
}

// detectPHPFromBrew 从 Homebrew 链接的 php 检测版本。
func detectPHPFromBrew() (version, binary string) {
	brew, err := execLookPath("brew")
	if err != nil {
		return "", ""
	}
	prefix := strings.TrimSpace(runLoginShellOK(brew + ` --prefix`))
	if prefix != "" {
		phpBin := shellJoin(prefix, "bin", "php")
		if fileExists(phpBin) {
			if ver := phpBinaryVersion(phpBin); ver != "" {
				return ver, phpBin
			}
		}
	}
	for formula, listedVer := range brewPHPInstalledMap() {
		if !strings.Contains(formula, "php") {
			continue
		}
		qf := quoteBrewFormula(formula)
		fp := strings.TrimSpace(runLoginShellOK(brew + ` --prefix ` + qf + ` 2>/dev/null`))
		if fp == "" {
			continue
		}
		phpBin := shellJoin(fp, "bin", "php")
		if !fileExists(phpBin) {
			continue
		}
		if ver := phpBinaryVersion(phpBin); ver != "" {
			return ver, phpBin
		}
		if listedVer != "" {
			return listedVer, phpBin
		}
	}
	return "", ""
}

// brewFormulaExists 判断 brew formula 是否存在。
func brewFormulaExists(formula string) bool {
	brew, err := execLookPath("brew")
	if err != nil {
		return false
	}
	qf := quoteBrewFormula(formula)
	_, err = runLoginShell(brew + ` info ` + qf + ` >/dev/null 2>&1`)
	return err == nil
}

// quoteBrewFormula 为 shell 安全引用 brew formula。
func quoteBrewFormula(formula string) string {
	return `'` + strings.ReplaceAll(formula, `'`, `'\''`) + `'`
}

// brewInstallFormula 安装 brew formula（跳过 auto-update 提示）。
func brewInstallFormula(formula string, emit func(string)) error {
	brew, err := execLookPath("brew")
	if err != nil {
		return err
	}
	qf := quoteBrewFormula(formula)
	emit("执行 brew install " + formula)
	script := `HOMEBREW_NO_AUTO_UPDATE=1 HOMEBREW_NO_ENV_HINTS=1 ` + brew + ` install ` + qf
	_, err = runLoginShellStream(script, 30*time.Minute, bindStreamEmit(emit))
	return err
}

// syncPhpShellEnv 将 brew PHP 路径写入 ~/.wworkbench/php.env 并接入 shell。
func syncPhpShellEnv(formula string) error {
	brew, err := execLookPath("brew")
	if err != nil {
		return err
	}
	qf := quoteBrewFormula(formula)
	formulaPrefix := strings.TrimSpace(runLoginShellOK(brew + ` --prefix ` + qf))
	brewRoot := strings.TrimSpace(runLoginShellOK(brew + ` --prefix`))
	if formulaPrefix == "" || brewRoot == "" {
		return errno.New(errno.CodeConnFailed, "无法解析 brew PHP 路径", formula)
	}
	phpBin := filepath.Join(formulaPrefix, "bin")
	brewBin := filepath.Join(brewRoot, "bin")
	content := `export PATH="` + shellQuotePath(phpBin) + `:` + shellQuotePath(brewBin) + `:$PATH"`
	return applyWorkbenchEnvFile("# wworkbench-php", "php.env", content)
}

// phpUnlinkScript 返回切换前 unlink 已链接 PHP 版本的命令片段。
func phpUnlinkScript(brew string) string {
	return `for f in $(` + brew + ` list --formula 2>/dev/null | grep -E '^php@'); do ` +
		brew + ` unlink "$f" 2>/dev/null; done; ` +
		brew + ` unlink php 2>/dev/null; `
}

// phpVersionActive 判断 PHP 版本是否为当前生效版本。
func phpVersionActive(current, target string) bool {
	current = strings.TrimSpace(current)
	target = strings.TrimSpace(target)
	if current == "" || target == "" {
		return false
	}
	if current == target {
		return true
	}
	return strings.HasPrefix(current, target+".")
}

// listPHPCatalogVersions 列出 Homebrew 可选 PHP 版本（含已安装状态）。
func listPHPCatalogVersions() []model.RuntimeVersionDO {
	brew, err := execLookPath("brew")
	if err != nil {
		return nil
	}
	activeFormula := detectPHPActiveFormula()
	installed := brewPHPInstalledMap()
	formulas := collectPHPCatalogFormulas(brew)
	if len(formulas) == 0 {
		return listPHPInstalledOnly(installed, activeFormula)
	}
	stable := brewPHPStableVersions(brew, formulas)
	var out []model.RuntimeVersionDO
	for _, formula := range formulas {
		tag := phpFormulaTag(formula)
		ver := installed[formula]
		if ver == "" {
			ver = stable[formula]
		}
		if ver == "" {
			ver = tag
		}
		out = append(out, model.RuntimeVersionDO{
			Version:   ver,
			Label:     formula,
			Formula:   formula,
			Installed: installed[formula] != "",
			Active:    formula == activeFormula,
		})
	}
	for formula, ver := range installed {
		if phpFormulaTag(formula) == "" || catalogHasFormula(out, formula) {
			continue
		}
		out = append(out, model.RuntimeVersionDO{
			Version:   ver,
			Label:     formula,
			Formula:   formula,
			Installed: true,
			Active:    formula == activeFormula,
		})
	}
	sortPHPVersions(out)
	return out
}

// listPHPInstalledOnly 无 catalog 时仅返回已安装 PHP。
func listPHPInstalledOnly(installed map[string]string, activeFormula string) []model.RuntimeVersionDO {
	if len(installed) == 0 {
		return nil
	}
	var out []model.RuntimeVersionDO
	for formula, ver := range installed {
		tag := phpFormulaTag(formula)
		label := formula
		if tag == "" {
			if formula != "php" {
				continue
			}
			tag = ver
			if tag == "" {
				tag = "system"
			}
		}
		out = append(out, model.RuntimeVersionDO{
			Version:   ver,
			Label:     label,
			Formula:   formula,
			Installed: true,
			Active:    formula == activeFormula,
		})
	}
	sortPHPVersions(out)
	return out
}

// catalogHasFormula 判断列表是否已包含 formula。
func catalogHasFormula(list []model.RuntimeVersionDO, formula string) bool {
	for _, item := range list {
		if item.Formula == formula {
			return true
		}
	}
	return false
}

// collectPHPCatalogFormulas 收集 Homebrew 可选 PHP formula。
func collectPHPCatalogFormulas(brew string) []string {
	raw := runLoginShellOK(brew + ` search --formula '/^php@[0-9]+\.[0-9]+$/' 2>/dev/null`)
	var formulas []string
	seen := map[string]bool{}
	for _, line := range linesNonEmpty(raw) {
		line = strings.TrimSpace(line)
		if strings.HasPrefix(line, "php@") {
			formulas = append(formulas, line)
			seen[line] = true
		}
	}
	if brewTapInstalled(brew, "shivammathur/php") {
		raw2 := runLoginShellOK(brew + ` formulae 2>/dev/null | grep -E '^shivammathur/php/php@[0-9]+\.[0-9]+$'`)
		for _, line := range linesNonEmpty(raw2) {
			line = strings.TrimSpace(line)
			if line != "" && !seen[line] {
				formulas = append(formulas, line)
				seen[line] = true
			}
		}
	}
	return formulas
}

// brewTapInstalled 判断 brew tap 是否已添加。
func brewTapInstalled(brew, tap string) bool {
	raw := runLoginShellOK(brew + ` tap 2>/dev/null`)
	for _, line := range linesNonEmpty(raw) {
		if strings.TrimSpace(line) == tap {
			return true
		}
	}
	return false
}

// brewPHPInstalledMap 返回已安装 PHP formula → 版本号。
func brewPHPInstalledMap() map[string]string {
	m := map[string]string{}
	brew, err := execLookPath("brew")
	if err != nil {
		return m
	}
	raw := runLoginShellOK(brew + ` list --versions 2>/dev/null`)
	for _, line := range linesNonEmpty(raw) {
		parts := strings.Fields(line)
		if len(parts) < 2 || !strings.Contains(parts[0], "php") {
			continue
		}
		name := parts[0]
		if phpFormulaTag(name) == "" && name != "php" {
			continue
		}
		m[name] = parts[1]
	}
	return m
}

// brewPHPStableVersions 批量查询 formula 的 stable 版本。
func brewPHPStableVersions(brew string, formulas []string) map[string]string {
	out := map[string]string{}
	if len(formulas) == 0 {
		return out
	}
	var quoted []string
	for _, f := range formulas {
		quoted = append(quoted, quoteBrewFormula(f))
	}
	raw := runLoginShellOK(brew + ` info --json=v2 ` + strings.Join(quoted, " ") + ` 2>/dev/null`)
	var data struct {
		Formulae []struct {
			Name     string `json:"name"`
			Versions struct {
				Stable string `json:"stable"`
			} `json:"versions"`
		} `json:"formulae"`
	}
	if err := json.Unmarshal([]byte(raw), &data); err != nil {
		return out
	}
	for _, f := range data.Formulae {
		if f.Versions.Stable != "" {
			out[f.Name] = f.Versions.Stable
		}
	}
	return out
}

// detectPHPActiveFormula 检测当前链接的 PHP formula。
func detectPHPActiveFormula() string {
	_, binary := detectPHPFromBrew()
	if binary == "" {
		return ""
	}
	brew, err := execLookPath("brew")
	if err != nil {
		return ""
	}
	real := strings.TrimSpace(runLoginShellOK(`readlink ` + quoteBrewFormula(binary) + ` 2>/dev/null`))
	if real == "" {
		real = binary
	}
	for formula := range brewPHPInstalledMap() {
		qf := quoteBrewFormula(formula)
		prefix := strings.TrimSpace(runLoginShellOK(brew + ` --prefix ` + qf + ` 2>/dev/null`))
		if prefix != "" && strings.Contains(real, prefix) {
			return formula
		}
		if prefix != "" && strings.Contains(binary, prefix) {
			return formula
		}
	}
	return ""
}

// sortPHPVersions 按版本标签降序排列（不因当前版本改变顺序）。
func sortPHPVersions(out []model.RuntimeVersionDO) {
	sort.Slice(out, func(i, j int) bool {
		ti := phpFormulaTag(out[i].Formula)
		if ti == "" {
			ti = out[i].Version
		}
		tj := phpFormulaTag(out[j].Formula)
		if tj == "" {
			tj = out[j].Version
		}
		if c := compareVersionTags(ti, tj); c != 0 {
			return c > 0
		}
		return out[i].Formula < out[j].Formula
	})
}

// compareVersionTags 比较主次版本号，返回值同整数比较。
func compareVersionTags(a, b string) int {
	pa := strings.Split(a, ".")
	pb := strings.Split(b, ".")
	for i := 0; i < 2; i++ {
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

// uninstallPHPFormula 卸载 brew PHP formula。
func uninstallPHPFormula(formula string, emit func(string)) error {
	brew, err := execLookPath("brew")
	if err != nil {
		return err
	}
	installed := brewPHPInstalledMap()
	if installed[formula] == "" {
		return errno.New(errno.CodeInvalidArg, "该 PHP 版本未安装", formula)
	}
	qf := quoteBrewFormula(formula)
	if detectPHPActiveFormula() == formula {
		emit("当前链接版本，先 unlink")
		_, _ = runLoginShell(phpUnlinkScript(brew))
	}
	emit("执行 brew uninstall " + formula)
	script := `HOMEBREW_NO_AUTO_UPDATE=1 HOMEBREW_NO_ENV_HINTS=1 ` + brew + ` uninstall ` + qf
	_, err = runLoginShellStream(script, 15*time.Minute, bindStreamEmit(emit))
	return err
}
