package browser

import (
	"os"
	"path/filepath"
	"testing"
)

func TestSeedExtDirWritesManifest(t *testing.T) {
	dir := t.TempDir()
	ext, err := SeedExtDir(dir)
	if err != nil {
		t.Fatal(err)
	}
	manifest := filepath.Join(ext, "manifest.json")
	if _, err := os.Stat(manifest); err != nil {
		t.Fatal(err)
	}
	// 二次调用应命中版本标记，不报错
	ext2, err := SeedExtDir(dir)
	if err != nil || ext2 != ext {
		t.Fatalf("second seed: %v %q", err, ext2)
	}
}
