package mcpserver

import (
	"net/http"
	"net/http/httptest"
	"testing"
)

func TestAuthorizeBearerAndQuery(t *testing.T) {
	tok := "abc123tokensecretvalue0001"
	req := httptest.NewRequest(http.MethodPost, "/mcp/workbench", nil)
	req.Header.Set("Authorization", "Bearer "+tok)
	if !authorizeRequest(req, tok) {
		t.Fatal("bearer should pass")
	}
	req2 := httptest.NewRequest(http.MethodPost, "/mcp/workbench?token="+tok, nil)
	if !authorizeRequest(req2, tok) {
		t.Fatal("query token should pass")
	}
	req3 := httptest.NewRequest(http.MethodPost, "/mcp/workbench", nil)
	if authorizeRequest(req3, tok) {
		t.Fatal("missing token should fail")
	}
}

func TestLoopbackOrigin(t *testing.T) {
	if !isLoopbackOrigin("") || !isLoopbackOrigin("null") {
		t.Fatal("empty/null ok")
	}
	if !isLoopbackOrigin("http://127.0.0.1:34115") {
		t.Fatal("loopback ok")
	}
	if isLoopbackOrigin("https://evil.example") {
		t.Fatal("remote origin must fail")
	}
}

func TestWithAuthHealthOpen(t *testing.T) {
	h := withAuth("secrettokenvalue00000001", http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.WriteHeader(http.StatusOK)
		_, _ = w.Write([]byte("ok"))
	}))
	rr := httptest.NewRecorder()
	req := httptest.NewRequest(http.MethodGet, "/health", nil)
	h.ServeHTTP(rr, req)
	if rr.Code != http.StatusOK {
		t.Fatalf("health=%d", rr.Code)
	}
	rr2 := httptest.NewRecorder()
	req2 := httptest.NewRequest(http.MethodPost, "/mcp/workbench", nil)
	h.ServeHTTP(rr2, req2)
	if rr2.Code != http.StatusUnauthorized {
		t.Fatalf("mcp without token=%d", rr2.Code)
	}
}
