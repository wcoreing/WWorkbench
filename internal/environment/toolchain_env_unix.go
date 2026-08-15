//go:build !windows

package environment

import (
	"path/filepath"
)

// persistToolchainEnv 写入 ~/.wworkbench/*.env 供 shell / 内置终端加载。
func persistToolchainEnv(lang, homeOrRoot, bin string) error {
	switch lang {
	case langGo:
		content := `export GOROOT="` + shellQuotePath(homeOrRoot) + `"
export PATH="` + shellQuotePath(bin) + `:$PATH"
`
		return applyWorkbenchEnvFile("# wworkbench-go-toolchain", "go.env", content)
	case langJava:
		content := `export JAVA_HOME="` + shellQuotePath(homeOrRoot) + `"
export PATH="` + shellQuotePath(bin) + `:$PATH"
`
		return applyWorkbenchEnvFile("# wworkbench-java-toolchain", "java.env", content)
	case langPHP:
		content := `export PATH="` + shellQuotePath(bin) + `:$PATH"
`
		return applyWorkbenchEnvFile("# wworkbench-php-toolchain", "php.env", content)
	default:
		_ = filepath.Base(homeOrRoot)
		return nil
	}
}
