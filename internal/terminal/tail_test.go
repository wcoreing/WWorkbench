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

func TestPagePTYLinesPagination(t *testing.T) {
	raw := "1\n2\n3\n4\n5"
	p0 := pagePTYLines(raw, 0, 2)
	if p0.Text != "4\n5" || !p0.HasMoreOlder || p0.NextOffsetFrom != 2 {
		t.Fatalf("page0: %+v", p0)
	}
	p1 := pagePTYLines(raw, 2, 2)
	if p1.Text != "2\n3" || !p1.HasMoreOlder || p1.NextOffsetFrom != 4 {
		t.Fatalf("page1: %+v", p1)
	}
	p2 := pagePTYLines(raw, 4, 2)
	if p2.Text != "1" || p2.HasMoreOlder {
		t.Fatalf("page2: %+v", p2)
	}
}
