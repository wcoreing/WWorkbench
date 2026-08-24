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
	return currentRunner().RunBinary(bin, args...)
}

// runBinaryOK 执行二进制，失败返回空字符串。
func runBinaryOK(bin string, args ...string) string {
	out, _ := runBinary(bin, args...)
	return strings.TrimSpace(out)
}

// isWindows 是否运行在当前 Runner 目标（本机或远端）的 Windows。
func isWindows() bool {
	return currentRunner().IsWindows()
}

// isDarwin 当前 Runner 目标是否为 macOS（本机或 SSH）。
func isDarwin() bool {
	if isWindows() {
		return false
	}
	u := strings.TrimSpace(runLoginShellOK(`uname -s 2>/dev/null`))
	return strings.EqualFold(u, "Darwin")
}

// isLocalWindows 本机是否为 Windows（不经 Runner）。
func isLocalWindows() bool {
	return runtime.GOOS == "windows"
}

// runLoginShell 在登录 Shell 中执行脚本并返回标准输出。
func runLoginShell(script string) (string, error) {
	return currentRunner().LoginShell(script, 2*time.Minute)
}

// runLoginShellLong 执行可能较慢的安装命令。
func runLoginShellLong(script string) (string, error) {
	return currentRunner().LoginShell(script, 20*time.Minute)
}

// runLoginShellStream 流式执行脚本并逐行回调日志；replaceLast=true 表示来自 \r 刷新。
func runLoginShellStream(script string, timeout time.Duration, onLine func(line string, replaceLast bool)) (string, error) {
	return currentRunner().LoginShellStream(script, timeout, onLine)
}

// localRunBinary 本机直接执行二进制。
func localRunBinary(bin string, args ...string) (string, error) {
	ctx, cancel := context.WithTimeout(context.Background(), 20*time.Second)
	defer cancel()
	cmd := exec.CommandContext(ctx, bin, args...)
	out, err := cmd.CombinedOutput()
	return strings.TrimSpace(string(out)), err
}

// localLoginShellStream 本机流式登录 Shell。
func localLoginShellStream(script string, timeout time.Duration, onLine func(line string, replaceLast bool)) (string, error) {
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
	emit := func(line string, replaceLast bool) {
		line = strings.TrimRight(line, "\r\n")
		if strings.TrimSpace(line) == "" && !replaceLast {
			return
		}
		mu.Lock()
		if !replaceLast {
			fullBuf.WriteString(line)
			fullBuf.WriteByte('\n')
		}
		mu.Unlock()
		if onLine != nil {
			onLine(line, replaceLast)
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

// bindStreamEmit 将 installEmitter(func(string)) 接到流式回调；\r 进度用前缀传给 emitter（原样，不过滤）。
func bindStreamEmit(emit func(string)) func(line string, replaceLast bool) {
	if emit == nil {
		return nil
	}
	return func(line string, replaceLast bool) {
		if replaceLast {
			emit("\r" + line)
			return
		}
		emit(line)
	}
}

// streamPipe 读取子进程输出：\n 追加一行，\r 覆盖上一行（原样进度）。
func streamPipe(r io.Reader, emit func(line string, replaceLast bool)) {
	br := bufio.NewReader(r)
	var buf strings.Builder
	flush := func(replaceLast bool) {
		if buf.Len() == 0 {
			return
		}
		emit(buf.String(), replaceLast)
		buf.Reset()
	}
	for {
		b, err := br.ReadByte()
		if err != nil {
			flush(false)
			return
		}
		if b == '\r' {
			flush(true)
			continue
		}
		if b == '\n' {
			flush(false)
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

// localLoginShellTimeout 本机登录 Shell（带超时）。
func localLoginShellTimeout(script string, timeout time.Duration) (string, error) {
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

// expandHome 展开路径中的 ~（经当前 Runner）。
func expandHome(path string) string {
	return currentRunner().ExpandHome(path)
}

// localExpandHome 本机展开 ~。
func localExpandHome(path string) string {
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

// fileExists 判断路径存在（经当前 Runner）。
func fileExists(path string) bool {
	return currentRunner().FileExists(path)
}

// localFileExists 判断本机路径存在（不经 SSH Runner；用于本机 tempfile / toolchain 落盘）。
func localFileExists(path string) bool {
	_, err := os.Stat(localExpandHome(path))
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

// firstLine 取首行非空内容。
func firstLine(raw string) string {
	lines := linesNonEmpty(raw)
	if len(lines) == 0 {
		return ""
	}
	return lines[0]
}

// shellJoin 用 / 拼接 shell 路径（远端多为 Linux，避免本机 filepath 风格渗入脚本）。
func shellJoin(parts ...string) string {
	cleaned := make([]string, 0, len(parts))
	for _, p := range parts {
		p = strings.TrimSpace(p)
		if p == "" {
			continue
		}
		cleaned = append(cleaned, strings.Trim(p, "/"))
	}
	if len(cleaned) == 0 {
		return ""
	}
	if strings.HasPrefix(strings.TrimSpace(parts[0]), "/") {
		return "/" + strings.Join(cleaned, "/")
	}
	return strings.Join(cleaned, "/")
}
