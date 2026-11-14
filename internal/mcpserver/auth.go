package mcpserver

import (
	"net/http"
	"strings"
)

const authHeader = "Authorization"

// extractBearer 从 Authorization 头或 ?token= 取 Bearer token。
func extractBearer(r *http.Request) string {
	if r == nil {
		return ""
	}
	h := strings.TrimSpace(r.Header.Get(authHeader))
	if len(h) >= 7 && strings.EqualFold(h[:7], "Bearer ") {
		return strings.TrimSpace(h[7:])
	}
	if q := strings.TrimSpace(r.URL.Query().Get("token")); q != "" {
		return q
	}
	return ""
}

// authorizeRequest 校验 token；空 expect 表示未启用鉴权（开发兼容，生产应总有 token）。
func authorizeRequest(r *http.Request, expect string) bool {
	expect = strings.TrimSpace(expect)
	if expect == "" {
		return true
	}
	got := extractBearer(r)
	return got != "" && subtleConstEq(got, expect)
}

// subtleConstEq 常量时间比较，避免时序泄漏。
func subtleConstEq(a, b string) bool {
	if len(a) != len(b) {
		return false
	}
	var v byte
	for i := 0; i < len(a); i++ {
		v |= a[i] ^ b[i]
	}
	return v == 0
}

// isLoopbackOrigin 仅允许无 Origin / null / 本机 Origin（防御 CSRF 预检）。
func isLoopbackOrigin(origin string) bool {
	origin = strings.TrimSpace(origin)
	if origin == "" || origin == "null" {
		return true
	}
	low := strings.ToLower(origin)
	return strings.HasPrefix(low, "http://127.0.0.1") ||
		strings.HasPrefix(low, "http://localhost") ||
		strings.HasPrefix(low, "https://127.0.0.1") ||
		strings.HasPrefix(low, "https://localhost")
}

// writeRestrictedCORS 不回显任意 Origin；仅本机或无 Origin。
func writeRestrictedCORS(w http.ResponseWriter, r *http.Request) {
	origin := strings.TrimSpace(r.Header.Get("Origin"))
	if origin == "" {
		w.Header().Set("Access-Control-Allow-Origin", "*")
	} else if isLoopbackOrigin(origin) {
		w.Header().Set("Access-Control-Allow-Origin", origin)
		w.Header().Set("Vary", "Origin")
	}
	// 非本机 Origin：不设 ACAO，浏览器会拦截跨域读响应；实际写仍靠 Bearer。
	w.Header().Set("Access-Control-Allow-Methods", "GET, POST, OPTIONS")
	w.Header().Set("Access-Control-Allow-Headers", "Content-Type, Authorization, Accept, Mcp-Session-Id")
}

func writeUnauthorized(w http.ResponseWriter, r *http.Request) {
	writeRestrictedCORS(w, r)
	w.Header().Set("Content-Type", "application/json")
	// 故意不写 WWW-Authenticate: Bearer —— Cursor 见此会进入 OAuth「Authenticating…」并卡住。
	// 本机约定：URL ?token= 或 Authorization Bearer（设置页可复制）。
	w.WriteHeader(http.StatusUnauthorized)
	_, _ = w.Write([]byte(`{"ok":false,"error":"unauthorized","hint":"在 URL 加 ?token=<设置页 Token>，或 Authorization: Bearer <token>"}`))
}

// withAuth 包装 handler：/health 与 OPTIONS 放行，其余需 Bearer。
func withAuth(token string, next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.Method == http.MethodOptions {
			writeRestrictedCORS(w, r)
			w.WriteHeader(http.StatusNoContent)
			return
		}
		path := r.URL.Path
		if path == "/health" || path == "/health/" {
			writeRestrictedCORS(w, r)
			next.ServeHTTP(w, r)
			return
		}
		if !authorizeRequest(r, token) {
			writeUnauthorized(w, r)
			return
		}
		writeRestrictedCORS(w, r)
		next.ServeHTTP(w, r)
	})
}
