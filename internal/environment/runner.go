package environment

import (
	"os"
	"os/exec"
	"strings"
	"sync"
	"time"
)

// ShellRunner 本机或 SSH 上的 shell 执行面。
type ShellRunner interface {
	IsWindows() bool
	LoginShell(script string, timeout time.Duration) (string, error)
	LoginShellStream(script string, timeout time.Duration, onLine func(line string, replaceLast bool)) (string, error)
	RunBinary(bin string, args ...string) (string, error)
	FileExists(path string) bool
	ExpandHome(path string) string
	LookPath(bin string) (string, error)
}

var (
	runnerMu     sync.RWMutex
	activeRunner ShellRunner = localShellRunner{}
)

func currentRunner() ShellRunner {
	runnerMu.RLock()
	defer runnerMu.RUnlock()
	return activeRunner
}

func setActiveRunner(r ShellRunner) {
	runnerMu.Lock()
	activeRunner = r
	runnerMu.Unlock()
}

// localShellRunner 本机执行面（现有行为）。
type localShellRunner struct{}

func (localShellRunner) IsWindows() bool {
	return isLocalWindows()
}

func (localShellRunner) LoginShell(script string, timeout time.Duration) (string, error) {
	return localLoginShellTimeout(script, timeout)
}

func (localShellRunner) LoginShellStream(script string, timeout time.Duration, onLine func(line string, replaceLast bool)) (string, error) {
	return localLoginShellStream(script, timeout, onLine)
}

func (localShellRunner) RunBinary(bin string, args ...string) (string, error) {
	return localRunBinary(bin, args...)
}

func (localShellRunner) FileExists(path string) bool {
	_, err := os.Stat(localExpandHome(path))
	return err == nil
}

func (localShellRunner) ExpandHome(path string) string {
	return localExpandHome(path)
}

func (localShellRunner) LookPath(bin string) (string, error) {
	return exec.LookPath(bin)
}

// runnerIsLocal 当前是否为本机 Runner（非 SSH）。
func runnerIsLocal() bool {
	_, ok := currentRunner().(localShellRunner)
	return ok
}

// posixSingleQuote 将字符串包成 POSIX 单引号字面量。
func posixSingleQuote(s string) string {
	return "'" + strings.ReplaceAll(s, "'", `'\''`) + "'"
}
