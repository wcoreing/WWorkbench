package browser

import (
	"context"
	"encoding/json"
	"strings"
	"testing"
)

func TestNormalizeArgsForKimi_ClickRefToSelector(t *testing.T) {
	in := json.RawMessage(`{"ref":"@e24","intent":"选正面"}`)
	out, err := NormalizeArgsForKimi("click", in)
	if err != nil {
		t.Fatal(err)
	}
	var m map[string]interface{}
	_ = json.Unmarshal(out, &m)
	if m["selector"] != "@e24" {
		t.Fatalf("selector=%v want @e24", m["selector"])
	}
}

func TestNormalizeArgsForKimi_WaitSnakeCase(t *testing.T) {
	in := json.RawMessage(`{"text":"正面","textGone":"加载中","timeoutMs":5000}`)
	out, err := NormalizeArgsForKimi("wait", in)
	if err != nil {
		t.Fatal(err)
	}
	var m map[string]interface{}
	_ = json.Unmarshal(out, &m)
	if m["text_gone"] != "加载中" {
		t.Fatalf("text_gone=%v", m["text_gone"])
	}
	if m["timeout_ms"] != float64(5000) {
		t.Fatalf("timeout_ms=%v", m["timeout_ms"])
	}
}

func TestNormalizeResultFromKimi_ScreenshotPath(t *testing.T) {
	in := json.RawMessage(`{"path":"/tmp/a.jpg","sizeBytes":12,"format":"jpeg"}`)
	out := NormalizeResultFromKimi("screenshot", in)
	var m map[string]interface{}
	_ = json.Unmarshal(out, &m)
	if m["path"] != "/tmp/a.jpg" {
		t.Fatalf("path lost: %v", m)
	}
	if m["source"] != "kimi-path" {
		t.Fatalf("source=%v", m["source"])
	}
}

func TestNormalizeResultFromKimi_FlattenTree(t *testing.T) {
	in := json.RawMessage(`{"tree":[{"ref":"@e1","role":"checkbox","name":"正面","children":[]}]}`)
	out := NormalizeResultFromKimi("snapshot", in)
	var m map[string]interface{}
	_ = json.Unmarshal(out, &m)
	text, _ := m["tree_text"].(string)
	if !strings.Contains(text, "@e1") || !strings.Contains(text, "正面") {
		t.Fatalf("tree_text=%q", text)
	}
}

func TestWaitConditionMatched(t *testing.T) {
	args := json.RawMessage(`{"text":"正面"}`)
	if !WaitConditionMatched(args, "foo 正面 bar") {
		t.Fatal("expected match")
	}
	if WaitConditionMatched(args, "只有负面") {
		t.Fatal("expected miss")
	}
}

func TestPreferWWBPointer(t *testing.T) {
	if !preferWWBPointer("drag") {
		t.Fatal("drag should prefer wwb")
	}
	if preferWWBPointer("snapshot") {
		t.Fatal("snapshot should not force wwb via preferWWBPointer")
	}
}

func TestResolveExecutorAutoPrefersWWB(t *testing.T) {
	wwb := &fakeExec{name: ExecutorNameWWB, ok: true}
	kimi := &fakeExec{name: ExecutorNameKimi, ok: true}
	ex, name, err := ResolveExecutorForAction(context.Background(), "auto", "snapshot", wwb, kimi)
	if err != nil || name != ExecutorNameWWB || ex != wwb {
		t.Fatalf("auto snapshot → wwb, got name=%s err=%v", name, err)
	}
	ex2, name2, err2 := ResolveExecutorForAction(context.Background(), "auto", "click", nil, kimi)
	if err2 != nil || name2 != ExecutorNameKimi || ex2 != kimi {
		t.Fatalf("auto fallback kimi, got name=%s err=%v", name2, err2)
	}
}

type fakeExec struct {
	name string
	ok   bool
}

func (f *fakeExec) Name() string { return f.name }
func (f *fakeExec) Available(context.Context) bool {
	return f.ok
}
func (f *fakeExec) Call(context.Context, string, json.RawMessage, string) (json.RawMessage, error) {
	return json.RawMessage(`{}`), nil
}
