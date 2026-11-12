package notebook

import (
	"path/filepath"
	"testing"

	"WWorkbench/internal/model"
)

func TestIsMemoryProjectDir(t *testing.T) {
	if !IsMemoryProjectDir("记忆区/医科大/项目/tongchuan-meeting-room-job") {
		t.Fatal("expected project dir")
	}
	if IsMemoryProjectDir("记忆区/医科大") {
		t.Fatal("host book is not project")
	}
	if IsMemoryProjectDir("记忆区/医科大/项目") {
		t.Fatal("projects root is not a project")
	}
	if IsMemoryProjectDir("工作流/demo") {
		t.Fatal("workflow is not memory project")
	}
}

func TestSaveHostProjectLocalRemote(t *testing.T) {
	dir := t.TempDir()
	s := NewService(nil, dir)
	hostDir := filepath.Join(s.workspaceRoot(), "记忆区", "hostA")
	projRel := "记忆区/hostA/项目/demo"
	if err := s.EnsureFSNotebook(); err != nil {
		t.Fatal(err)
	}
	_ = hostDir
	saved, err := s.SaveHostProject(model.HostProjectDO{
		DirRel:     projRel,
		LocalPath:  "/Users/me/demo",
		RemotePath: "/www/wwwroot/demo",
		SSHHostID:  "host-1",
	})
	if err != nil {
		t.Fatal(err)
	}
	if saved.LocalPath != "/Users/me/demo" || saved.RemotePath != "/www/wwwroot/demo" {
		t.Fatalf("paths=%+v", saved)
	}
	got, err := s.GetHostProject(projRel)
	if err != nil {
		t.Fatal(err)
	}
	if got.LocalPath != "/Users/me/demo" || got.SSHHostID != "host-1" {
		t.Fatalf("get=%+v", got)
	}
	list, err := s.ListHostProjects("host-1")
	if err != nil || len(list) != 1 {
		t.Fatalf("list=%v err=%v", list, err)
	}
}
