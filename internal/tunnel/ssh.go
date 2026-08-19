package tunnel

import (
	"context"
	"fmt"
	"io"
	"net"
	"os"
	"path/filepath"
	"strconv"
	"strings"
	"sync"
	"time"

	"WWorkbench/internal/errno"
	"WWorkbench/internal/model"

	"golang.org/x/crypto/ssh"
)

// sshTunnel 经 SSH 转发的本地 TCP 监听。
type sshTunnel struct {
	listener net.Listener
	client   *ssh.Client
	addr     string
	closed   chan struct{}
	wg       sync.WaitGroup
}

func (t *sshTunnel) Addr() string { return t.addr }

// Close 关闭监听与 SSH 客户端。
func (t *sshTunnel) Close() error {
	select {
	case <-t.closed:
		return nil
	default:
		close(t.closed)
	}
	var err error
	if t.listener != nil {
		if e := t.listener.Close(); e != nil {
			err = e
		}
	}
	done := make(chan struct{})
	go func() {
		t.wg.Wait()
		close(done)
	}()
	select {
	case <-done:
	case <-time.After(3 * time.Second):
	}
	if t.client != nil {
		if e := t.client.Close(); e != nil && err == nil {
			err = e
		}
	}
	return err
}

// dialSSH 建立 SSH 隧道并在本地监听，转发至目标地址（localPort=0 时自动分配端口）。
func dialSSH(ctx context.Context, spec model.TunnelSpecDO, targetHost string, targetPort int) (Tunnel, error) {
	return DialPortForward(ctx, spec, 0, targetHost, targetPort)
}

// DialPortForward 经 SSH 在本地监听并转发到远端 TCP 地址。
func DialPortForward(ctx context.Context, spec model.TunnelSpecDO, localPort int, targetHost string, targetPort int) (Tunnel, error) {
	if targetHost == "" {
		return nil, errno.New(errno.CodeInvalidArg, "请填写远端主机", "")
	}
	if targetPort <= 0 || targetPort > 65535 {
		return nil, errno.New(errno.CodeInvalidArg, "请填写有效远端端口", strconv.Itoa(targetPort))
	}
	client, err := DialSSH(ctx, spec)
	if err != nil {
		return nil, err
	}
	target := fmt.Sprintf("%s:%d", targetHost, targetPort)

	ln, err := listenLocalTCP(localPort)
	if err != nil {
		_ = client.Close()
		return nil, errno.Wrap(errno.CodeConnFailed, "创建本地转发端口失败", err)
	}
	host, portStr, _ := net.SplitHostPort(ln.Addr().String())
	parsedPort, _ := strconv.Atoi(portStr)
	tun := &sshTunnel{
		listener: ln,
		client:   client,
		addr:     fmt.Sprintf("%s:%d", host, parsedPort),
		closed:   make(chan struct{}),
	}

	tun.wg.Add(1)
	go func() {
		defer tun.wg.Done()
		tun.acceptLoop(target)
	}()

	return tun, nil
}

// listenLocalTCP 在 127.0.0.1 监听；localPort=0 时由系统分配端口。
func listenLocalTCP(localPort int) (net.Listener, error) {
	addr := "127.0.0.1:0"
	if localPort > 0 {
		addr = fmt.Sprintf("127.0.0.1:%d", localPort)
	}
	return net.Listen("tcp", addr)
}

// DialSSH 建立 SSH 客户端连接（供终端等产品复用）。
func DialSSH(ctx context.Context, spec model.TunnelSpecDO) (*ssh.Client, error) {
	if err := validateSSHSpec(spec); err != nil {
		return nil, err
	}
	sshPort := spec.Port
	if sshPort <= 0 {
		sshPort = 22
	}
	remote := fmt.Sprintf("%s:%d", spec.Host, sshPort)

	config, err := buildSSHConfig(spec)
	if err != nil {
		return nil, err
	}

	dialer := &net.Dialer{Timeout: 10 * time.Second}
	conn, err := dialer.DialContext(ctx, "tcp", remote)
	if err != nil {
		return nil, wrapSSHDialErr(remote, "连接 SSH 服务器失败", err)
	}
	hostKeyAddr := net.JoinHostPort(spec.Host, strconv.Itoa(sshPort))
	sshConn, chans, reqs, err := ssh.NewClientConn(conn, hostKeyAddr, config)
	if err != nil {
		_ = conn.Close()
		return nil, wrapSSHDialErr(remote, "SSH 握手失败", err)
	}
	return ssh.NewClient(sshConn, chans, reqs), nil
}

// wrapSSHDialErr 把目标地址写进错误，EOF 视为该端口没有有效 SSH（填错区域/端口或实例关机）。
func wrapSSHDialErr(remote, message string, err error) error {
	if err == nil {
		return errno.New(errno.CodeConnFailed, message, remote)
	}
	if ae := errno.Extract(err); ae != nil {
		return ae
	}
	detail := err.Error()
	if strings.Contains(strings.ToLower(detail), "eof") {
		return errno.New(errno.CodeConnFailed, "SSH 握手被断开",
			fmt.Sprintf("%s · 目标 %s 无有效 SSH 服务，请核对区域主机名与端口（实例关机或填错也会如此）", detail, remote))
	}
	return errno.New(errno.CodeConnFailed, message, fmt.Sprintf("%s · %s", detail, remote))
}

func (t *sshTunnel) acceptLoop(target string) {
	for {
		local, err := t.listener.Accept()
		if err != nil {
			select {
			case <-t.closed:
				return
			default:
			}
			return
		}
		t.wg.Add(1)
		go func(lc net.Conn) {
			defer t.wg.Done()
			t.forward(lc, target)
		}(local)
	}
}

func (t *sshTunnel) forward(local net.Conn, target string) {
	remote, err := t.client.Dial("tcp", target)
	if err != nil {
		_ = local.Close()
		return
	}
	go func() {
		defer local.Close()
		defer remote.Close()
		done := make(chan struct{}, 2)
		go func() {
			_, _ = io.Copy(remote, local)
			done <- struct{}{}
		}()
		go func() {
			_, _ = io.Copy(local, remote)
			done <- struct{}{}
		}()
		select {
		case <-done:
		case <-t.closed:
		}
	}()
}

// validateSSHSpec 校验 SSH 隧道参数。
func validateSSHSpec(spec model.TunnelSpecDO) error {
	if spec.Host == "" {
		return errno.New(errno.CodeInvalidArg, "请填写 SSH 主机", "")
	}
	if spec.User == "" {
		return errno.New(errno.CodeInvalidArg, "请填写 SSH 用户名", "")
	}
	if spec.KeyPath == "" && spec.Password == "" {
		return errno.New(errno.CodeInvalidArg, "请填写 SSH 密码或私钥路径", "")
	}
	return nil
}

// buildSSHConfig 构建 SSH 客户端认证配置。
func buildSSHConfig(spec model.TunnelSpecDO) (*ssh.ClientConfig, error) {
	var auths []ssh.AuthMethod
	if spec.KeyPath != "" {
		signer, err := loadPrivateKey(spec.KeyPath, spec.Password)
		if err != nil {
			return nil, err
		}
		auths = append(auths, ssh.PublicKeys(signer))
	}
	if spec.Password != "" {
		auths = append(auths, ssh.Password(spec.Password))
	}
	if len(auths) == 0 {
		return nil, errno.New(errno.CodeInvalidArg, "SSH 认证方式无效", "")
	}
	return &ssh.ClientConfig{
		User:            spec.User,
		Auth:            auths,
		HostKeyCallback: hostKeyCallback(),
		Timeout:         10 * time.Second,
	}, nil
}

// expandKeyPath 展开私钥路径中的 ~ 与环境变量。
func expandKeyPath(path string) (string, error) {
	p := strings.TrimSpace(path)
	if p == "" {
		return "", nil
	}
	if strings.HasPrefix(p, "~/") {
		home, err := os.UserHomeDir()
		if err != nil {
			return "", err
		}
		p = filepath.Join(home, p[2:])
	}
	return filepath.Clean(os.ExpandEnv(p)), nil
}

// loadPrivateKey 从文件加载私钥，支持 PEM 加密密钥。
func loadPrivateKey(path, passphrase string) (ssh.Signer, error) {
	path, err := expandKeyPath(path)
	if err != nil {
		return nil, errno.Wrap(errno.CodeInvalidArg, "SSH 私钥路径无效", err)
	}
	raw, err := os.ReadFile(path)
	if err != nil {
		return nil, errno.Wrap(errno.CodeInvalidArg, "读取 SSH 私钥失败", err)
	}
	var key interface{}
	if passphrase != "" {
		key, err = ssh.ParsePrivateKeyWithPassphrase(raw, []byte(passphrase))
	} else {
		key, err = ssh.ParsePrivateKey(raw)
	}
	if err != nil {
		return nil, errno.Wrap(errno.CodeInvalidArg, "解析 SSH 私钥失败", err)
	}
	signer, ok := key.(ssh.Signer)
	if !ok {
		return nil, errno.New(errno.CodeInvalidArg, "SSH 私钥格式不支持", "")
	}
	return signer, nil
}
