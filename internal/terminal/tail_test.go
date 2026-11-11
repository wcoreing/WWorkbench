package terminal

import (
	"context"
	"testing"
	"time"
)

func TestCoerceUpdatedAtMs(t *testing.T) {
	if CoerceUpdatedAtMs(0) != 0 {
		t.Fatal("zero")
	}
	if CoerceUpdatedAtMs(1_700_000_000) != 1_700_000_000_000 {
		t.Fatal("seconds should scale to ms")
	}
	if CoerceUpdatedAtMs(1_700_000_000_123) != 1_700_000_000_123 {
		t.Fatal("millis passthrough")
	}
}

func TestWaitQuietReturnsAfterSilence(t *testing.T) {
	tail := newOutputTail()
	tail.append([]byte("hi\n"))
	ctx, cancel := context.WithTimeout(context.Background(), 2*time.Second)
	defer cancel()
	start := time.Now()
	if err := tail.waitQuiet(ctx, 50*time.Millisecond); err != nil {
		t.Fatal(err)
	}
	elapsed := time.Since(start)
	if elapsed < 40*time.Millisecond {
		t.Fatalf("returned too early: %v", elapsed)
	}
	if elapsed > 500*time.Millisecond {
		t.Fatalf("too slow: %v", elapsed)
	}
}

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
