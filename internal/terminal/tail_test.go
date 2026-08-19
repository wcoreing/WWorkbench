package terminal

import "testing"

func TestClipPTYTailKeepsLastLines(t *testing.T) {
	raw := "a\nb\nc\nd\ne"
	got := clipPTYTail(raw, 3)
	if got != "c\nd\ne" {
		t.Fatalf("got %q", got)
	}
}

func TestClipPTYTailStripsANSI(t *testing.T) {
	raw := "\x1b[32mOK\x1b[0m\nnext"
	got := clipPTYTail(raw, 10)
	if got != "OK\nnext" {
		t.Fatalf("got %q", got)
	}
}
