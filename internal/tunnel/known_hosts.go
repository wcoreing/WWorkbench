package tunnel

import (
	"errors"
	"fmt"
	"net"
	"os"
	"path/filepath"
	"strconv"
	"strings"
	"sync"

	"WNavicat/internal/errno"

	"golang.org/x/crypto/ssh"
	"golang.org/x/crypto/ssh/knownhosts"
)

// KnownHostsStore SSH 已知主机密钥存储。
type KnownHostsStore struct {
	path     string
	mu       sync.Mutex
	callback ssh.HostKeyCallback
	pending  map[string]ssh.PublicKey
}

var defaultKnownHosts *KnownHostsStore

// InitKnownHosts 初始化 known_hosts 存储。
func InitKnownHosts(dataDir string) error {
	path := filepath.Join(dataDir, "known_hosts")
	store, err := NewKnownHostsStore(path)
	if err != nil {
		return err
	}
	defaultKnownHosts = store
	return nil
}

// NewKnownHostsStore 创建 known_hosts 存储。
func NewKnownHostsStore(path string) (*KnownHostsStore, error) {
	if err := os.MkdirAll(filepath.Dir(path), 0o700); err != nil {
		return nil, errno.Wrap(errno.CodeStoreFailed, "创建 known_hosts 目录失败", err)
	}
	if _, err := os.Stat(path); os.IsNotExist(err) {
		if err := os.WriteFile(path, nil, 0o600); err != nil {
			return nil, errno.Wrap(errno.CodeStoreFailed, "创建 known_hosts 失败", err)
		}
	}
	cb, err := knownhosts.New(path)
	if err != nil {
		return nil, errno.Wrap(errno.CodeStoreFailed, "加载 known_hosts 失败", err)
	}
	return &KnownHostsStore{
		path:     path,
		callback: cb,
		pending:  make(map[string]ssh.PublicKey),
	}, nil
}

// sshHostAddr 生成 known_hosts 主机地址键（必须含端口）。
func sshHostAddr(host string, port int) string {
	if h, p, err := net.SplitHostPort(host); err == nil {
		return net.JoinHostPort(h, p)
	}
	if port <= 0 {
		port = 22
	}
	return net.JoinHostPort(host, strconv.Itoa(port))
}

// Verify 校验 SSH 主机密钥。
func (s *KnownHostsStore) Verify(hostname string, remote net.Addr, key ssh.PublicKey) error {
	err := s.callback(hostname, remote, key)
	if err == nil {
		return nil
	}
	var keyErr *knownhosts.KeyError
	if errors.As(err, &keyErr) && len(keyErr.Want) == 0 {
		addr := sshHostAddr(hostname, sshPortFromAddr(remote))
		s.mu.Lock()
		s.pending[addr] = key
		s.mu.Unlock()
		fp := ssh.FingerprintSHA256(key)
		return errno.New(errno.CodeSSHHostUnknown, "主机密钥未信任，请确认指纹后重试", fp)
	}
	return errno.Wrap(errno.CodeConnFailed, "SSH 主机密钥校验失败", err)
}

// TrustHost 信任待确认的主机密钥。
func (s *KnownHostsStore) TrustHost(host string, port int) error {
	addr := sshHostAddr(host, port)
	s.mu.Lock()
	key, ok := s.pending[addr]
	s.mu.Unlock()
	if !ok {
		return errno.New(errno.CodeInvalidArg, "没有待信任的主机密钥，请先测试连接", addr)
	}
	line := fmt.Sprintf("%s %s\n", knownhosts.Normalize(addr), strings.TrimSpace(string(ssh.MarshalAuthorizedKey(key))))
	f, err := os.OpenFile(s.path, os.O_APPEND|os.O_WRONLY, 0o600)
	if err != nil {
		return errno.Wrap(errno.CodeStoreFailed, "写入 known_hosts 失败", err)
	}
	if _, err := f.WriteString(line); err != nil {
		_ = f.Close()
		return errno.Wrap(errno.CodeStoreFailed, "写入 known_hosts 失败", err)
	}
	if err := f.Close(); err != nil {
		return errno.Wrap(errno.CodeStoreFailed, "写入 known_hosts 失败", err)
	}
	cb, err := knownhosts.New(s.path)
	if err != nil {
		return errno.Wrap(errno.CodeStoreFailed, "重载 known_hosts 失败", err)
	}
	s.mu.Lock()
	s.callback = cb
	delete(s.pending, addr)
	s.mu.Unlock()
	return nil
}

// hostKeyCallback 返回全局主机密钥校验回调。
func hostKeyCallback() ssh.HostKeyCallback {
	if defaultKnownHosts == nil {
		return ssh.InsecureIgnoreHostKey()
	}
	return defaultKnownHosts.Verify
}

// TrustSSHHost 信任指定主机的待确认密钥。
func TrustSSHHost(host string, port int) error {
	if defaultKnownHosts == nil {
		return errno.New(errno.CodeStoreFailed, "known_hosts 未初始化", "")
	}
	return defaultKnownHosts.TrustHost(host, port)
}

// sshPortFromAddr 从网络地址解析端口。
func sshPortFromAddr(addr net.Addr) int {
	_, portStr, err := net.SplitHostPort(addr.String())
	if err != nil {
		return 22
	}
	var port int
	_, _ = fmt.Sscanf(portStr, "%d", &port)
	if port <= 0 {
		return 22
	}
	return port
}
