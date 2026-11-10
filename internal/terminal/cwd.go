package terminal

import (
	"context"
	"fmt"
	"strings"
	"time"

	"WWorkbench/internal/errno"

	"github.com/google/uuid"
)

// ProbeCwd 向可见 PTY 注入一行探测命令，读取当前工作目录。
func (m *Manager) ProbeCwd(ctx context.Context, sessionID string) (string, error) {
	if m == nil {
		return "", errno.New(errno.CodeNotFound, "终端服务不可用", "")
	}
	m.mu.RLock()
	s := m.sessions[strings.TrimSpace(sessionID)]
	m.mu.RUnlock()
	if s == nil {
		return "", errno.New(errno.CodeSessionClosed, "终端会话已关闭", sessionID)
	}

	tok := "WWCWD" + strings.ReplaceAll(uuid.NewString(), "-", "")[:10]
	gen, _ := s.tail.snapshotMeta()
	// 注入后可见一行 WWCWDxxx:/abs/path
	cmd := fmt.Sprintf("printf '%%s\\n' %s:\"$(pwd)\"\r", tok)
	if err := m.Write(sessionID, cmd); err != nil {
		return "", err
	}

	deadline := time.Now().Add(5 * time.Second)
	for time.Now().Before(deadline) {
		if path := findCwdMarker(s, tok); path != "" {
			return path, nil
		}
		waitCtx, cancel := context.WithTimeout(ctx, 250*time.Millisecond)
		_ = s.tail.waitAfter(waitCtx, gen)
		cancel()
		gen, _ = s.tail.snapshotMeta()
		if ctx.Err() != nil {
			return "", ctx.Err()
		}
	}
	if path := findCwdMarker(s, tok); path != "" {
		return path, nil
	}
	return "", errno.New(errno.CodeUnknown, "未能读取当前目录（请确认 shell 可用）", sessionID)
}

func findCwdMarker(s *Session, tok string) string {
	if s == nil {
		return ""
	}
	text, _ := s.tail.text(40)
	needle := tok + ":"
	idx := strings.LastIndex(text, needle)
	if idx < 0 {
		return ""
	}
	rest := text[idx+len(needle):]
	line, _, _ := strings.Cut(rest, "\n")
	path := strings.TrimSpace(strings.TrimRight(line, "\r"))
	if path == "" {
		return ""
	}
	// 本机 mac/linux 与远端 linux：绝对路径以 / 开头
	if strings.HasPrefix(path, "/") {
		return path
	}
	return ""
}

// SessionHostKey 返回 MCP 写授权用的 hostKey（local 或 hostId）。
func (m *Manager) SessionHostKey(sessionID string) (hostKey string, kind string, err error) {
	if m == nil {
		return "", "", errno.New(errno.CodeNotFound, "终端服务不可用", "")
	}
	m.mu.RLock()
	defer m.mu.RUnlock()
	s := m.sessions[strings.TrimSpace(sessionID)]
	if s == nil {
		return "", "", errno.New(errno.CodeSessionClosed, "终端会话已关闭", sessionID)
	}
	if s.Kind == kindLocal || strings.TrimSpace(s.HostID) == "" {
		return "local", string(s.Kind), nil
	}
	return s.HostID, string(s.Kind), nil
}
