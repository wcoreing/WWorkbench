package terminal

import (
	"regexp"
	"strings"
	"sync"
	"time"

	"WWorkbench/internal/errno"
)

// ShellTailLines 默认单页行数（get_shell_output / 旧前馈对齐）。
const ShellTailLines = 100

// MaxShellOutputLines 单次 get_shell_output 最多返回行数。
const MaxShellOutputLines = 500

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

func (t *outputTail) page(offsetFromEnd, maxLines int) (ShellOutputPage, time.Time) {
	if t == nil {
		return ShellOutputPage{}, time.Time{}
	}
	t.mu.Lock()
	defer t.mu.Unlock()
	p := pagePTYLines(string(t.buf), offsetFromEnd, maxLines)
	return p, t.at
}

// ShellOutputPage 终端 scrollback 分页结果（从尾部向历史翻页）。
type ShellOutputPage struct {
	Text           string `json:"text"`
	TotalLines     int    `json:"totalLines"`
	OffsetFromEnd  int    `json:"offsetFromEnd"`
	ReturnedLines  int    `json:"returnedLines"`
	HasMoreOlder   bool   `json:"hasMoreOlder"`
	NextOffsetFrom int    `json:"nextOffsetFromEnd,omitempty"`
}

// normalizePTYLines 去 ANSI、归一换行并去掉首尾空行。
func normalizePTYLines(raw string) []string {
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
	return lines
}

// pagePTYLines 从尾部向历史翻页：offsetFromEnd=0 为最新一页。
func pagePTYLines(raw string, offsetFromEnd, maxLines int) ShellOutputPage {
	if maxLines <= 0 {
		maxLines = ShellTailLines
	}
	if maxLines > MaxShellOutputLines {
		maxLines = MaxShellOutputLines
	}
	if offsetFromEnd < 0 {
		offsetFromEnd = 0
	}
	lines := normalizePTYLines(raw)
	total := len(lines)
	if total == 0 {
		return ShellOutputPage{TotalLines: 0, OffsetFromEnd: offsetFromEnd}
	}
	end := total - offsetFromEnd
	if end <= 0 {
		return ShellOutputPage{
			TotalLines:    total,
			OffsetFromEnd: offsetFromEnd,
		}
	}
	start := end - maxLines
	if start < 0 {
		start = 0
	}
	chunk := lines[start:end]
	out := ShellOutputPage{
		Text:          strings.Join(chunk, "\n"),
		TotalLines:    total,
		OffsetFromEnd: offsetFromEnd,
		ReturnedLines: len(chunk),
		HasMoreOlder:  start > 0,
	}
	if out.HasMoreOlder {
		out.NextOffsetFrom = offsetFromEnd + out.ReturnedLines
	}
	return out
}

// clipPTYTail 去掉 ANSI，按行截最近 maxLines 行。
func clipPTYTail(raw string, maxLines int) string {
	if maxLines <= 0 {
		maxLines = ShellTailLines
	}
	p := pagePTYLines(raw, 0, maxLines)
	return p.Text
}

// SessionTail 打开中的终端及其最近输出。
type SessionTail struct {
	SessionID  string `json:"sessionId"`
	HostID     string `json:"hostId,omitempty"`
	Title      string `json:"title"`
	Kind       string `json:"kind"`
	Tail       string `json:"tail,omitempty"`
	TotalLines int    `json:"totalLines,omitempty"`
	UpdatedAt  int64  `json:"updatedAt,omitempty"`
}

// RecentOpenSession 最近活动的打开终端（含无输出的会话，供元数据指针）。
func (m *Manager) RecentOpenSession() SessionTail {
	m.mu.RLock()
	defer m.mu.RUnlock()
	var best SessionTail
	var bestAt time.Time
	for _, s := range m.sessions {
		_, at := s.tail.text(1)
		if best.SessionID == "" || at.After(bestAt) {
			bestAt = at
			page, _ := s.tail.page(0, 0)
			best = SessionTail{
				SessionID:  s.ID,
				HostID:     s.HostID,
				Title:      s.Title,
				Kind:       string(s.Kind),
				TotalLines: page.TotalLines,
			}
			if !at.IsZero() {
				best.UpdatedAt = at.Unix()
			}
		}
	}
	return best
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

// ListSessionTails 所有打开终端的元数据（不含正文；正文用 get_shell_output）。
func (m *Manager) ListSessionTails(maxLines int) []SessionTail {
	_ = maxLines
	m.mu.RLock()
	defer m.mu.RUnlock()
	out := make([]SessionTail, 0, len(m.sessions))
	for _, s := range m.sessions {
		page, at := s.tail.page(0, 0)
		item := SessionTail{
			SessionID:  s.ID,
			HostID:     s.HostID,
			Title:      s.Title,
			Kind:       string(s.Kind),
			TotalLines: page.TotalLines,
		}
		if !at.IsZero() {
			item.UpdatedAt = at.Unix()
		}
		out = append(out, item)
	}
	return out
}

// GetShellOutput 按 sessionId 或 hostId 分页读取可见 PTY scrollback。
func (m *Manager) GetShellOutput(sessionID, hostID string, offsetFromEnd, lines int) (SessionTail, ShellOutputPage, error) {
	s, err := m.resolveShellSession(sessionID, hostID)
	if err != nil {
		return SessionTail{}, ShellOutputPage{}, err
	}
	page, at := s.tail.page(offsetFromEnd, lines)
	meta := SessionTail{
		SessionID:  s.ID,
		HostID:     s.HostID,
		Title:      s.Title,
		Kind:       string(s.Kind),
		TotalLines: page.TotalLines,
	}
	if !at.IsZero() {
		meta.UpdatedAt = at.Unix()
	}
	return meta, page, nil
}

func (m *Manager) resolveShellSession(sessionID, hostID string) (*Session, error) {
	m.mu.RLock()
	defer m.mu.RUnlock()
	if sid := strings.TrimSpace(sessionID); sid != "" {
		s, ok := m.sessions[sid]
		if !ok {
			return nil, errno.New(errno.CodeSessionClosed, "终端会话已关闭", sid)
		}
		return s, nil
	}
	hid := strings.TrimSpace(hostID)
	var best *Session
	var bestAt time.Time
	for _, s := range m.sessions {
		if hid != "" && s.HostID != hid {
			continue
		}
		_, at := s.tail.text(1)
		if best == nil || at.After(bestAt) {
			best = s
			bestAt = at
		}
	}
	if best == nil {
		if hid != "" {
			return nil, errno.New(errno.CodeNotFound, "未找到该主机的打开终端", hid)
		}
		return nil, errno.New(errno.CodeNotFound, "没有打开的终端会话", "")
	}
	return best, nil
}
