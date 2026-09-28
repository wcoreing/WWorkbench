package tunnel

import (
	"context"
	"crypto/ed25519"
	"crypto/rand"
	"encoding/pem"
	"net"
	"os"
	"path/filepath"
	"strconv"
	"testing"
	"time"

	"WWorkbench/internal/model"

	"golang.org/x/crypto/ssh"
)

// TestLoadPrivateKeyIgnoresLoginPasswordForUnencryptedKey
// Password 同时表示登录密码；未加密私钥不得因带了登录密码而走 WithPassphrase。
func TestLoadPrivateKeyIgnoresLoginPasswordForUnencryptedKey(t *testing.T) {
	_, priv, err := ed25519.GenerateKey(rand.Reader)
	if err != nil {
		t.Fatal(err)
	}
	block, err := ssh.MarshalPrivateKey(priv, "")
	if err != nil {
		t.Fatal(err)
	}
	dir := t.TempDir()
	keyPath := filepath.Join(dir, "id_ed25519")
	if err := os.WriteFile(keyPath, pem.EncodeToMemory(block), 0o600); err != nil {
		t.Fatal(err)
	}
	if _, err := loadPrivateKey(keyPath, "login-password-not-passphrase"); err != nil {
		t.Fatalf("unencrypted key + login password: %v", err)
	}
}

// TestDialSSHSilentPeerTimesOut 端口接受连接但不发 SSH 应答时必须超时返回，不能一直挂起。
func TestDialSSHSilentPeerTimesOut(t *testing.T) {
	ln, err := net.Listen("tcp", "127.0.0.1:0")
	if err != nil {
		t.Fatal(err)
	}
	defer ln.Close()
	go func() {
		c, err := ln.Accept()
		if err != nil {
			return
		}
		time.Sleep(30 * time.Second)
		_ = c.Close()
	}()
	host, portStr, err := net.SplitHostPort(ln.Addr().String())
	if err != nil {
		t.Fatal(err)
	}
	port, err := strconv.Atoi(portStr)
	if err != nil {
		t.Fatal(err)
	}
	ctx, cancel := context.WithTimeout(context.Background(), 800*time.Millisecond)
	defer cancel()
	start := time.Now()
	_, err = DialSSH(ctx, model.TunnelSpecDO{
		Host: host, Port: port, User: "root", Password: "x",
	})
	elapsed := time.Since(start)
	if err == nil {
		t.Fatal("expected timeout")
	}
	if elapsed > 3*time.Second {
		t.Fatalf("DialSSH hung %s, err=%v", elapsed, err)
	}
}
