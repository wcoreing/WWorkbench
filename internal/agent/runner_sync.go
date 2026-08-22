package agent

import (
	"context"
	"fmt"
	"strings"
	"time"

	"WWorkbench/internal/model"
)

const syncChatTimeout = 180 * time.Second

// ChatSync 同步发起 Agent 对话并等待本轮结束（供 MCP 外置客户端闭环测试）。
func (r *Runner) ChatSync(ctx context.Context, req model.AgentChatRequestDO) (model.AgentChatSyncResultDO, error) {
	p, err := r.prepareChat(req, true)
	if err != nil {
		return model.AgentChatSyncResultDO{}, err
	}
	r.emitAgentUser(p)

	runCtx, cancel := context.WithTimeout(ctx, syncChatTimeout)
	defer cancel()
	done := make(chan struct{}, 1)
	go func() {
		r.runTurn(p.threadID, p.prompt, p.ff, false, p.skillIDs)
		done <- struct{}{}
	}()

	select {
	case <-runCtx.Done():
		r.Stop(p.threadID)
		return model.AgentChatSyncResultDO{ThreadID: p.threadID, SkillIDs: p.skillIDs},
			fmt.Errorf("对话超时: %w", runCtx.Err())
	case <-done:
	}

	out := r.syncResultFromThread(p.threadID)
	out.SkillIDs = p.skillIDs
	return out, nil
}

// ConfirmSync 同步确认待执行工具并等待续跑结束（MCP）。
func (r *Runner) ConfirmSync(ctx context.Context, pendingID string, approved bool) (model.AgentChatSyncResultDO, error) {
	pendingID = strings.TrimSpace(pendingID)
	if pendingID == "" {
		return model.AgentChatSyncResultDO{}, fmt.Errorf("pendingId 不能为空")
	}
	p, err := r.store.GetAgentPending(pendingID)
	if err != nil {
		return model.AgentChatSyncResultDO{}, err
	}
	threadID := p.ThreadID

	runCtx, cancel := context.WithTimeout(ctx, syncChatTimeout)
	defer cancel()
	done := make(chan struct{}, 1)
	go func() {
		_ = r.Confirm(pendingID, approved)
		done <- struct{}{}
	}()

	select {
	case <-runCtx.Done():
		r.Stop(threadID)
		return model.AgentChatSyncResultDO{ThreadID: threadID},
			fmt.Errorf("确认续跑超时: %w", runCtx.Err())
	case <-done:
	}

	// Confirm 内部异步 runTurn，轮询至结束或新 pending。
	deadline := time.Now().Add(syncChatTimeout)
	for time.Now().Before(deadline) {
		if ctx.Err() != nil {
			return model.AgentChatSyncResultDO{ThreadID: threadID}, ctx.Err()
		}
		if pid, _ := r.store.FirstPendingByThread(threadID); pid != "" {
			out := r.syncResultFromThread(threadID)
			out.WaitingConfirm = true
			out.PendingID = pid
			return out, nil
		}
		if !r.isRunning(threadID) {
			return r.syncResultFromThread(threadID), nil
		}
		time.Sleep(200 * time.Millisecond)
	}
	return model.AgentChatSyncResultDO{ThreadID: threadID}, fmt.Errorf("等待 Agent 续跑超时")
}

func (r *Runner) isRunning(threadID string) bool {
	r.runsMu.Lock()
	_, ok := r.runs[threadID]
	r.runsMu.Unlock()
	return ok
}

func (r *Runner) syncResultFromThread(threadID string) model.AgentChatSyncResultDO {
	out := model.AgentChatSyncResultDO{ThreadID: threadID}
	if pid, err := r.store.FirstPendingByThread(threadID); err == nil && pid != "" {
		out.WaitingConfirm = true
		out.PendingID = pid
	}
	msgs := r.ListMessages(threadID)
	for i := len(msgs) - 1; i >= 0; i-- {
		if msgs[i].Role == "assistant" && strings.TrimSpace(msgs[i].Content) != "" {
			out.Reply = msgs[i].Content
			break
		}
	}
	return out
}
