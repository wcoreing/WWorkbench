package terminal

import (
	"context"
	"strings"
	"time"
	"unicode"
)

// MaxShellWaitMs get_shell_output 最长阻塞等待（避免 MCP 工具无限挂起）。
const MaxShellWaitMs = 120_000

// ShellOutputSettleMs 见到新输出后，安静多久视为一段输出结束（避免只拿到半行就返回）。
const ShellOutputSettleMs = 400

// ShellIdlePromptEarlyMs 水位已追上且像停在提示符时，最多再空等这么久（避免 Agent 用 90s waitMs 空耗）。
const ShellIdlePromptEarlyMs = 2000

// WaitShellOutput 等到该会话有新输出（相对 afterUpdatedAt，或调用瞬间的 gen），最多 waitMs。
// afterUpdatedAt 支持毫秒（推荐）或秒；若当前已有更新则立刻返回（可再 settle）。
// 若水位已对齐且终端像停在提示符：短空等后返回 timedOut（不再烧满 waitMs）。
// waitMs<=0 时立即返回；超时不视为错误（调用方再读当前页）。
// waitedMs 为真实阻塞毫秒数。
func (m *Manager) WaitShellOutput(ctx context.Context, sessionID, hostID string, afterUpdatedAt int64, waitMs int) (timedOut bool, waitedMs int, err error) {
	start := time.Now()
	defer func() {
		waitedMs = int(time.Since(start).Milliseconds())
		if waitedMs < 0 {
			waitedMs = 0
		}
	}()
	if waitMs <= 0 {
		return false, 0, nil
	}
	if waitMs > MaxShellWaitMs {
		waitMs = MaxShellWaitMs
	}
	s, err := m.resolveShellSession(sessionID, hostID)
	if err != nil {
		return false, 0, err
	}
	afterMs := CoerceUpdatedAtMs(afterUpdatedAt)
	deadline := start.Add(time.Duration(waitMs) * time.Millisecond)
	waitCtx, cancel := context.WithDeadline(ctx, deadline)
	defer cancel()

	gen, at := s.tail.snapshotMeta()
	already := afterMs > 0 && !at.IsZero() && at.UnixMilli() > afterMs
	if !already {
		// 水位已追上 + 像在提示符：Agent 常在构建结束后仍带大 waitMs 再等；短空等即可。
		caughtUp := afterMs > 0 && !at.IsZero() && at.UnixMilli() >= afterMs
		if caughtUp && looksLikeShellPromptIdle(s.tail) {
			idleMs := ShellIdlePromptEarlyMs
			if idleMs > waitMs {
				idleMs = waitMs
			}
			idleCtx, idleCancel := context.WithTimeout(waitCtx, time.Duration(idleMs)*time.Millisecond)
			werr := s.tail.waitAfter(idleCtx, gen)
			idleCancel()
			if werr == nil {
				_ = s.tail.waitQuiet(waitCtx, time.Duration(ShellOutputSettleMs)*time.Millisecond)
				return false, 0, nil
			}
			// 短空等仍无新输出 → 视为超时（调用方读当前页即可）
			return true, 0, nil
		}
		if err := s.tail.waitAfter(waitCtx, gen); err != nil {
			if waitCtx.Err() != nil {
				return true, 0, nil
			}
			return false, 0, err
		}
	}
	// 新输出到达（或基线已更新）后安静一小段，凑齐整段再返回。
	_ = s.tail.waitQuiet(waitCtx, time.Duration(ShellOutputSettleMs)*time.Millisecond)
	return false, 0, nil
}

// looksLikeShellPromptIdle 末行像交互提示符（构建/命令已回到 shell）。
func looksLikeShellPromptIdle(t *outputTail) bool {
	if t == nil {
		return false
	}
	text, _ := t.text(12)
	text = strings.TrimSpace(ansiEscape.ReplaceAllString(text, ""))
	if text == "" {
		return false
	}
	lines := strings.Split(text, "\n")
	last := strings.TrimRightFunc(lines[len(lines)-1], unicode.IsSpace)
	if last == "" {
		return false
	}
	// zsh/bash/fish：… % / $ / # ；部分环境末尾带 ▌/空格已 trim
	r := rune(last[len(last)-1])
	switch r {
	case '%', '$', '#', '>':
		return true
	default:
		return false
	}
}

// CoerceUpdatedAtMs 把 afterUpdatedAt/updatedAt 规范为毫秒。
// <1e12 视为秒（兼容旧 Agent）；否则视为毫秒。
func CoerceUpdatedAtMs(v int64) int64 {
	if v <= 0 {
		return 0
	}
	if v < 1_000_000_000_000 {
		return v * 1000
	}
	return v
}
