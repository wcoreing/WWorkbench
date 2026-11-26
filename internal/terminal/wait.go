package terminal

import (
	"context"
	"strings"
	"time"
	"unicode"
	"unicode/utf8"
)

// MaxShellWaitMs get_shell_output 最长阻塞等待（避免 MCP 工具无限挂起）。
const MaxShellWaitMs = 120_000

// ShellOutputSettleMs 见到新输出后，安静多久视为一段输出结束（避免只拿到半行就返回）。
const ShellOutputSettleMs = 400

// ShellIdlePromptEarlyMs 水位已追上且像停在提示符时，最多再空等这么久（避免 Agent 用 90s waitMs 空耗）。
const ShellIdlePromptEarlyMs = 2000

// shellPromptQuiet 提示符出现后再安静这么久才注入，躲开登录脚本的后续输出。
const shellPromptQuiet = 400 * time.Millisecond

// shellPromptFallbackAfter 认不出提示符时，输出已安静才允许注入。
const shellPromptFallbackAfter = 8 * time.Second

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
	s, err := m.resolveShellSession(sessionID, hostID, "")
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

// WaitShellPrompt 等到该会话停在交互提示符。空缓冲和 heredoc 续行都不算就绪。
// 超时返回 false，不视为错误。
func (m *Manager) WaitShellPrompt(ctx context.Context, sessionID string, timeoutMs int) (bool, error) {
	if timeoutMs <= 0 {
		timeoutMs = 12_000
	}
	if timeoutMs > 30_000 {
		timeoutMs = 30_000
	}
	s, err := m.get(sessionID)
	if err != nil {
		return false, err
	}
	if ctx == nil {
		ctx = context.Background()
	}
	waitCtx, cancel := context.WithTimeout(ctx, time.Duration(timeoutMs)*time.Millisecond)
	defer cancel()
	start := time.Now()
	var seenGen uint64
	quietSince := start
	for {
		if waitCtx.Err() != nil {
			return false, nil
		}
		gen, _ := s.tail.snapshotMeta()
		if gen != seenGen {
			seenGen = gen
			quietSince = time.Now()
		}
		quiet := time.Since(quietSince)
		last := shellLastLine(s.tail)
		if shellPromptReady(last) && quiet >= shellPromptQuiet {
			return true, nil
		}
		if time.Since(start) >= shellPromptFallbackAfter && last != "" && !shellContinuation(last) && quiet >= time.Second {
			return true, nil
		}
		wctx, wcancel := context.WithTimeout(waitCtx, 150*time.Millisecond)
		_ = s.tail.waitAfter(wctx, gen)
		wcancel()
	}
}

// looksLikeShellPromptIdle 末行像交互提示符（构建/命令已回到 shell）。
func looksLikeShellPromptIdle(t *outputTail) bool {
	return shellPromptReady(shellLastLine(t))
}

func shellLastLine(t *outputTail) string {
	if t == nil {
		return ""
	}
	text, _ := t.text(12)
	text = strings.TrimSpace(ansiEscape.ReplaceAllString(text, ""))
	if text == "" {
		return ""
	}
	lines := strings.Split(text, "\n")
	for i := len(lines) - 1; i >= 0; i-- {
		last := strings.TrimRightFunc(lines[i], unicode.IsSpace)
		if last != "" {
			return last
		}
	}
	return ""
}

func shellContinuation(last string) bool {
	low := strings.ToLower(strings.TrimSpace(last))
	if low == "" {
		return false
	}
	return strings.Contains(low, "heredoc") ||
		strings.Contains(low, "dquote") ||
		strings.Contains(low, "bquote") ||
		strings.Contains(low, "cmdand") ||
		strings.HasSuffix(low, "quote>")
}

func shellPromptReady(last string) bool {
	if last == "" || shellContinuation(last) {
		return false
	}
	r, _ := utf8.DecodeLastRuneInString(last)
	switch r {
	case '%', '$', '#', '❯', '›', '➜', 'λ':
		return true
	case '>':
		return !strings.HasSuffix(strings.ToLower(last), "quote>")
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
