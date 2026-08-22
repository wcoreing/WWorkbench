package workbenchtools

import (
	"context"
	"encoding/json"
	"strings"

	"WWorkbench/internal/model"
)

type agentChatArgs struct {
	Message   string                 `json:"message"`
	ThreadID  string                 `json:"threadId"`
	Mode      string                 `json:"mode"`
	SkillIDs  []string               `json:"skillIds"`
	NoteID    string                 `json:"noteId"`
	SshHostID string                 `json:"sshHostId"`
	Mentions  []model.AgentMentionDO `json:"mentions"`
}

type agentConfirmArgs struct {
	PendingID string `json:"pendingId"`
	Approved  *bool  `json:"approved"`
}

func agentChatContext(d *Deps, in agentChatArgs) model.AgentContextDO {
	ctx := model.AgentContextDO{NoteID: strings.TrimSpace(in.NoteID)}
	mentions := in.Mentions
	if len(mentions) == 0 {
		if m, ok := sshMentionFromHostID(d, in.SshHostID); ok {
			mentions = []model.AgentMentionDO{m}
		}
	}
	if mentions != nil {
		ctx.Mentions = mentions
	}
	return ctx
}

func sshMentionFromHostID(d *Deps, hostID string) (model.AgentMentionDO, bool) {
	hostID = strings.TrimSpace(hostID)
	if hostID == "" || d == nil || d.Store == nil {
		return model.AgentMentionDO{}, false
	}
	h, err := d.Store.GetSSHHost(hostID)
	if err != nil || h == nil {
		return model.AgentMentionDO{Kind: "ssh", ID: hostID, Label: hostID}, true
	}
	label := strings.TrimSpace(h.Name)
	if label == "" {
		label = h.Host
	}
	return model.AgentMentionDO{Kind: "ssh", ID: hostID, Label: label}, true
}

// toolAgentChat 同步发起 Agent 对话（解析 /skill，等待回复；供 MCP 闭环测试）。
func toolAgentChat(ctx context.Context, d *Deps, raw json.RawMessage) ToolResult {
	if d == nil || d.Agent == nil {
		return Fail("Agent 未就绪")
	}
	var in agentChatArgs
	if err := json.Unmarshal(raw, &in); err != nil {
		return Fail("参数无效")
	}
	msg := strings.TrimSpace(in.Message)
	if msg == "" {
		return Fail("message 不能为空")
	}
	mode := strings.TrimSpace(in.Mode)
	if mode == "" {
		mode = "agent"
	}
	req := model.AgentChatRequestDO{
		ThreadID: strings.TrimSpace(in.ThreadID),
		Message:  msg,
		Mode:     mode,
		SkillIDs: in.SkillIDs,
		Context:  agentChatContext(d, in),
	}
	out, err := d.Agent.ChatSync(ctx, req)
	if err != nil {
		return Fail(err.Error())
	}
	return OKData(out)
}

// toolAgentConfirm 同步确认待执行工具并等待续跑（MCP）。
func toolAgentConfirm(ctx context.Context, d *Deps, raw json.RawMessage) ToolResult {
	if d == nil || d.Agent == nil {
		return Fail("Agent 未就绪")
	}
	var in agentConfirmArgs
	if err := json.Unmarshal(raw, &in); err != nil {
		return Fail("参数无效")
	}
	pendingID := strings.TrimSpace(in.PendingID)
	if pendingID == "" {
		return Fail("pendingId 不能为空")
	}
	approved := true
	if in.Approved != nil {
		approved = *in.Approved
	}
	out, err := d.Agent.ConfirmSync(ctx, pendingID, approved)
	if err != nil {
		return Fail(err.Error())
	}
	return OKData(out)
}
