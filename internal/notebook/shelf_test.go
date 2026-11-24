package notebook

import (
	"os"
	"path/filepath"
	"strings"
	"testing"
)

func TestExportSkillPackageStripsPrivateFiles(t *testing.T) {
	dir := t.TempDir()
	s := &Service{dataDir: dir}
	rel := "工作流/示例技能"
	abs := filepath.Join(dir, "notebook", filepath.FromSlash(rel))
	mustWrite(t, filepath.Join(abs, "SKILL.md"), "---\nname: 示例\nbind: desktop\nintent: 发一条消息\ndescription: 样例\n---\n\n# 示例\n")
	mustWrite(t, filepath.Join(abs, "log.md"), "private log")
	mustWrite(t, filepath.Join(abs, "scripts", "run.py"), "print(1)\n")
	mustWrite(t, filepath.Join(abs, "scripts", "__pycache__", "run.pyc"), "pyc")
	mustWrite(t, filepath.Join(abs, "scripts", ".env"), "SECRET=1\n")
	mustWrite(t, filepath.Join(abs, "assets", "shot.png"), "png")

	manifest, err := s.ExportSkillPackage(rel)
	if err != nil {
		t.Fatal(err)
	}
	if manifest.Root != "工作流" || manifest.Bind != "desktop" {
		t.Fatalf("manifest = %+v", manifest)
	}
	if !containsPath(manifest.Files, "SKILL.md") || !containsPath(manifest.Files, "scripts/run.py") {
		t.Fatalf("files = %v", manifest.Files)
	}
	for _, banned := range []string{"log.md", "assets/shot.png", "scripts/.env", "scripts/__pycache__/run.pyc"} {
		if containsPath(manifest.Files, banned) {
			t.Fatalf("exported private file %s", banned)
		}
	}

	installed, err := s.InstallSkillPackage(manifest.ID, manifest.Version)
	if err != nil {
		t.Fatal(err)
	}
	if installed.SideBySide || installed.Rel != rel || installed.Pinned == "" {
		t.Fatalf("install = %+v", installed)
	}

	mustWrite(t, filepath.Join(abs, "SKILL.md"), "---\nname: 示例\n---\n\n# 改过\n")
	again, err := s.ExportSkillPackage(rel)
	if err != nil {
		t.Fatal(err)
	}
	side, err := s.InstallSkillPackage(again.ID, again.Version)
	if err != nil {
		t.Fatal(err)
	}
	if !side.SideBySide || side.Rel == rel {
		t.Fatalf("expected side-by-side, got %+v", side)
	}
	cards, err := s.ListSkillShelf()
	if err != nil {
		t.Fatal(err)
	}
	if len(cards) != 2 {
		t.Fatalf("cards = %d", len(cards))
	}
}

func TestExportWeChatSampleStripsPrivate(t *testing.T) {
	src := filepath.Join(os.Getenv("HOME"), ".wworkbench", "notebook", "工作流", "微信文件传输助手")
	if _, err := os.Stat(src); err != nil {
		t.Skip("本机没有微信技能目录")
	}
	dir := t.TempDir()
	rel := "工作流/微信文件传输助手"
	if err := copyDir(src, filepath.Join(dir, "notebook", filepath.FromSlash(rel))); err != nil {
		t.Fatal(err)
	}
	manifest, err := (&Service{dataDir: dir}).ExportSkillPackage(rel)
	if err != nil {
		t.Fatal(err)
	}
	if !containsPath(manifest.Files, "SKILL.md") || !containsPath(manifest.Files, "scripts/wechat_cg.py") {
		t.Fatalf("files = %v", manifest.Files)
	}
	for _, name := range manifest.Files {
		base := strings.ToLower(filepath.Base(name))
		if base == "log.md" || strings.HasSuffix(base, ".pyc") || strings.Contains(name, "__pycache__") {
			t.Fatalf("exported private file %s", name)
		}
	}
}

func mustWrite(t *testing.T, path, body string) {
	t.Helper()
	if err := os.MkdirAll(filepath.Dir(path), 0o700); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(path, []byte(body), 0o644); err != nil {
		t.Fatal(err)
	}
}
