package docker

import (
	"context"
	"fmt"
	"io"
	"net"
	"net/http"
	"strings"
	"sync"
	"time"

	"WNavicat/internal/errno"
	"WNavicat/internal/model"
	"WNavicat/internal/tunnel"

	"github.com/docker/docker/client"
	"golang.org/x/crypto/ssh"
)

var defaultRemoteDockerSockets = []string{
	"/var/run/docker.sock",
	"/run/docker.sock",
	"/var/snap/docker/common/run/docker.sock",
}

// sshDockerClient 经 SSH 转发的 Docker 客户端，关闭时一并释放 SSH 连接。
type sshDockerClient struct {
	*client.Client
	ssh        *ssh.Client
	socketPath string
	stdioConn  *stdioConn
}

// Close 关闭 Docker 与 SSH 连接。
func (c *sshDockerClient) Close() error {
	if c.Client != nil {
		_ = c.Client.Close()
	}
	if c.stdioConn != nil {
		_ = c.stdioConn.Close()
	}
	if c.ssh != nil {
		return c.ssh.Close()
	}
	return nil
}

// remoteDockerSocketScript 在远端探测可用的 Docker socket 路径。
const remoteDockerSocketScript = `for s in /var/run/docker.sock /run/docker.sock /var/snap/docker/common/run/docker.sock "$HOME/.docker/run/docker.sock" "/run/user/$(id -u)/docker.sock"; do
if [ -n "$s" ] && [ -S "$s" ] 2>/dev/null; then echo "$s"; exit 0; fi
done
exit 1`

// dialSSHDocker 经 SSH 隧道连接远端 Docker 引擎。
func dialSSHDocker(ctx context.Context, spec model.TunnelSpecDO) (*sshDockerClient, error) {
	sshClient, err := tunnel.DialSSH(ctx, spec)
	if err != nil {
		return nil, err
	}

	if cli, socket, err := tryUnixForwardDocker(ctx, sshClient); err == nil {
		return &sshDockerClient{Client: cli, ssh: sshClient, socketPath: socket}, nil
	} else if cli, stdio, err2 := tryDialStdioDocker(ctx, sshClient); err2 == nil {
		return &sshDockerClient{Client: cli, ssh: sshClient, socketPath: "docker system dial-stdio", stdioConn: stdio}, nil
	} else {
		_ = sshClient.Close()
		return nil, wrapRemoteDockerError(err, err2)
	}
}

// tryUnixForwardDocker 尝试经 SSH Unix 转发连接 Docker API。
func tryUnixForwardDocker(ctx context.Context, sshClient *ssh.Client) (*client.Client, string, error) {
	paths := candidateRemoteSockets(sshClient)
	var lastErr error
	seen := map[string]bool{}
	for _, path := range paths {
		if path == "" || seen[path] {
			continue
		}
		seen[path] = true
		cli, err := newDockerClientOverSSH(sshClient, path)
		if err != nil {
			lastErr = err
			continue
		}
		if _, err := cli.Ping(ctx); err != nil {
			_ = cli.Close()
			lastErr = err
			continue
		}
		return cli, path, nil
	}
	if lastErr == nil {
		lastErr = fmt.Errorf("unix forward failed")
	}
	return nil, "", lastErr
}

// tryDialStdioDocker 经 docker system dial-stdio 连接（兼容禁用 Unix 转发的 sshd）。
func tryDialStdioDocker(ctx context.Context, sshClient *ssh.Client) (*client.Client, *stdioConn, error) {
	stdio, err := openDockerDialStdio(sshClient)
	if err != nil {
		return nil, nil, err
	}
	httpClient := &http.Client{
		Transport: &http.Transport{
			DialContext: func(ctx context.Context, network, addr string) (net.Conn, error) {
				return stdio, nil
			},
			MaxIdleConns:          1,
			MaxIdleConnsPerHost:   1,
			IdleConnTimeout:       90 * time.Second,
			ExpectContinueTimeout: 1 * time.Second,
		},
	}
	cli, err := client.NewClientWithOpts(
		client.WithHost("http://127.0.0.1"),
		client.WithAPIVersionNegotiation(),
		client.WithHTTPClient(httpClient),
	)
	if err != nil {
		_ = stdio.Close()
		return nil, nil, errno.Wrap(errno.CodeConnFailed, "创建远程 Docker 客户端失败", err)
	}
	if _, err := cli.Ping(ctx); err != nil {
		_ = cli.Close()
		_ = stdio.Close()
		return nil, nil, err
	}
	return cli, stdio, nil
}

// candidateRemoteSockets 汇总远端待尝试的 Docker socket 路径。
func candidateRemoteSockets(sshClient *ssh.Client) []string {
	out := make([]string, 0, 8)
	if p, err := probeRemoteDockerSocket(sshClient); err == nil && p != "" {
		out = append(out, p)
	}
	out = append(out, defaultRemoteDockerSockets...)
	return out
}

// probeRemoteDockerSocket 经 SSH 在远端查找 Docker socket。
func probeRemoteDockerSocket(sshClient *ssh.Client) (string, error) {
	out, err := runSSHShell(sshClient, remoteDockerSocketScript)
	if err != nil {
		return "", err
	}
	path := strings.TrimSpace(out)
	if path == "" {
		return "", fmt.Errorf("empty socket path")
	}
	return path, nil
}

// openDockerDialStdio 在远端启动 docker system dial-stdio。
func openDockerDialStdio(sshClient *ssh.Client) (*stdioConn, error) {
	session, err := sshClient.NewSession()
	if err != nil {
		return nil, errno.Wrap(errno.CodeConnFailed, "创建 SSH 会话失败", err)
	}
	stdin, err := session.StdinPipe()
	if err != nil {
		_ = session.Close()
		return nil, errno.Wrap(errno.CodeConnFailed, "打开 SSH stdin 失败", err)
	}
	stdout, err := session.StdoutPipe()
	if err != nil {
		_ = session.Close()
		return nil, errno.Wrap(errno.CodeConnFailed, "打开 SSH stdout 失败", err)
	}
	var stderr strings.Builder
	session.Stderr = &stderr
	if err := session.Start("docker system dial-stdio"); err != nil {
		_ = session.Close()
		detail := strings.TrimSpace(stderr.String())
		if detail == "" {
			detail = "请确认远端已安装 docker 客户端"
		}
		return nil, errno.Wrap(errno.CodeConnFailed, "启动 docker system dial-stdio 失败", fmt.Errorf("%s", detail))
	}
	return &stdioConn{stdin: stdin, stdout: stdout, session: session}, nil
}

// stdioConn 将 HTTP 流量写入 docker system dial-stdio 会话。
type stdioConn struct {
	stdin   io.WriteCloser
	stdout  io.Reader
	session *ssh.Session
	mu      sync.Mutex
	closed  bool
}

// Read 从 dial-stdio 读取响应。
func (c *stdioConn) Read(b []byte) (int, error) {
	return c.stdout.Read(b)
}

// Write 向 dial-stdio 写入请求。
func (c *stdioConn) Write(b []byte) (int, error) {
	return c.stdin.Write(b)
}

// Close 关闭 dial-stdio 会话。
func (c *stdioConn) Close() error {
	c.mu.Lock()
	defer c.mu.Unlock()
	if c.closed {
		return nil
	}
	c.closed = true
	_ = c.stdin.Close()
	return c.session.Close()
}

// LocalAddr 实现 net.Conn。
func (c *stdioConn) LocalAddr() net.Addr { return &net.TCPAddr{IP: net.IPv4(127, 0, 0, 1), Port: 0} }

// RemoteAddr 实现 net.Conn。
func (c *stdioConn) RemoteAddr() net.Addr { return &net.TCPAddr{IP: net.IPv4(127, 0, 0, 1), Port: 0} }

// SetDeadline 实现 net.Conn。
func (c *stdioConn) SetDeadline(t time.Time) error { return nil }

// SetReadDeadline 实现 net.Conn。
func (c *stdioConn) SetReadDeadline(t time.Time) error { return nil }

// SetWriteDeadline 实现 net.Conn。
func (c *stdioConn) SetWriteDeadline(t time.Time) error { return nil }

// runSSHShell 在远端执行 shell 脚本并返回标准输出。
func runSSHShell(sshClient *ssh.Client, script string) (string, error) {
	session, err := sshClient.NewSession()
	if err != nil {
		return "", errno.Wrap(errno.CodeConnFailed, "创建 SSH 会话失败", err)
	}
	defer session.Close()

	var stdout, stderr strings.Builder
	session.Stdout = &stdout
	session.Stderr = &stderr
	if err := session.Run("sh -c " + quoteShell(script)); err != nil {
		combined := strings.TrimSpace(stdout.String() + "\n" + stderr.String())
		return combined, err
	}
	return stdout.String(), nil
}

// newDockerClientOverSSH 创建经 SSH unix 转发的 Docker 客户端。
func newDockerClientOverSSH(sshClient *ssh.Client, socketPath string) (*client.Client, error) {
	socket := socketPath
	httpClient := &http.Client{
		Transport: &http.Transport{
			DialContext: func(ctx context.Context, network, addr string) (net.Conn, error) {
				return sshClient.Dial("unix", socket)
			},
		},
	}
	// WithHTTPClient 必须在 WithHost 之后，否则 WithHost 会覆盖自定义 Transport。
	cli, err := client.NewClientWithOpts(
		client.WithHost("http://127.0.0.1"),
		client.WithAPIVersionNegotiation(),
		client.WithHTTPClient(httpClient),
	)
	if err != nil {
		return nil, errno.Wrap(errno.CodeConnFailed, "创建远程 Docker 客户端失败", err)
	}
	return cli, nil
}

// wrapRemoteDockerError 合并远端 Docker 连接失败原因。
func wrapRemoteDockerError(unixErr, stdioErr error) error {
	msg := "远程 Docker 连接失败"
	lower := strings.ToLower(unixErr.Error() + " " + stdioErr.Error())
	switch {
	case strings.Contains(lower, "permission denied"):
		msg = "无权访问远端 Docker，请将 SSH 用户加入 docker 组或使用 root"
	case strings.Contains(lower, "open failed"):
		msg = "SSH Unix 转发不可用，且 dial-stdio 失败，请确认远端 docker 命令可用"
	case strings.Contains(lower, "dial-stdio"):
		msg = "远端 docker system dial-stdio 不可用，请确认已安装 Docker 客户端"
	}
	return errno.Wrap(errno.CodeConnFailed, msg, fmt.Errorf("unix: %v; stdio: %v", unixErr, stdioErr))
}

// quoteShell 为 sh -c 引用脚本内容。
func quoteShell(script string) string {
	return "'" + strings.ReplaceAll(script, "'", `'"'"'`) + "'"
}
