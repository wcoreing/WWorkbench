package notebook

import (
	"os"
	"path/filepath"
	"strings"
	"testing"
)

func TestEnsureViewTemplateKeepsExisting(t *testing.T) {
	dir := t.TempDir()
	seeded, err := ensureViewTemplate(dir, "本地后台")
	if err != nil || !seeded {
		t.Fatalf("seeded=%v err=%v", seeded, err)
	}
	for _, name := range []string{"index.html", "src/main.js", "src/App.vue", "src/components/Starter.vue"} {
		if _, err := os.Stat(filepath.Join(dir, name)); err != nil {
			t.Fatalf("missing %s", name)
		}
	}
	starter, err := os.ReadFile(filepath.Join(dir, "src", "components", "Starter.vue"))
	if err != nil || !strings.Contains(string(starter), "本地后台") {
		t.Fatalf("title missing: %s", starter)
	}
	app := filepath.Join(dir, "src", "App.vue")
	if err := os.WriteFile(app, []byte("custom"), 0o600); err != nil {
		t.Fatal(err)
	}
	again, err := ensureViewTemplate(dir, "别的标题")
	if err != nil || again {
		t.Fatalf("seeded=%v err=%v", again, err)
	}
	raw, err := os.ReadFile(app)
	if err != nil || string(raw) != "custom" {
		t.Fatalf("overwritten: %s", raw)
	}
	starter, err = os.ReadFile(filepath.Join(dir, "src", "components", "Starter.vue"))
	if err != nil || strings.Contains(string(starter), "别的标题") {
		t.Fatalf("component rewritten: %s", starter)
	}
}

func TestStampVueBuild(t *testing.T) {
	html := "<!DOCTYPE html><html><body><img src=\"../../assets/shot.png\"><div id=\"app\"></div></body></html>"
	out := stampVueBuild(html, "运维/本地后台.md", "运维/账号HTML视图", "abc1234")
	if !strings.Contains(out, `runtime="vue"`) || !strings.Contains(out, `source="运维/本地后台.md"`) {
		t.Fatalf("comment missing\n%s", out)
	}
	if strings.Contains(out, "../../assets/") {
		t.Fatalf("asset path not rewritten\n%s", out)
	}
	if !strings.Contains(out, "/notebook-assets/") || !strings.Contains(out, "shot.png") {
		t.Fatalf("asset url missing\n%s", out)
	}
	if !strings.Contains(out, "<footer>来源：运维/本地后台.md</footer>") {
		t.Fatalf("footer missing\n%s", out)
	}
}
