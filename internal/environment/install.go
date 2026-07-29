package environment

import (
	"strings"

	"WWorkbench/internal/errno"
	"WWorkbench/internal/model"
)

// InstallVersion 安装指定语言版本（不自动切换）。
func (m *Manager) InstallVersion(lang, version string) error {
	version = strings.TrimSpace(version)
	if version == "" {
		return errno.New(errno.CodeInvalidArg, "版本号不能为空", lang)
	}
	emit := m.installEmitter(lang)
	emit("开始安装 " + version + " …")
	var err error
	switch lang {
	case langNode:
		err = installNodeVersion(version, emit)
	case langGo:
		err = installGoVersion(version, emit)
	case langPHP:
		err = installPHPVersion(version, emit)
	case langJava:
		err = installJavaVersion(version, emit)
	default:
		return errno.New(errno.CodeInvalidArg, "未知语言运行时", lang)
	}
	if err != nil {
		emit("安装失败")
		return errno.Wrap(errno.CodeConnFailed, "安装版本失败", err)
	}
	emit("安装完成")
	return nil
}

// UninstallVersion 卸载指定语言版本。
func (m *Manager) UninstallVersion(lang, version string) error {
	version = strings.TrimSpace(version)
	if version == "" {
		return errno.New(errno.CodeInvalidArg, "版本号不能为空", lang)
	}
	emit := m.installEmitter(lang)
	emit("开始卸载 " + version + " …")
	var err error
	switch lang {
	case langNode:
		err = uninstallNodeVersion(version, emit)
	case langGo:
		err = uninstallGoVersion(version, emit)
	case langPHP:
		formula, ferr := phpBrewFormula(version)
		if ferr != nil {
			return ferr
		}
		err = uninstallPHPFormula(formula, emit)
	case langJava:
		err = uninstallJavaVersion(version, emit)
	default:
		return errno.New(errno.CodeInvalidArg, "该语言暂不支持卸载", lang)
	}
	if err != nil {
		emit("卸载失败")
		return errno.Wrap(errno.CodeConnFailed, "卸载版本失败", err)
	}
	emit("卸载完成")
	return nil
}

// EnsureVersion 若未安装则先安装，再切换版本。
func (m *Manager) EnsureVersion(lang, version string) error {
	version = strings.TrimSpace(version)
	if version == "" {
		return errno.New(errno.CodeInvalidArg, "版本号不能为空", lang)
	}
	if !versionInstalled(lang, version) {
		if err := m.InstallVersion(lang, version); err != nil {
			return err
		}
	}
	return m.UseVersion(lang, version)
}

// versionInstalled 判断版本是否已安装。
func versionInstalled(lang, version string) bool {
	list, err := listVersionsForLang(lang)
	if err != nil || len(list) == 0 {
		return false
	}
	target := normalizeVersionForLang(lang, version)
	for _, item := range list {
		if !item.Installed {
			continue
		}
		if lang == langPHP && strings.Contains(version, "php@") && item.Formula == version {
			return true
		}
		if lang == langJava && item.Formula != "" && item.Formula == version {
			return true
		}
		if versionMatches(lang, item.Version, target) {
			return true
		}
		if lang == langPHP && item.Formula != "" {
			tag := phpFormulaTag(item.Formula)
			if tag == target || strings.HasPrefix(item.Version, target) {
				return true
			}
		}
	}
	return false
}

// listVersionsForLang 列出某语言已安装版本。
func listVersionsForLang(lang string) ([]model.RuntimeVersionDO, error) {
	switch lang {
	case langNode:
		return listNodeVersions(), nil
	case langGo:
		return listGoVersions(), nil
	case langPHP:
		return listPHPVersions(), nil
	case langJava:
		return listJavaVersions(), nil
	default:
		return nil, errno.New(errno.CodeInvalidArg, "未知语言运行时", lang)
	}
}

// normalizeVersionForLang 规范化待匹配版本号。
func normalizeVersionForLang(lang, version string) string {
	version = strings.TrimSpace(strings.TrimPrefix(version, "v"))
	switch lang {
	case langNode:
		return normalizeNodeVersion(version)
	default:
		return version
	}
}

// versionMatches 判断已安装版本是否满足目标版本。
func versionMatches(lang, installed, target string) bool {
	installed = normalizeVersionForLang(lang, installed)
	target = normalizeVersionForLang(lang, target)
	if installed == target {
		return true
	}
	if lang == langNode || lang == langGo || lang == langPHP {
		return strings.HasPrefix(installed, target+".") || strings.HasPrefix(installed, target)
	}
	return strings.Contains(installed, target)
}
