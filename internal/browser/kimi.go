package browser

import (
	"bytes"
	"context"
	"encoding/json"
	"io"
	"net"
	"net/http"
	"strings"
	"time"

	"WWorkbench/internal/errno"
)

// KimiDefaultAddr Kimi WebBridge 默认地址。
const KimiDefaultAddr = "127.0.0.1:10086"

// KimiExecutor 经 HTTP /command 调用 Kimi WebBridge。
type KimiExecutor struct {
	Addr   string
	Client *http.Client
}

func NewKimiExecutor(addr string) *KimiExecutor {
	if strings.TrimSpace(addr) == "" {
		addr = KimiDefaultAddr
	}
	return &KimiExecutor{
		Addr: addr,
		Client: &http.Client{
			Timeout: callTimeout,
			Transport: &http.Transport{
				DialContext: (&net.Dialer{Timeout: 2 * time.Second}).DialContext,
			},
		},
	}
}

func (e *KimiExecutor) Name() string { return ExecutorNameKimi }

func (e *KimiExecutor) addr() string {
	if e == nil || strings.TrimSpace(e.Addr) == "" {
		return KimiDefaultAddr
	}
	return e.Addr
}

func (e *KimiExecutor) Available(ctx context.Context) bool {
	if e == nil {
		return false
	}
	d := net.Dialer{Timeout: 800 * time.Millisecond}
	c, err := d.DialContext(ctx, "tcp", e.addr())
	if err != nil {
		return false
	}
	_ = c.Close()
	return true
}

func (e *KimiExecutor) Call(ctx context.Context, action string, args json.RawMessage, session string) (json.RawMessage, error) {
	if e == nil {
		return nil, errno.New(errno.CodeConnFailed, "kimi 执行器未就绪", "")
	}
	action = strings.TrimSpace(action)
	if action == "" {
		return nil, errno.New(errno.CodeInvalidArg, "缺少 action", "")
	}
	normArgs, err := NormalizeArgsForKimi(action, args)
	if err != nil {
		return nil, err
	}
	// keys → send_keys（Kimi 工具名）
	callAction := action
	if action == "keys" {
		callAction = "send_keys"
	}
	data, err := e.roundTrip(ctx, callAction, normArgs, session)
	if err != nil && action == "wait" && IsKimiUnknownTool(err) {
		return e.waitPolyfill(ctx, normArgs, session)
	}
	if err != nil {
		return nil, err
	}
	return NormalizeResultFromKimi(action, data), nil
}

func (e *KimiExecutor) roundTrip(ctx context.Context, action string, args json.RawMessage, session string) (json.RawMessage, error) {
	if len(args) == 0 || string(args) == "null" {
		args = json.RawMessage(`{}`)
	}
	body, _ := json.Marshal(map[string]interface{}{
		"action":  action,
		"args":    json.RawMessage(args),
		"session": strings.TrimSpace(session),
	})
	url := "http://" + e.addr() + "/command"
	req, err := http.NewRequestWithContext(ctx, http.MethodPost, url, bytes.NewReader(body))
	if err != nil {
		return nil, err
	}
	req.Header.Set("Content-Type", "application/json")
	cli := e.Client
	if cli == nil {
		cli = http.DefaultClient
	}
	res, err := cli.Do(req)
	if err != nil {
		return nil, errno.Wrap(errno.CodeConnFailed, "调用 Kimi WebBridge 失败", err)
	}
	defer res.Body.Close()
	raw, err := io.ReadAll(io.LimitReader(res.Body, 8<<20))
	if err != nil {
		return nil, err
	}
	var env struct {
		OK    *bool           `json:"ok"`
		Data  json.RawMessage `json:"data"`
		Error *struct {
			Code    string `json:"code"`
			Message string `json:"message"`
		} `json:"error"`
	}
	if err := json.Unmarshal(raw, &env); err != nil {
		return nil, errno.New(errno.CodeConnFailed, "Kimi 返回非 JSON", string(raw))
	}
	if env.OK != nil && !*env.OK {
		msg := "Kimi 调用失败"
		if env.Error != nil && env.Error.Message != "" {
			msg = env.Error.Message
		}
		return nil, errno.New(errno.CodeConnFailed, msg, action)
	}
	if len(env.Data) == 0 {
		return json.RawMessage(`{}`), nil
	}
	return env.Data, nil
}

// waitPolyfill 旧版 Kimi 扩展无 wait 时：轮询 snapshot 匹配条件。
func (e *KimiExecutor) waitPolyfill(ctx context.Context, args json.RawMessage, session string) (json.RawMessage, error) {
	deadline := time.Now().Add(WaitPolyfillTimeout(args))
	start := time.Now()
	var lastObs map[string]interface{}
	for {
		snapArgs, _ := json.Marshal(map[string]interface{}{"format": "aria", "max_chars": 20000})
		snap, err := e.roundTrip(ctx, "snapshot", snapArgs, session)
		if err == nil {
			snap = NormalizeResultFromKimi("snapshot", snap)
			text := SnapshotTextFromResult(snap)
			_ = json.Unmarshal(snap, &lastObs)
			if WaitConditionMatched(args, text) {
				return FormatWaitPolyfillResult(true, time.Since(start).Milliseconds(), lastObs), nil
			}
		}
		if time.Now().After(deadline) {
			return FormatWaitPolyfillResult(false, time.Since(start).Milliseconds(), lastObs), nil
		}
		select {
		case <-ctx.Done():
			return nil, ctx.Err()
		case <-time.After(350 * time.Millisecond):
		}
	}
}
