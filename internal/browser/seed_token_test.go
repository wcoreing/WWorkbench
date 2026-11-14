package browser

import (
	"os"
	"path/filepath"
	"strings"
	"testing"
)

func TestInjectBridgeToken(t *testing.T) {
	dir := t.TempDir()
	src := `var BRIDGE_TOKEN = "__WW_BRIDGE_TOKEN__";
  var BRIDGE_URL = "ws://127.0.0.1:18765/ext?token=" + encodeURIComponent(BRIDGE_TOKEN);`
	path := filepath.Join(dir, "offscreen.js")
	if err := os.WriteFile(path, []byte(src), 0o644); err != nil {
		t.Fatal(err)
	}
	if err := InjectBridgeToken(dir, "tok123abc"); err != nil {
		t.Fatal(err)
	}
	raw, _ := os.ReadFile(path)
	body := string(raw)
	if strings.Contains(body, BridgeTokenPlaceholder) {
		t.Fatal("placeholder should be replaced")
	}
	if !strings.Contains(body, `var BRIDGE_TOKEN = "tok123abc"`) {
		t.Fatalf("token missing: %s", body)
	}
	// 二次注入不叠加
	if err := InjectBridgeToken(dir, "tok999xyz"); err != nil {
		t.Fatal(err)
	}
	raw2, _ := os.ReadFile(path)
	if !strings.Contains(string(raw2), `var BRIDGE_TOKEN = "tok999xyz"`) {
		t.Fatalf("re-inject failed: %s", raw2)
	}
	if strings.Count(string(raw2), "BRIDGE_TOKEN") < 1 {
		t.Fatal("expected token var")
	}
}
