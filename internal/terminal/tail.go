package terminal

import (
	"regexp"
	"strings"
	"sync"
	"time"
)

// ShellTailLines 与前端 Agent 前馈行数对齐。
const ShellTailLines = 100

const maxTailBytes = 256 * 1024

var ansiEscape = regexp.MustCompile(`\x1b\[[0-9;?=]*[ -/]*[@-~]|\x1b\][^\x07\x1b]*(\x07|\x1b\\)|\x1b[()][0-2A-B]|\x1b[NO]`)

type outputTail struct {
	mu  sync.Mutex
	buf []byte
	at  time.Time
}

func newOutputTail() *outputTail {
	return &outputTail{}
}

func (t *outputTail) append(p []byte) {
	if t == nil || len(p) == 0 {
		return
	}
	t.mu.Lock()
	defer t.mu.Unlock()
	t.buf = append(t.buf, p...)
	if len(t.buf) > maxTailBytes {
		t.buf = append([]byte(nil), t.buf[len(t.buf)-maxTailBytes/2:]...)
	}
	t.at = time.Now()
}

func (t *outputTail) text(maxLines int) (string, time.Time) {
	if t == nil {
		return "", time.Time{}
	}
	t.mu.Lock()
	defer t.mu.Unlock()
	return clipPTYTail(string(t.buf), maxLines), t.at
}

// clipPTYTail 去掉 ANSI，按行截最近 maxLines 行。
func clipPTYTail(raw string, maxLines int) string {
	if maxLines <= 0 {
		maxLines = ShellTailLines
	}
	s := ansiEscape.ReplaceAllString(raw, "")
	s = strings.ReplaceAll(s, "\r\n", "\n")
	s = strings.ReplaceAll(s, "\r", "\n")
	lines := strings.Split(s, "\n")
	for len(lines) > 0 && strings.TrimSpace(lines[0]) == "" {
		lines = lines[1:]
	}
	for len(lines) > 0 && strings.TrimSpace(lines[len(lines)-1]) == "" {
		lines = lines[:len(lines)-1]
	}
	if len(lines) > maxLines {
		lines = lines[len(lines)-maxLines:]
	}
	return strings.Join(lines, "\n")
}

// SessionTail 打开中的终端及其最近输出。
type SessionTail struct {
	SessionID string `json:"sessionId"`
	HostID    string `json:"hostId,omitempty"`
	Title     string `json:"title"`
	Kind      string `json:"kind"`
	Tail      string `json:"tail"`
	UpdatedAt int64  `json:"updatedAt,omitempty"`
}

// RecentShellTail 最近有输出的可见 PTY 尾部（与面板同源字节，非 xterm 渲染格）。
func (m *Manager) RecentShellTail(maxLines int) SessionTail {
	if maxLines <= 0 {
		maxLines = ShellTailLines
	}
	m.mu.RLock()
	defer m.mu.RUnlock()
	var best SessionTail
	var bestAt time.Time
	for _, s := range m.sessions {
		text, at := s.tail.text(maxLines)
		if text == "" {
			continue
		}
		if at.After(bestAt) {
			bestAt = at
			best = SessionTail{
				SessionID: s.ID,
				HostID:    s.HostID,
				Title:     s.Title,
				Kind:      string(s.Kind),
				Tail:      text,
				UpdatedAt: at.Unix(),
			}
		}
	}
	return best
}

// ListSessionTails 所有打开终端的尾部（空输出也列元数据）。
func (m *Manager) ListSessionTails(maxLines int) []SessionTail {
	if maxLines <= 0 {
		maxLines = ShellTailLines
	}
	m.mu.RLock()
	defer m.mu.RUnlock()
	out := make([]SessionTail, 0, len(m.sessions))
	for _, s := range m.sessions {
		text, at := s.tail.text(maxLines)
		item := SessionTail{
			SessionID: s.ID,
			HostID:    s.HostID,
			Title:     s.Title,
			Kind:      string(s.Kind),
			Tail:      text,
		}
		if !at.IsZero() {
			item.UpdatedAt = at.Unix()
		}
		out = append(out, item)
	}
	return out
}
