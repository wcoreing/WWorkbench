package tunnel

import (
	"crypto/ed25519"
	"crypto/rand"
	"encoding/pem"
	"os"
	"path/filepath"
	"testing"

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
