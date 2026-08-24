package environment

import (
	"bytes"
	"context"
	"fmt"
	"strings"
	"sync"
	"time"

	"WWorkbench/internal/errno"
	"WWorkbench/internal/model"
	"WWorkbench/internal/tunnel"

	"golang.org/x/crypto/ssh"
)

// sshShellRunner 经 SSH 登录 Shell 执行远端命令（仅 Linux/macOS）；复用一条连接避免列表探测反复拨号。
type sshShellRunner struct {
	host   model.SSHHostDO
	home   string // 缓存 $HOME
	mu     sync.Mutex
	client *ssh.Client
}

// newSSHShellRunner 拨号探测远端 OS，拒绝 Windows。
func newSSHShellRunner(host model.SSHHostDO) (*sshShellRunner, error) {
	r := &sshShellRunner{host: host}
	ctx, cancel := context.WithTimeout(context.Background(), 25*time.Second)
	defer cancel()
	if _, err := r.ensureClient(ctx); err != nil {
		return nil, errno.Wrap(errno.CodeConnFailed, "SSH 连接失败", err)
	}
	uname, err := r.LoginShell("uname -s 2>/dev/null || echo unknown", 20*time.Second)
	if err != nil {
		r.Close()
		return nil, errno.Wrap(errno.CodeConnFailed, "SSH 环境探测失败", err)
	}
	u := strings.ToUpper(strings.TrimSpace(uname))
	if strings.Contains(u, "MINGW") || strings.Contains(u, "MSYS") || strings.Contains(u, "CYGWIN") || strings.Contains(u, "WINDOWS_NT") {
		r.Close()
		return nil, errno.New(errno.CodeInvalidArg, "暂不支持 Windows 远端环境管理", host.Name)
	}
	home, _ := r.LoginShell("printf %s \"$HOME\"", 15*time.Second)
	r.home = strings.TrimSpace(home)
	return r, nil
}

// Close 关闭复用的 SSH 连接。
func (r *sshShellRunner) Close() {
	r.mu.Lock()
	defer r.mu.Unlock()
	if r.client != nil {
		_ = r.client.Close()
		r.client = nil
	}
}

func (r *sshShellRunner) IsWindows() bool { return false }

func (r *sshShellRunner) LoginShell(script string, timeout time.Duration) (string, error) {
	return r.runRemote(script, timeout, nil)
}

func (r *sshShellRunner) LoginShellStream(script string, timeout time.Duration, onLine func(line string, replaceLast bool)) (string, error) {
	return r.runRemote(script, timeout, onLine)
}

func (r *sshShellRunner) RunBinary(bin string, args ...string) (string, error) {
	parts := make([]string, 0, 1+len(args))
	parts = append(parts, posixSingleQuote(bin))
	for _, a := range args {
		parts = append(parts, posixSingleQuote(a))
	}
	return r.LoginShell(strings.Join(parts, " "), 20*time.Second)
}

func (r *sshShellRunner) FileExists(path string) bool {
	p := r.ExpandHome(path)
	out, err := r.LoginShell("test -e "+posixSingleQuote(p)+" && echo 1 || echo 0", 15*time.Second)
	return err == nil && strings.TrimSpace(out) == "1"
}

func (r *sshShellRunner) ExpandHome(path string) string {
	if path == "" || path[0] != '~' {
		return path
	}
	home := r.home
	if home == "" {
		home = "/root"
	}
	if path == "~" {
		return home
	}
	return home + strings.TrimPrefix(path, "~")
}

func (r *sshShellRunner) LookPath(bin string) (string, error) {
	out, err := r.LoginShell("command -v "+posixSingleQuote(bin), 15*time.Second)
	out = strings.TrimSpace(out)
	if err != nil || out == "" {
		return "", fmt.Errorf("找不到可执行文件 %s", bin)
	}
	return firstLine(out), nil
}

func (r *sshShellRunner) ensureClient(ctx context.Context) (*ssh.Client, error) {
	r.mu.Lock()
	defer r.mu.Unlock()
	if r.client != nil {
		return r.client, nil
	}
	client, err := tunnel.DialSSH(ctx, hostToTunnelSpec(r.host))
	if err != nil {
		return nil, err
	}
	r.client = client
	return client, nil
}

func (r *sshShellRunner) resetClient() {
	r.mu.Lock()
	defer r.mu.Unlock()
	if r.client != nil {
		_ = r.client.Close()
		r.client = nil
	}
}

func (r *sshShellRunner) runRemote(script string, timeout time.Duration, onLine func(line string, replaceLast bool)) (string, error) {
	ctx, cancel := context.WithTimeout(context.Background(), timeout)
	defer cancel()

	runOnce := func() (string, error) {
		client, err := r.ensureClient(ctx)
		if err != nil {
			return "", err
		}
		sess, err := client.NewSession()
		if err != nil {
			return "", errno.Wrap(errno.CodeConnFailed, "创建 SSH 会话失败", err)
		}
		defer sess.Close()
		cmdline := "bash -lc " + posixSingleQuote(script)
		if onLine == nil {
			return r.runCombined(ctx, sess, cmdline)
		}
		return r.runStream(ctx, sess, cmdline, onLine)
	}

	out, err := runOnce()
	if err == nil {
		return out, nil
	}
	// 连接断开时重连一次
	if isSSHConnError(err) {
		r.resetClient()
		return runOnce()
	}
	return out, err
}

func isSSHConnError(err error) bool {
	if err == nil {
		return false
	}
	msg := strings.ToLower(err.Error())
	return strings.Contains(msg, "connection") ||
		strings.Contains(msg, "EOF") ||
		strings.Contains(msg, "broken pipe") ||
		strings.Contains(msg, "use of closed")
}

// hostToTunnelSpec 将 SSH 主机转为隧道规格（不依赖 terminal 包，避免循环引用）。
func hostToTunnelSpec(h model.SSHHostDO) model.TunnelSpecDO {
	port := h.Port
	if port <= 0 {
		port = 22
	}
	return model.TunnelSpecDO{
		Enabled:  true,
		Host:     h.Host,
		Port:     port,
		User:     h.User,
		KeyPath:  h.KeyPath,
		Password: h.Password,
	}
}

func (r *sshShellRunner) runCombined(ctx context.Context, sess *ssh.Session, cmdline string) (string, error) {
	type result struct {
		out []byte
		err error
	}
	done := make(chan result, 1)
	go func() {
		b, e := sess.CombinedOutput(cmdline)
		done <- result{out: b, err: e}
	}()
	select {
	case <-ctx.Done():
		return "", errno.New(errno.CodeConnFailed, "远端命令执行超时", cmdline)
	case res := <-done:
		text := strings.TrimSpace(string(res.out))
		if res.err != nil && text == "" {
			return "", errno.Wrap(errno.CodeConnFailed, "远端命令执行失败", res.err)
		}
		if ctx.Err() == context.DeadlineExceeded {
			return text, errno.New(errno.CodeConnFailed, "安装超时，请稍后在终端检查进度", "")
		}
		if len(text) > 256*1024 {
			text = text[:256*1024] + "\n…(输出已截断)"
		}
		return text, res.err
	}
}

func (r *sshShellRunner) runStream(ctx context.Context, sess *ssh.Session, cmdline string, onLine func(line string, replaceLast bool)) (string, error) {
	stdout, err := sess.StdoutPipe()
	if err != nil {
		return "", err
	}
	stderr, err := sess.StderrPipe()
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
		onLine(line, replaceLast)
	}
	if err := sess.Start(cmdline); err != nil {
		return "", errno.Wrap(errno.CodeConnFailed, "启动远端命令失败", err)
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
	done := make(chan error, 1)
	go func() {
		wg.Wait()
		done <- sess.Wait()
	}()
	select {
	case <-ctx.Done():
		_ = sess.Signal(ssh.SIGKILL)
		return strings.TrimSpace(fullBuf.String()), errno.New(errno.CodeConnFailed, "安装超时，请稍后在终端检查进度", "")
	case err := <-done:
		out := strings.TrimSpace(fullBuf.String())
		if err != nil {
			msg := out
			if msg == "" {
				msg = err.Error()
			}
			return out, &shellExitError{msg: msg, err: err}
		}
		return out, nil
	}
}
