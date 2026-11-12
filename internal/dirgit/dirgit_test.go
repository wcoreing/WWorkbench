package dirgit

import (
	"os"
	"path/filepath"
	"strings"
	"testing"
)

func TestPinRestoreWorkflowIgnoresLog(t *testing.T) {
	root := t.TempDir()
	dir := filepath.Join(root, "工作流", "demo")
	if err := os.MkdirAll(filepath.Join(dir, "assets"), 0o700); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(filepath.Join(dir, "SKILL.md"), []byte("v1\n"), 0o600); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(filepath.Join(dir, "log.md"), []byte("secret log\n"), 0o600); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(filepath.Join(dir, "assets", "a.txt"), []byte("asset1\n"), 0o600); err != nil {
		t.Fatal(err)
	}

	opt := Options{ExtraIgnore: DefaultExtraIgnore("工作流/demo")}
	c1, err := Pin(dir, "update_skill: v1", opt)
	if err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(filepath.Join(dir, "SKILL.md"), []byte("v2\n"), 0o600); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(filepath.Join(dir, "log.md"), []byte("log changed\n"), 0o600); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(filepath.Join(dir, "assets", "a.txt"), []byte("asset2\n"), 0o600); err != nil {
		t.Fatal(err)
	}
	c2, err := Pin(dir, "update_skill: v2", opt)
	if err != nil {
		t.Fatal(err)
	}
	if c2.Hash == c1.Hash {
		t.Fatal("expected new commit")
	}
	log, err := Log(dir, 10)
	if err != nil {
		t.Fatal(err)
	}
	if len(log) < 2 {
		t.Fatalf("log=%d", len(log))
	}
	if _, err := Restore(dir, c1.Hash, "restore v1", opt); err != nil {
		t.Fatal(err)
	}
	skill, _ := os.ReadFile(filepath.Join(dir, "SKILL.md"))
	if string(skill) != "v1\n" {
		t.Fatalf("skill=%q", skill)
	}
	asset, _ := os.ReadFile(filepath.Join(dir, "assets", "a.txt"))
	if string(asset) != "asset1\n" {
		t.Fatalf("asset=%q", asset)
	}
	logBody, _ := os.ReadFile(filepath.Join(dir, "log.md"))
	if string(logBody) != "log changed\n" {
		t.Fatalf("log should be untouched, got %q", logBody)
	}
	tree, err := run(dir, "ls-tree", "-r", "--name-only", "HEAD")
	if err != nil {
		t.Fatal(err)
	}
	if strings.Contains("\n"+tree+"\n", "\nlog.md\n") {
		t.Fatalf("log.md tracked: %s", tree)
	}
}

func TestPinAllowEmptyCreatesVisibleCommit(t *testing.T) {
	dir := t.TempDir()
	opt := Options{}
	if err := Enable(dir, opt); err != nil {
		t.Fatal(err)
	}
	c1, err := Pin(dir, "create_version", opt)
	if err != nil {
		t.Fatal(err)
	}
	c2, err := Pin(dir, "create_version", opt)
	if err != nil {
		t.Fatal(err)
	}
	if c1.Hash == c2.Hash {
		t.Fatal("expected distinct empty commits")
	}
	log, err := Log(dir, 10)
	if err != nil {
		t.Fatal(err)
	}
	if len(log) < 2 {
		t.Fatalf("log should list create_version commits, got %d", len(log))
	}
}

func TestEnableAnyFolder(t *testing.T) {
	root := t.TempDir()
	dir := filepath.Join(root, "记忆", "主机A")
	if err := os.MkdirAll(dir, 0o700); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(filepath.Join(dir, "note.md"), []byte("hi\n"), 0o600); err != nil {
		t.Fatal(err)
	}
	opt := Options{ExtraIgnore: DefaultExtraIgnore("记忆/主机A")}
	if err := Enable(dir, opt); err != nil {
		t.Fatal(err)
	}
	if !IsRepo(dir) {
		t.Fatal("expected repo")
	}
	ci, err := Pin(dir, "ui_pin", opt)
	if err != nil {
		t.Fatal(err)
	}
	if ci.Hash == "" {
		t.Fatal("empty hash")
	}
	st, err := StatusOf(dir, 10)
	if err != nil || !st.Enabled || len(st.Commits) < 1 {
		t.Fatalf("st=%+v err=%v", st, err)
	}
}
