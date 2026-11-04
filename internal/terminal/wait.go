package terminal

import (
	"context"
	"time"
)

// MaxShellWaitMs get_shell_output 最长阻塞等待（避免 MCP 工具无限挂起）。
const MaxShellWaitMs = 120_000

// WaitShellOutput 等到该会话有新输出（相对调用瞬间的 gen，或 afterUpdatedAt），最多 waitMs。
// waitMs<=0 时立即返回；超时不视为错误（调用方再读当前页）。
func (m *Manager) WaitShellOutput(ctx context.Context, sessionID, hostID string, afterUpdatedAt int64, waitMs int) (timedOut bool, err error) {
	if waitMs <= 0 {
		return false, nil
	}
	if waitMs > MaxShellWaitMs {
		waitMs = MaxShellWaitMs
	}
	s, err := m.resolveShellSession(sessionID, hostID)
	if err != nil {
		return false, err
	}
	gen, at := s.tail.snapshotMeta()
	if afterUpdatedAt > 0 && !at.IsZero() && at.Unix() > afterUpdatedAt {
		return false, nil
	}
	waitCtx, cancel := context.WithTimeout(ctx, time.Duration(waitMs)*time.Millisecond)
	defer cancel()
	if err := s.tail.waitAfter(waitCtx, gen); err != nil {
		if waitCtx.Err() != nil {
			return true, nil
		}
		return false, err
	}
	return false, nil
}
