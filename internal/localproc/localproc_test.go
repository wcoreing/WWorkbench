package localproc

import (
	"testing"
)

func TestListByPort_NoMatch(t *testing.T) {
	list, err := ListByPort(59999)
	if err != nil {
		t.Fatal(err)
	}
	if len(list) != 0 {
		t.Fatalf("want empty, got %d", len(list))
	}
}

func TestValidatePort(t *testing.T) {
	if err := validatePort(0); err == nil {
		t.Fatal("expected error")
	}
	if err := validatePort(22); err != nil {
		t.Fatal(err)
	}
}

func TestParseListenAddr(t *testing.T) {
	addr, port := parseListenAddr("127.0.0.1:5173")
	if addr != "127.0.0.1:5173" || port != 5173 {
		t.Fatalf("got %s %d", addr, port)
	}
	_, port = parseListenAddr("[::1]:5174")
	if port != 5174 {
		t.Fatalf("got port %d", port)
	}
}
