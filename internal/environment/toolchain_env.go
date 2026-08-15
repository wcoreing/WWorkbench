package environment

import (
	"os"
	"path/filepath"
	"strings"
)

// AugmentLocalEnv 为内置终端注入当前 toolchain 环境。
func AugmentLocalEnv(base []string) []string {
	env := append([]string{}, base...)
	if root, bin, ok := activeGoPaths(); ok {
		env = setEnvList(env, "GOROOT", root)
		env = prependPathEnv(env, bin)
	}
	if home, bin, ok := activeJavaPaths(); ok {
		env = setEnvList(env, "JAVA_HOME", home)
		env = prependPathEnv(env, bin)
	}
	if dir, ok := activePHPPaths(); ok {
		env = prependPathEnv(env, dir)
	}
	return env
}

// activeGoPaths 返回当前 WWorkbench Go 的 GOROOT 与 bin。
func activeGoPaths() (root, bin string, ok bool) {
	ver := readToolchainCurrent(langGo)
	if ver == "" {
		return "", "", false
	}
	dir, err := toolchainVersionDir(langGo, ver)
	if err != nil || !fileExists(filepath.Join(dir, "bin", goExeName())) {
		return "", "", false
	}
	return dir, filepath.Join(dir, "bin"), true
}

// activeJavaPaths 返回当前 WWorkbench JDK 的 JAVA_HOME 与 bin。
func activeJavaPaths() (home, bin string, ok bool) {
	ver := readToolchainCurrent(langJava)
	if ver == "" {
		return "", "", false
	}
	dir, err := toolchainVersionDir(langJava, ver)
	if err != nil || !fileExists(filepath.Join(dir, "bin", javaExeName())) {
		return "", "", false
	}
	return dir, filepath.Join(dir, "bin"), true
}

// activePHPPaths 返回当前 WWorkbench PHP 目录（php.exe 在根目录）。
func activePHPPaths() (dir string, ok bool) {
	ver := readToolchainCurrent(langPHP)
	if ver == "" {
		return "", false
	}
	d, err := toolchainVersionDir(langPHP, ver)
	if err != nil || !fileExists(filepath.Join(d, phpExeName())) {
		return "", false
	}
	return d, true
}

// goExeName / javaExeName 平台可执行文件名。
func goExeName() string {
	if isWindows() {
		return "go.exe"
	}
	return "go"
}

func javaExeName() string {
	if isWindows() {
		return "java.exe"
	}
	return "java"
}

// activateGoToolchain 激活 Go：进程环境 + 持久化。
func activateGoToolchain(version string) error {
	dir, err := toolchainVersionDir(langGo, version)
	if err != nil {
		return err
	}
	bin := filepath.Join(dir, "bin")
	if !fileExists(filepath.Join(bin, goExeName())) {
		return errInvalidVersion
	}
	if err := writeToolchainCurrent(langGo, version); err != nil {
		return err
	}
	_ = os.Setenv("GOROOT", dir)
	refreshProcessToolchainPath()
	return persistToolchainEnv(langGo, dir, bin)
}

// activateJavaToolchain 激活 Java。
func activateJavaToolchain(version string) error {
	dir, err := toolchainVersionDir(langJava, version)
	if err != nil {
		return err
	}
	bin := filepath.Join(dir, "bin")
	if !fileExists(filepath.Join(bin, javaExeName())) {
		return errInvalidVersion
	}
	if err := writeToolchainCurrent(langJava, version); err != nil {
		return err
	}
	_ = os.Setenv("JAVA_HOME", dir)
	refreshProcessToolchainPath()
	return persistToolchainEnv(langJava, dir, bin)
}

// activatePHPToolchain 激活 PHP。
func activatePHPToolchain(version string) error {
	dir, err := toolchainVersionDir(langPHP, version)
	if err != nil {
		return err
	}
	if !fileExists(filepath.Join(dir, phpExeName())) {
		return errInvalidVersion
	}
	if err := writeToolchainCurrent(langPHP, version); err != nil {
		return err
	}
	refreshProcessToolchainPath()
	return persistToolchainEnv(langPHP, dir, dir)
}

// refreshProcessToolchainPath 按当前激活的 Go/Java 重建进程 PATH。
func refreshProcessToolchainPath() {
	parts := splitPathList(os.Getenv("PATH"))
	parts = rebuildWorkbenchPathBins(parts)
	_ = os.Setenv("PATH", strings.Join(parts, string(os.PathListSeparator)))
}

// rebuildWorkbenchPathBins 移除旧 toolchain bin，再前置当前激活的。
func rebuildWorkbenchPathBins(parts []string) []string {
	if root, err := toolchainLangDir(langGo); err == nil {
		parts = removePathUnder(parts, root)
	}
	if root, err := toolchainLangDir(langJava); err == nil {
		parts = removePathUnder(parts, root)
	}
	if root, err := toolchainLangDir(langPHP); err == nil {
		parts = removePathUnder(parts, root)
	}
	if dir, ok := activePHPPaths(); ok {
		parts = append([]string{dir}, parts...)
	}
	if _, bin, ok := activeJavaPaths(); ok {
		parts = append([]string{bin}, parts...)
	}
	if _, bin, ok := activeGoPaths(); ok {
		parts = append([]string{bin}, parts...)
	}
	return parts
}

// prependProcessPath 兼容旧调用。
func prependProcessPath(bin string) {
	_ = bin
	refreshProcessToolchainPath()
}

// setEnvList 设置环境变量切片中的键。
func setEnvList(env []string, key, value string) []string {
	prefix := key + "="
	out := make([]string, 0, len(env)+1)
	found := false
	for _, e := range env {
		if strings.HasPrefix(strings.ToUpper(e), strings.ToUpper(prefix)) {
			out = append(out, key+"="+value)
			found = true
			continue
		}
		out = append(out, e)
	}
	if !found {
		out = append(out, key+"="+value)
	}
	return out
}

// prependPathEnv 在环境切片中前置 PATH 目录。
func prependPathEnv(env []string, bin string) []string {
	const key = "PATH"
	prefix := key + "="
	for i, e := range env {
		if strings.HasPrefix(strings.ToUpper(e), prefix) {
			rest := e[len(prefix):]
			parts := splitPathList(rest)
			parts = removePathPrefix(parts, bin)
			parts = append([]string{bin}, parts...)
			env[i] = key + "=" + strings.Join(parts, string(os.PathListSeparator))
			return env
		}
	}
	return append(env, key+"="+bin)
}

func splitPathList(path string) []string {
	var out []string
	for _, p := range strings.Split(path, string(os.PathListSeparator)) {
		p = strings.TrimSpace(p)
		if p != "" {
			out = append(out, p)
		}
	}
	return out
}

func removePathPrefix(parts []string, target string) []string {
	target = filepath.Clean(target)
	var out []string
	for _, p := range parts {
		if filepath.Clean(p) == target {
			continue
		}
		out = append(out, p)
	}
	return out
}

func removePathUnder(parts []string, root string) []string {
	root = filepath.Clean(root)
	var out []string
	for _, p := range parts {
		clean := filepath.Clean(p)
		if clean == root || strings.HasPrefix(clean, root+string(os.PathSeparator)) {
			continue
		}
		out = append(out, p)
	}
	return out
}
