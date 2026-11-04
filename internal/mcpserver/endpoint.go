package mcpserver

import (
	"context"
	"fmt"
	"log"
	"net"
	"net/http"
	"strings"
	"sync"
	"time"
)

const readyWait = 25 * time.Second

// Endpoint 提前占用 MCP 端口。工作台未就绪时挂起请求，就绪后交给正式 handler。
// 避免 Cursor 在启动窗口里遇到 ECONNREFUSED 后把服务标成失败。
type Endpoint struct {
	mu         sync.RWMutex
	listenAddr string
	baseURL    string
	srv        *http.Server
	handler    http.Handler
}

// Listen 绑定地址并开始接受连接。此时还没有工具面，请求会等到 SetHandler。
func Listen(addr string) (*Endpoint, error) {
	addr = strings.TrimSpace(addr)
	if addr == "" {
		addr = DefaultHTTPAddr
	}
	ln, err := net.Listen("tcp", addr)
	if err != nil {
		return nil, fmt.Errorf("mcp listen %s: %w", addr, err)
	}
	host, port, err := net.SplitHostPort(ln.Addr().String())
	if err != nil {
		_ = ln.Close()
		return nil, err
	}
	ep := &Endpoint{
		listenAddr: net.JoinHostPort(host, port),
		baseURL:    fmt.Sprintf("http://%s:%s", host, port),
	}
	ep.srv = &http.Server{Handler: http.HandlerFunc(ep.serve)}
	go func() {
		if err := ep.srv.Serve(ln); err != nil && err != http.ErrServerClosed {
			log.Printf("mcp: serve %s: %v", ep.listenAddr, err)
		}
	}()
	log.Printf("mcp: listening %s", ep.baseURL)
	return ep, nil
}

// SetHandler 装上正式 MCP handler。已连上、还在等待的请求会继续处理。
func (e *Endpoint) SetHandler(h http.Handler) {
	if e == nil {
		return
	}
	e.mu.Lock()
	e.handler = h
	e.mu.Unlock()
}

// ListenAddr 实际绑定地址。
func (e *Endpoint) ListenAddr() string {
	if e == nil {
		return ""
	}
	return e.listenAddr
}

// EndpointURL 核工具面 URL。
func (e *Endpoint) EndpointURL() string {
	if e == nil {
		return ""
	}
	return e.baseURL + "/mcp"
}

// WorkbenchEndpointURL 产品工具面 URL。
func (e *Endpoint) WorkbenchEndpointURL() string {
	if e == nil {
		return ""
	}
	return e.baseURL + "/mcp/workbench"
}

// HealthURL 健康检查 URL。
func (e *Endpoint) HealthURL() string {
	if e == nil {
		return ""
	}
	return e.baseURL + "/health"
}

// Stop 关闭监听。
func (e *Endpoint) Stop(ctx context.Context) error {
	if e == nil || e.srv == nil {
		return nil
	}
	if ctx == nil {
		var cancel context.CancelFunc
		ctx, cancel = context.WithTimeout(context.Background(), 3*time.Second)
		defer cancel()
	}
	return e.srv.Shutdown(ctx)
}

func (e *Endpoint) current() http.Handler {
	e.mu.RLock()
	defer e.mu.RUnlock()
	return e.handler
}

func (e *Endpoint) serve(w http.ResponseWriter, r *http.Request) {
	if r.Method == http.MethodOptions {
		writeCORS(w, r)
		w.WriteHeader(http.StatusNoContent)
		return
	}
	if h := e.current(); h != nil {
		h.ServeHTTP(w, r)
		return
	}
	if r.URL.Path == "/health" {
		writeCORS(w, r)
		w.Header().Set("Content-Type", "application/json")
		_, _ = w.Write([]byte(`{"ok":true,"ready":false,"name":"wworkbench"}`))
		return
	}
	h := e.waitHandler(r.Context())
	if h == nil {
		writeCORS(w, r)
		w.Header().Set("Retry-After", "1")
		w.Header().Set("Content-Type", "application/json")
		w.WriteHeader(http.StatusServiceUnavailable)
		_, _ = w.Write([]byte(`{"ok":false,"error":"workbench starting"}`))
		return
	}
	h.ServeHTTP(w, r)
}

// waitHandler 等到正式 handler，或请求取消，或超过 readyWait。
func (e *Endpoint) waitHandler(ctx context.Context) http.Handler {
	deadline := time.NewTimer(readyWait)
	defer deadline.Stop()
	tick := time.NewTicker(150 * time.Millisecond)
	defer tick.Stop()
	for {
		if h := e.current(); h != nil {
			return h
		}
		select {
		case <-ctx.Done():
			return nil
		case <-deadline.C:
			return e.current()
		case <-tick.C:
		}
	}
}

func writeCORS(w http.ResponseWriter, r *http.Request) {
	origin := strings.TrimSpace(r.Header.Get("Origin"))
	if origin == "" {
		origin = "*"
	}
	w.Header().Set("Access-Control-Allow-Origin", origin)
	w.Header().Set("Access-Control-Allow-Methods", "GET, POST, OPTIONS")
	w.Header().Set("Access-Control-Allow-Headers", "Content-Type, Authorization, Accept, Mcp-Session-Id")
	w.Header().Set("Vary", "Origin")
}
