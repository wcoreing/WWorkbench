package browser

import (
	"context"
	"encoding/json"
	"fmt"
	"net"
	"net/http"
	"strings"
	"sync"
	"time"

	"WWorkbench/internal/errno"

	"github.com/google/uuid"
	"github.com/gorilla/websocket"
)

// DefaultAddr 本机桥默认地址（仅 loopback）。
const DefaultAddr = "127.0.0.1:18765"

const callTimeout = 45 * time.Second

var upgrader = websocket.Upgrader{
	CheckOrigin: func(r *http.Request) bool {
		return true // 仅监听 loopback
	},
}

// Status 桥与扩展连接状态。
type Status struct {
	Listening          bool     `json:"listening"`
	Addr               string   `json:"addr"`
	ExtensionConnected bool     `json:"extensionConnected"`
	AttachedTabID      *int64   `json:"attachedTabId,omitempty"`
	ExtDir             string   `json:"extDir"`
	ExtVersion         string   `json:"extVersion,omitempty"`
	SeedVersion        string   `json:"seedVersion,omitempty"`
	VersionMismatch    bool     `json:"versionMismatch,omitempty"`
	Capabilities       []string `json:"capabilities,omitempty"`
	Recording          bool     `json:"recording,omitempty"`
	RecordingSession   string   `json:"recordingSession,omitempty"`
	LastError          string   `json:"lastError,omitempty"`
}

// ExtEventHandler 扩展主动推送事件（录制步骤等）；在独立 goroutine 调用。
type ExtEventHandler func(action string, data json.RawMessage)

// Bridge 本机浏览器舞台桥：Agent/UI ↔ Chromium 扩展。
type Bridge struct {
	mu           sync.Mutex
	addr         string
	extDir       string
	ln           net.Listener
	srv          *http.Server
	conn         *websocket.Conn
	pending      map[string]chan callResult
	attached     *int64
	lastErr      string
	closed       bool
	eventHandler ExtEventHandler
}

type callResult struct {
	OK    bool
	Data  json.RawMessage
	Error string
}

type wireMsg struct {
	ID      string          `json:"id,omitempty"`
	Type    string          `json:"type,omitempty"`
	Action  string          `json:"action,omitempty"`
	Args    json.RawMessage `json:"args,omitempty"`
	Session string          `json:"session,omitempty"`
	OK      *bool           `json:"ok,omitempty"`
	Data    json.RawMessage `json:"data,omitempty"`
	Error   string          `json:"error,omitempty"`
	Code    string          `json:"code,omitempty"`
}

// NewBridge 创建桥（尚未 Listen）。
func NewBridge(addr, extDir string) *Bridge {
	if addr == "" {
		addr = DefaultAddr
	}
	return &Bridge{
		addr:    addr,
		extDir:  extDir,
		pending: make(map[string]chan callResult),
	}
}

// Start 在 loopback 上监听 WebSocket。
func (b *Bridge) Start() error {
	b.mu.Lock()
	defer b.mu.Unlock()
	if b.ln != nil {
		return nil
	}
	ln, err := net.Listen("tcp", b.addr)
	if err != nil {
		b.lastErr = err.Error()
		return errno.Wrap(errno.CodeConnFailed, "浏览器桥监听失败", err)
	}
	b.ln = ln
	b.closed = false
	mux := http.NewServeMux()
	mux.HandleFunc("/ext", b.handleExtWS)
	mux.HandleFunc("/health", func(w http.ResponseWriter, _ *http.Request) {
		_ = json.NewEncoder(w).Encode(b.Status())
	})
	mux.HandleFunc("/call", b.handleHTTPCall)
	mux.HandleFunc("/command", b.handleHTTPCall) // Kimi 风格别名
	b.srv = &http.Server{Handler: mux}
	go func() {
		_ = b.srv.Serve(ln)
	}()
	go b.pingLoop()
	return nil
}

// pingLoop 周期探测扩展连接，避免半开死连接占着「已连接」状态。
func (b *Bridge) pingLoop() {
	t := time.NewTicker(12 * time.Second)
	defer t.Stop()
	for range t.C {
		b.mu.Lock()
		if b.closed {
			b.mu.Unlock()
			return
		}
		c := b.conn
		b.mu.Unlock()
		if c == nil {
			continue
		}
		payload, _ := json.Marshal(wireMsg{Type: "ping"})
		if err := c.WriteMessage(websocket.TextMessage, payload); err != nil {
			b.mu.Lock()
			if b.conn == c {
				_ = b.conn.Close()
				b.conn = nil
				b.lastErr = "扩展连接已断开，等待重连"
			}
			b.mu.Unlock()
		}
	}
}

// Stop 关闭监听与扩展连接。
func (b *Bridge) Stop() {
	b.mu.Lock()
	defer b.mu.Unlock()
	b.closed = true
	for id, ch := range b.pending {
		ch <- callResult{OK: false, Error: "浏览器桥已关闭"}
		delete(b.pending, id)
	}
	if b.conn != nil {
		_ = b.conn.Close()
		b.conn = nil
	}
	if b.srv != nil {
		ctx, cancel := context.WithTimeout(context.Background(), 2*time.Second)
		_ = b.srv.Shutdown(ctx)
		cancel()
		b.srv = nil
	}
	if b.ln != nil {
		_ = b.ln.Close()
		b.ln = nil
	}
}

// Status 当前状态快照。
func (b *Bridge) Status() Status {
	b.mu.Lock()
	defer b.mu.Unlock()
	st := Status{
		Listening:          b.ln != nil,
		Addr:               b.addr,
		ExtensionConnected: b.conn != nil,
		ExtDir:             b.extDir,
		SeedVersion:        SeedVersion(),
		LastError:          b.lastErr,
	}
	if b.attached != nil {
		v := *b.attached
		st.AttachedTabID = &v
	}
	return st
}

// ExtDir 扩展释放目录。
func (b *Bridge) ExtDir() string {
	b.mu.Lock()
	defer b.mu.Unlock()
	return b.extDir
}

// SetEventHandler 注册扩展 → 应用事件回调（录制步骤等）。
func (b *Bridge) SetEventHandler(h ExtEventHandler) {
	b.mu.Lock()
	defer b.mu.Unlock()
	b.eventHandler = h
}

func (b *Bridge) handleExtWS(w http.ResponseWriter, r *http.Request) {
	c, err := upgrader.Upgrade(w, r, nil)
	if err != nil {
		return
	}
	b.mu.Lock()
	if b.conn != nil {
		_ = b.conn.Close()
	}
	b.conn = c
	b.lastErr = ""
	b.mu.Unlock()

	defer func() {
		b.mu.Lock()
		if b.conn == c {
			b.conn = nil
		}
		b.mu.Unlock()
		_ = c.Close()
	}()

	_ = c.SetReadDeadline(time.Time{})
	for {
		_, data, err := c.ReadMessage()
		if err != nil {
			return
		}
		var msg wireMsg
		if err := json.Unmarshal(data, &msg); err != nil {
			continue
		}
		if msg.Type == "hello" || msg.Type == "pong" || msg.Type == "heartbeat" {
			continue
		}
		if msg.Type == "event" {
			action := strings.TrimSpace(msg.Action)
			if action == "" {
				continue
			}
			b.mu.Lock()
			h := b.eventHandler
			b.mu.Unlock()
			if h != nil {
				data := msg.Data
				if len(data) == 0 {
					data = json.RawMessage(`{}`)
				}
				go h(action, data)
			}
			continue
		}
		if msg.ID == "" || msg.OK == nil {
			continue
		}
		b.mu.Lock()
		ch := b.pending[msg.ID]
		if ch != nil {
			delete(b.pending, msg.ID)
		}
		b.mu.Unlock()
		if ch == nil {
			continue
		}
		res := callResult{OK: *msg.OK, Data: msg.Data, Error: msg.Error}
		select {
		case ch <- res:
		default:
		}
	}
}

// Call 向扩展发命令并等待结果（等价 CallSession(ctx, action, args, "")）。
func (b *Bridge) Call(ctx context.Context, action string, args interface{}) (json.RawMessage, error) {
	return b.CallSession(ctx, action, args, "")
}

// CallSession 带 session 的命令调用（Kimi：同一任务共用 session）。
func (b *Bridge) CallSession(ctx context.Context, action string, args interface{}, session string) (json.RawMessage, error) {
	if action == "" {
		return nil, errno.New(errno.CodeInvalidArg, "缺少 action", "")
	}
	argsRaw, err := json.Marshal(args)
	if err != nil {
		return nil, err
	}
	if argsRaw == nil || string(argsRaw) == "null" {
		argsRaw = []byte("{}")
	}
	id := uuid.NewString()
	ch := make(chan callResult, 1)

	b.mu.Lock()
	if b.conn == nil {
		b.mu.Unlock()
		return nil, errno.New(errno.CodeConnFailed, "浏览器扩展未连接", "请在 Chrome/Edge 加载 ~/.wworkbench/browser-ext，并保持 WWorkbench 运行")
	}
	b.pending[id] = ch
	payload, _ := json.Marshal(wireMsg{ID: id, Action: action, Args: argsRaw, Session: session})
	err = b.conn.WriteMessage(websocket.TextMessage, payload)
	b.mu.Unlock()
	if err != nil {
		b.mu.Lock()
		delete(b.pending, id)
		b.conn = nil
		b.lastErr = err.Error()
		b.mu.Unlock()
		return nil, errno.Wrap(errno.CodeConnFailed, "向扩展发送失败", err)
	}

	if ctx == nil {
		ctx = context.Background()
	}
	waitCtx, cancel := context.WithTimeout(ctx, callTimeout)
	defer cancel()
	select {
	case <-waitCtx.Done():
		b.mu.Lock()
		delete(b.pending, id)
		b.mu.Unlock()
		return nil, errno.New(errno.CodeConnFailed, "等待扩展响应超时", action)
	case res := <-ch:
		if !res.OK {
			msg := res.Error
			if msg == "" {
				msg = "扩展返回失败"
			}
			return nil, errno.New(errno.CodeConnFailed, msg, action)
		}
		switch action {
		case "attach", "navigate", "find_tab", "open_frame":
			b.rememberAttached(res.Data)
		}
		if res.Data == nil {
			return json.RawMessage(`{}`), nil
		}
		return res.Data, nil
	}
}

func (b *Bridge) rememberAttached(data json.RawMessage) {
	var out struct {
		TabID int64 `json:"tabId"`
	}
	if json.Unmarshal(data, &out) == nil && out.TabID > 0 {
		b.mu.Lock()
		v := out.TabID
		b.attached = &v
		b.mu.Unlock()
	}
}

// handleHTTPCall 本机调试 / Agent CLI：POST {"action","args","session"} → {ok,data}|{ok:false,error:{code,message}}。
func (b *Bridge) handleHTTPCall(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
		http.Error(w, "POST only", http.StatusMethodNotAllowed)
		return
	}
	host, _, _ := net.SplitHostPort(r.RemoteAddr)
	if host != "127.0.0.1" && host != "::1" && host != "localhost" {
		http.Error(w, "loopback only", http.StatusForbidden)
		return
	}
	var body struct {
		Action  string          `json:"action"`
		Args    json.RawMessage `json:"args"`
		Session string          `json:"session"`
	}
	if err := json.NewDecoder(r.Body).Decode(&body); err != nil || body.Action == "" {
		w.Header().Set("Content-Type", "application/json")
		w.WriteHeader(http.StatusBadRequest)
		_ = json.NewEncoder(w).Encode(map[string]interface{}{
			"ok": false,
			"error": map[string]string{
				"code":    "invalid_arg",
				"message": "need {\"action\",\"args?\",\"session?\"}",
			},
		})
		return
	}
	var args interface{}
	if len(body.Args) > 0 && string(body.Args) != "null" {
		args = body.Args
	} else {
		args = map[string]interface{}{}
	}
	data, err := b.CallSession(r.Context(), body.Action, args, body.Session)
	w.Header().Set("Content-Type", "application/json")
	if err != nil {
		w.WriteHeader(http.StatusBadGateway)
		_ = json.NewEncoder(w).Encode(map[string]interface{}{
			"ok": false,
			"error": map[string]string{
				"code":    "bridge_error",
				"message": err.Error(),
			},
		})
		return
	}
	_ = json.NewEncoder(w).Encode(map[string]interface{}{"ok": true, "data": json.RawMessage(data)})
}

// Connected 扩展是否在线。
func (b *Bridge) Connected() bool {
	b.mu.Lock()
	defer b.mu.Unlock()
	return b.conn != nil
}

// PingExt 轻量探测。
func (b *Bridge) PingExt(ctx context.Context) error {
	_, err := b.Call(ctx, "status", map[string]interface{}{})
	return err
}

func (b *Bridge) String() string {
	st := b.Status()
	return fmt.Sprintf("browser-bridge listening=%v ext=%v addr=%s", st.Listening, st.ExtensionConnected, st.Addr)
}
