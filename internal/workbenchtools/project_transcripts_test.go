package workbenchtools

import (
	"encoding/json"
	"os"
	"path/filepath"
	"strings"
	"testing"
)

func TestCursorProjectSlugCandidates(t *testing.T) {
	slugs := cursorProjectSlugCandidates("/Users/weining/workspace/label-studio")
	joined := strings.Join(slugs, " ")
	if !strings.Contains(joined, "Users-weining-workspace-label-studio") {
		t.Fatalf("missing plain slug in %v", slugs)
	}
	if !strings.Contains(joined, "label-studio") {
		t.Fatalf("missing basename in %v", slugs)
	}
}

func TestWorkspaceMatchesProject(t *testing.T) {
	slugs := cursorProjectSlugCandidates("/Users/weining/workspace/label-studio")
	if !workspaceMatchesProject("Users-weining-workspace-label-studio", slugs, "/Users/weining/workspace/label-studio") {
		t.Fatal("expected match")
	}
	if workspaceMatchesProject("Users-weining-workspace-other", slugs, "/Users/weining/workspace/label-studio") {
		t.Fatal("unexpected match")
	}
}

func TestJSONLToReadableMarkdown(t *testing.T) {
	dir := t.TempDir()
	path := filepath.Join(dir, "t.jsonl")
	content := `{"role":"user","message":{"content":[{"type":"text","text":"<user_query>\n你好世界\n</user_query>"}]}}
{"role":"assistant","message":{"content":[{"type":"text","text":"收到"}]}}
{"role":"assistant","message":{"content":[{"type":"tool_use","name":"Shell","input":{"command":"ls"}}]}}
`
	if err := os.WriteFile(path, []byte(content), 0o600); err != nil {
		t.Fatal(err)
	}
	md, lines, err := jsonlToReadableMarkdown(path)
	if err != nil {
		t.Fatal(err)
	}
	if lines != 3 {
		t.Fatalf("lines=%d", lines)
	}
	if !strings.Contains(md, "你好世界") || !strings.Contains(md, "收到") {
		t.Fatalf("md=%q", md)
	}
	if strings.Contains(md, "tool_use") || strings.Contains(md, "Shell") {
		t.Fatalf("should drop tool-only turns: %q", md)
	}
}

func TestListProjectCursorTranscriptsEmpty(t *testing.T) {
	list, err := ListProjectCursorTranscripts(t.TempDir())
	if err != nil {
		t.Fatal(err)
	}
	if len(list) != 0 {
		t.Fatalf("want empty, got %d", len(list))
	}
}

func TestFileURLToPath(t *testing.T) {
	got := fileURLToPath("file:///Users/weining/workspace/%E7%99%BE%E5%BA%A6%E6%A0%87%E6%B3%A8")
	if !strings.Contains(got, "百度标注") {
		t.Fatalf("got %q", got)
	}
}

func TestSyncProjectCursorTranscriptsFixture(t *testing.T) {
	home := t.TempDir()
	proj := filepath.Join(home, "myproj")
	if err := os.MkdirAll(proj, 0o755); err != nil {
		t.Fatal(err)
	}
	// fake ~/.cursor/projects
	oldHome := os.Getenv("HOME")
	t.Setenv("HOME", home)
	defer t.Setenv("HOME", oldHome)

	tid := "aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee"
	trDir := filepath.Join(home, ".cursor", "projects", "Users-"+filepath.Base(home)+"-myproj", "agent-transcripts", tid)
	// slug from /var/.../myproj won't match Users-home-myproj — write under path-based slug
	slugs := cursorProjectSlugCandidates(proj)
	if len(slugs) == 0 {
		t.Fatal("no slugs")
	}
	trDir = filepath.Join(home, ".cursor", "projects", slugs[0], "agent-transcripts", tid)
	if err := os.MkdirAll(trDir, 0o755); err != nil {
		t.Fatal(err)
	}
	jsonl := filepath.Join(trDir, tid+".jsonl")
	body := `{"role":"user","message":{"content":[{"type":"text","text":"<user_query>\n修个 bug\n</user_query>"}]}}` + "\n" +
		`{"role":"assistant","message":{"content":[{"type":"text","text":"好的"}]}}` + "\n"
	if err := os.WriteFile(jsonl, []byte(body), 0o600); err != nil {
		t.Fatal(err)
	}

	// Store + Sync without notebook (nil ok)
	// Use minimal fake via SyncProjectCursorTranscripts needing Store — skip full store; test discover+copy path via List after manual copy
	found, err := discoverCursorTranscripts(proj, "")
	if err != nil {
		t.Fatal(err)
	}
	if len(found) != 1 || found[0].ID != tid {
		t.Fatalf("found=%+v", found)
	}
	// copy as sync would
	dest := projectCursorTranscriptsDir(proj)
	_ = os.MkdirAll(dest, 0o755)
	in, _ := os.ReadFile(jsonl)
	_ = os.WriteFile(filepath.Join(dest, tid+".jsonl"), in, 0o644)
	md, _, _ := jsonlToReadableMarkdown(filepath.Join(dest, tid+".jsonl"))
	_ = os.WriteFile(filepath.Join(dest, tid+".md"), []byte(md), 0o644)
	meta := CursorTranscriptMeta{ID: tid, Title: "修个 bug", UpdatedAt: 1, SyncedAt: 1}
	mb, _ := json.MarshalIndent(meta, "", "  ")
	_ = os.WriteFile(filepath.Join(dest, tid+".meta.json"), mb, 0o644)
	list, err := ListProjectCursorTranscripts(proj)
	if err != nil || len(list) != 1 {
		t.Fatalf("list=%v err=%v", list, err)
	}
	_, bodyOut, _, err := GetProjectCursorTranscript(proj, tid, true)
	if err != nil || !strings.Contains(bodyOut, "修个 bug") {
		t.Fatalf("body=%q err=%v", bodyOut, err)
	}
}
