package notebook

import "testing"

func TestLanguageFromFilenameIPLikeMD(t *testing.T) {
	cases := []struct {
		name string
		want string
	}{
		{"智创鼎峰172.19.201·整理.md", "markdown"},
		{"host.1.2.3笔记.md", "markdown"},
		{"index.js.md", "javascript"},
		{"app.ts.md", "typescript"},
		{"plain.md", "markdown"},
		{"SKILL.md", "markdown"},
		{"run.sh", "shell"},
		{"App.vue", "vue"},
		{"rows.csv", "plaintext"},
		{"v0.54.502.md", "markdown"},
	}
	for _, c := range cases {
		if got := languageFromFilename(c.name); got != c.want {
			t.Fatalf("%s: got %q want %q", c.name, got, c.want)
		}
	}
}

func TestNotebookTreeIncludesAnyVisibleFile(t *testing.T) {
	for _, name := range []string{"App.vue", "rows.csv", "note.md", "main.js"} {
		if !isNotebookContentFile(name) {
			t.Fatalf("hidden from tree: %s", name)
		}
	}
	if isNotebookContentFile(".DS_Store") || isNotebookContentFile("") {
		t.Fatal("dotfile should stay out")
	}
	if !skipNotebookDir("node_modules") || skipNotebookDir("view") {
		t.Fatal("dir skip")
	}
}

func TestTitleFromFilenameIPLikeMD(t *testing.T) {
	cases := []struct {
		name string
		want string
	}{
		{"智创鼎峰172.19.201·整理.md", "智创鼎峰172.19.201·整理"},
		{"index.js.md", "index"},
		{"v0.54.502.md", "v0.54.502"},
	}
	for _, c := range cases {
		if got := titleFromFilename(c.name); got != c.want {
			t.Fatalf("%s: got %q want %q", c.name, got, c.want)
		}
	}
}
