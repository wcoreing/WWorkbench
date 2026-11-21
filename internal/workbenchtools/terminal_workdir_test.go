package workbenchtools

import "testing"

func TestLocalShellTabTitle(t *testing.T) {
	if got := localShellTabTitle("", ""); got != "本机" {
		t.Fatalf("empty: %q", got)
	}
	if got := localShellTabTitle("/Users/a/WWorkbench", "WWorkbench"); got != "本机 · WWorkbench" {
		t.Fatalf("named: %q", got)
	}
	if got := localShellTabTitle("/Users/a/ningbz", ""); got != "本机 · ningbz" {
		t.Fatalf("basename: %q", got)
	}
}

func TestResolveLocalWorkDirExplicit(t *testing.T) {
	abs, name := resolveLocalWorkDir(nil, "/Users/a/proj/")
	if abs != "/Users/a/proj" {
		t.Fatalf("abs=%q", abs)
	}
	if name != "proj" {
		t.Fatalf("name=%q", name)
	}
}
