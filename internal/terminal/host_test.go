package terminal

import (
	"path/filepath"
	"testing"

	"WWorkbench/internal/model"
	"WWorkbench/internal/store"
)

// TestSaveNewHostWithKeyOnly 复现：前端预分配 id + 仅私钥、无密码时不应报「主机不存在」。
func TestSaveNewHostWithKeyOnly(t *testing.T) {
	dir := t.TempDir()
	st, err := store.New(dir)
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { _ = st.Close() })

	svc := NewHostService(st)
	keyPath := filepath.Join(dir, "id_ed25519")
	preassigned := "4ae20052-b4fa-4cb7-af06-ac8363eeb64e"
	saved, err := svc.Save(model.SSHHostDO{
		ID:      preassigned,
		Name:    "key-only",
		Host:    "127.0.0.1",
		Port:    22,
		User:    "root",
		KeyPath: keyPath,
	})
	if err != nil {
		t.Fatalf("Save key-only new host: %v", err)
	}
	if saved.ID != preassigned {
		t.Fatalf("id=%s want %s", saved.ID, preassigned)
	}
	if saved.KeyPath != keyPath {
		t.Fatalf("keyPath=%q", saved.KeyPath)
	}
}
