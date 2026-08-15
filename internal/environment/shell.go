package environment

import (
	"bufio"
	"bytes"
	"context"
	"io"
	"os"
	"os/exec"
	"regexp"
	"runtime"
	"strings"
	"sync"
	"time"
)

// runBinary 直接执行二进制并合并 stdout/stderr。
func runBinary(bin string, args ...string) (string, error) {
	ctx, cancel := context.WithTimeout(context.Background(), 20*time.Second)
	defer cancel()
	cmd := exec.CommandContext(ctx, bin, args...)
	out, err := cmd.CombinedOutput()
	return strings.TrimSpace(string(out)), err
}

// runBinaryOK 执行二进制，失败返回空字符串。
func runBinaryOK(bin string, args ...string) string {
	out, _ := runBinary(bin, args...)
	return strings.TrimSpace(out)
}

// isWindows 是否运行在 Windows。
func isWindows() bool {
	return runtime.GOOS == "windows"
}

// runLoginShell 在登录 Shell 中执行脚本并返回标准输出。
func runLoginShell(script string) (string, error) {
	return runLoginShellTimeout(script, 2*time.Minute)
}

// runLoginShellLong 执行可能较慢的安装命令。
func runLoginShellLong(script string) (string, error) {
	return runLoginShellTimeout(script, 20*time.Minute)
}

// runLoginShellStream 流式执行脚本并逐行回调日志。
func runLoginShellStream(script string, timeout time.Duration, onLine func(string)) (string, error) {
	shell := os.Getenv("SHELL")
	if shell == "" {
		shell = "/bin/zsh"
	}
	ctx, cancel := context.WithTimeout(context.Background(), timeout)
	defer cancel()
	cmd := exec.CommandContext(ctx, shell, "-lc", script)
	stdout, err := cmd.StdoutPipe()
	if err != nil {
		return "", err
	}
	stderr, err := cmd.StderrPipe()
	if err != nil {
		return "", err
	}
	var fullBuf bytes.Buffer
	var mu sync.Mutex
	emit := func(line string) {
		line = strings.TrimSpace(strings.TrimRight(line, "\r"))
		if line == "" {
			return
		}
		mu.Lock()
		fullBuf.WriteString(line)
		fullBuf.WriteByte('\n')
		mu.Unlock()
		if onLine != nil {
			onLine(line)
		}
	}
	if err := cmd.Start(); err != nil {
		return "", err
	}
	var wg sync.WaitGroup
	wg.Add(2)
	go func() {
		defer wg.Done()
		streamPipe(stdout, emit)
	}()
	go func() {
		defer wg.Done()
		streamPipe(stderr, emit)
	}()
	wg.Wait()
	err = cmd.Wait()
	out := strings.TrimSpace(fullBuf.String())
	if err != nil {
		msg := out
		if msg == "" {
			msg = err.Error()
		}
		if ctx.Err() == context.DeadlineExceeded {
			msg = "安装超时，请稍后在终端检查进度"
		}
		return out, &shellExitError{msg: msg, err: err}
	}
	return out, nil
}

// filterEmit 过滤进度条噪声，只输出有意义日志。
func filterEmit(emit func(string)) func(string) {
	if emit == nil {
		return nil
	}
	return func(line string) {
		if isProgressNoise(line) {
			return
		}
		emit(line)
	}
}

// isProgressNoise 判断是否为 curl/wget 进度条碎片。
func isProgressNoise(line string) bool {
	line = strings.TrimSpace(line)
	if line == "" {
		return true
	}
	for _, r := range line {
		switch r {
		case '#', '-', '=', 'O', ' ', '\t', '.', '%', '\\', '|', '/':
			continue
		default:
			return false
		}
	}
	return true
}

// streamPipe 读取子进程输出，兼容 \r 进度条避免管道死锁。
func streamPipe(r io.Reader, emit func(string)) {
	br := bufio.NewReader(r)
	var buf strings.Builder
	flush := func() {
		if buf.Len() == 0 {
			return
		}
		emit(buf.String())
		buf.Reset()
	}
	for {
		b, err := br.ReadByte()
		if err != nil {
			flush()
			return
		}
		if b == '\n' || b == '\r' {
			flush()
			continue
		}
		buf.WriteByte(b)
	}
}

// shellExitError shell 命令非零退出。
type shellExitError struct {
	msg string
	err error
}

func (e *shellExitError) Error() string {
	return e.msg
}

func (e *shellExitError) Unwrap() error {
	return e.err
}

// runLoginShellTimeout 在登录 Shell 中执行脚本（带超时）。
func runLoginShellTimeout(script string, timeout time.Duration) (string, error) {
	shell := os.Getenv("SHELL")
	if shell == "" {
		shell = "/bin/zsh"
	}
	ctx, cancel := context.WithTimeout(context.Background(), timeout)
	defer cancel()
	cmd := exec.CommandContext(ctx, shell, "-lc", script)
	var stdout, stderr bytes.Buffer
	cmd.Stdout = &stdout
	cmd.Stderr = &stderr
	if err := cmd.Run(); err != nil {
		msg := strings.TrimSpace(stderr.String())
		if msg == "" {
			msg = err.Error()
		}
		if ctx.Err() == context.DeadlineExceeded {
			msg = "安装超时，请稍后在终端检查进度"
		}
		return strings.TrimSpace(stdout.String()), err
	}
	return strings.TrimSpace(stdout.String()), nil
}

var shellVersionRe = regexp.MustCompile(`^[a-zA-Z0-9._+\-]+$`)

// quoteShellVersion 校验并返回可嵌入 shell 的版本号。
func quoteShellVersion(version string) (string, error) {
	version = strings.TrimSpace(version)
	if version == "" || !shellVersionRe.MatchString(version) {
		return "", errInvalidVersion
	}
	return version, nil
}

// runLoginShellOK 执行脚本，失败时返回空字符串。
func runLoginShellOK(script string) string {
	out, _ := runLoginShell(script)
	return strings.TrimSpace(out)
}

// expandHome 展开路径中的 ~。
func expandHome(path string) string {
	if path == "" || path[0] != '~' {
		return path
	}
	home, err := os.UserHomeDir()
	if err != nil {
		return path
	}
	if path == "~" {
		return home
	}
	return home + strings.TrimPrefix(path, "~")
}

// fileExists 判断路径存在。
func fileExists(path string) bool {
	_, err := os.Stat(expandHome(path))
	return err == nil
}

// linesNonEmpty 过滤非空行。
func linesNonEmpty(raw string) []string {
	var out []string
	for _, line := range strings.Split(raw, "\n") {
		line = strings.TrimSpace(line)
		if line != "" {
			out = append(out, line)
		}
	}
	return out
}

// firstLine 取首行。
func firstLine(raw string) string {
	lines := linesNonEmpty(raw)
	if len(lines) == 0 {
		return ""
	}
	return lines[0]
}
