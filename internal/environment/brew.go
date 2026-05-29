package environment

import "strings"

// brewPrefix 返回 brew formula 安装前缀。
func brewPrefix(formula string) string {
	if !hasBrew() {
		return ""
	}
	brew, err := execLookPath("brew")
	if err != nil {
		return ""
	}
	out := strings.TrimSpace(runLoginShellOK(brew + ` --prefix ` + formula + ` 2>/dev/null`))
	if out == "" || strings.Contains(out, "Error") {
		return ""
	}
	return out
}

// brewInstall 通过 Homebrew 安装 formula。
func brewInstall(formula string, emit func(string)) error {
	return brewInstallFormula(formula, emit)
}

// ensureBrew 若未安装 Homebrew 则先安装。
func ensureBrew(emit func(string)) error {
	if hasBrew() {
		return nil
	}
	return installBrewManager(emit)
}
