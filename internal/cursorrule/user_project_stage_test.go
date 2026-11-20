package cursorrule

import (
	"os"
	"path/filepath"
	"strings"
	"testing"
)

func TestIsForbiddenAutoCreatePath(t *testing.T) {
	if err := IsForbiddenAutoCreatePath("/"); err == nil {
		t.Fatal("root should be forbidden")
	}
	home, err := os.UserHomeDir()
	if err != nil {
		t.Fatal(err)
	}
	if err := IsForbiddenAutoCreatePath(home); err == nil {
		t.Fatal("home should be forbidden")
	}
	ok := filepath.Join(home, "workspace", "demo-project")
	if err := IsForbiddenAutoCreatePath(ok); err != nil {
		t.Fatalf("normal path: %v", err)
	}
}

func TestEnsureUserProjectStageRule_Idempotent(t *testing.T) {
	// 用临时 HOME 隔离，避免污染本机 ~/.cursor
	tmp := t.TempDir()
	t.Setenv("HOME", tmp)
	r1, err := EnsureUserProjectStageRule()
	if err != nil {
		t.Fatal(err)
	}
	if !r1.Written {
		t.Fatalf("first write expected: %+v", r1)
	}
	body, err := os.ReadFile(r1.Path)
	if err != nil {
		t.Fatal(err)
	}
	if !strings.Contains(string(body), UserProjectStageMarker) {
		t.Fatalf("missing marker: %s", body)
	}
	if r1.PluginPath == "" {
		t.Fatal("plugin path empty")
	}
	if _, err := os.Stat(r1.PluginPath); err != nil {
		t.Fatal(err)
	}
	r2, err := EnsureUserProjectStageRule()
	if err != nil {
		t.Fatal(err)
	}
	if r2.Written || !r2.Skipped {
		t.Fatalf("second should skip: %+v", r2)
	}
	rm, err := RemoveUserProjectStageRule()
	if err != nil {
		t.Fatal(err)
	}
	if !rm.Removed {
		t.Fatalf("remove expected: %+v", rm)
	}
	if _, err := os.Stat(r1.Path); !os.IsNotExist(err) {
		t.Fatalf("rule file should be gone: %v", err)
	}
}
