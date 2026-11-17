package agent

import (
	"encoding/json"
	"image"
	"image/png"
	"os"
	"path/filepath"
	"testing"

	"WWorkbench/internal/workbenchtools"

	"github.com/wcoreing/ningharness/history"
)

func TestShotPathFromResult(t *testing.T) {
	data, _ := json.Marshal(map[string]interface{}{
		"path": "/tmp/a.png", "format": "png", "width": 10, "height": 10,
	})
	path, mime := shotPathFromResult(workbenchtools.ToolResult{OK: true, Data: data})
	if path != "/tmp/a.png" || mime != "image/png" {
		t.Fatalf("got %q %q", path, mime)
	}
	wrapped, _ := json.Marshal(string(data))
	path, mime = shotPathFromResult(workbenchtools.ToolResult{OK: true, Data: wrapped})
	if path != "/tmp/a.png" || mime != "image/png" {
		t.Fatalf("wrapped got %q %q", path, mime)
	}
}

func TestEncodeShotForModelResizes(t *testing.T) {
	dir := t.TempDir()
	path := filepath.Join(dir, "big.png")
	img := image.NewRGBA(image.Rect(0, 0, 2000, 1200))
	f, err := os.Create(path)
	if err != nil {
		t.Fatal(err)
	}
	if err := png.Encode(f, img); err != nil {
		t.Fatal(err)
	}
	_ = f.Close()

	b64, mime, err := encodeShotForModel(path, "image/png")
	if err != nil {
		t.Fatal(err)
	}
	if mime != "image/jpeg" || b64 == "" {
		t.Fatalf("mime=%s len=%d", mime, len(b64))
	}
}

func TestDecorateToolMessageSkipsNonShot(t *testing.T) {
	data, _ := json.Marshal(map[string]string{"ok": "1"})
	content, preview := decorateToolMessage("", "s", "t", "desktop_apps", workbenchtools.ToolResult{OK: true, Data: data}, 0)
	if preview != nil {
		t.Fatal("expected no preview")
	}
	if _, refs := history.SplitImageRefs(content); len(refs) != 0 {
		t.Fatalf("unexpected refs %#v", refs)
	}
}
