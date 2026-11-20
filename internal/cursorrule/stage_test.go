package cursorrule

import (
	"os"
	"path/filepath"
	"strings"
	"testing"
)

func TestEnsureStageRule_WriteAndSkip(t *testing.T) {
	dir := t.TempDir()
	r1, err := EnsureStageRule(dir)
	if err != nil {
		t.Fatal(err)
	}
	if !r1.Written || r1.Skipped {
		t.Fatalf("first write: %+v", r1)
	}
	body, err := os.ReadFile(r1.Path)
	if err != nil {
		t.Fatal(err)
	}
	if !strings.Contains(string(body), managedMarker) || !strings.Contains(string(body), "alwaysApply: true") {
		t.Fatalf("missing marker/frontmatter:\n%s", body)
	}
	r2, err := EnsureStageRule(dir)
	if err != nil {
		t.Fatal(err)
	}
	if r2.Written || !r2.Skipped {
		t.Fatalf("second should skip: %+v", r2)
	}
	// 人为改坏后应覆盖
	_ = os.WriteFile(filepath.Join(dir, RelPath), []byte("stale"), 0o644)
	r3, err := EnsureStageRule(dir)
	if err != nil {
		t.Fatal(err)
	}
	if !r3.Written {
		t.Fatalf("overwrite expected: %+v", r3)
	}
}

func TestEnsureStageRule_Empty(t *testing.T) {
	if _, err := EnsureStageRule(""); err == nil {
		t.Fatal("expected error")
	}
}
