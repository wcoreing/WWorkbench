package harness

import (
	"context"
	"fmt"
	"strings"
	"time"

	"github.com/wcoreing/ningharness/guest"
	"github.com/wcoreing/ningharness/lifecycle"
	"github.com/wcoreing/ningharness/memory"
	"github.com/wcoreing/ningharness/skill"
)

// TurnInput 一轮生命周期入参（多会话）。
type TurnInput struct {
	SessionKey     string
	Prompt         string
	Feedforward    string
	SkipUserAppend bool
	TaskID         string
	// SkillPaths 相对路径列表，写入 RunState 供 Skill.Match → Memory.SkillIDs。
	SkillPaths []string
	// SkillIDs 显式方法包（如 / 调用）；非空时跳过路径 Match。
	SkillIDs []string
	// OnDelta 本轮流式增量（经 guest.WithDeltaHandler 注入，产品勿自管 SSE）。
	OnDelta func(delta string)

	// Think 思考路径：空/guest=本地 Guest；external=外置大脑（须 Runtime.SetExternal+SetTools）。
	Think string
	// External* 仅 think=external 时写入 RunState Values。
	ExternalMode         string
	ExternalAPIKey       string
	ExternalModel        string
	ExternalSystemPrompt string
	ExternalRecentDialog string
}

// RunTurn 经 ningharness 默认生命周期跑一轮（begin→assemble→guest→end）。
func (h *Host) RunTurn(ctx context.Context, in TurnInput) (*lifecycle.RunState, error) {
	if h == nil || h.RT == nil {
		return nil, fmt.Errorf("harness: not open")
	}
	sessionKey := strings.TrimSpace(in.SessionKey)
	if sessionKey == "" {
		return nil, fmt.Errorf("harness: empty sessionKey")
	}
	taskID := strings.TrimSpace(in.TaskID)
	if taskID == "" {
		taskID = fmt.Sprintf("chat:%d", time.Now().UnixMilli())
	}
	if h.RT.Session != nil {
		_ = h.RT.Session.Ensure(h.Root, "", sessionKey, sessionKey)
	}
	if in.OnDelta != nil {
		ctx = guest.WithDeltaHandler(ctx, in.OnDelta)
	}
	st := &lifecycle.RunState{
		Root:           h.Root,
		SessionKey:     sessionKey,
		TaskID:         taskID,
		Prompt:         in.Prompt,
		Feedforward:    in.Feedforward,
		SkipUserAppend: in.SkipUserAppend,
	}
	if ids := trimSkillPaths(in.SkillIDs); len(ids) > 0 {
		st.Set(memory.SkillIDsValueKey, ids)
	} else if paths := trimSkillPaths(in.SkillPaths); len(paths) > 0 {
		st.Set(skill.PathsValueKey, paths)
	}
	think := strings.TrimSpace(in.Think)
	if think == "" {
		think = guest.ThinkGuest
	}
	st.Set(guest.ThinkValueKey, think)
	if think == guest.ThinkExternal {
		if m := strings.TrimSpace(in.ExternalMode); m != "" {
			st.Set(guest.ExternalModeKey, m)
		}
		if k := strings.TrimSpace(in.ExternalAPIKey); k != "" {
			st.Set(guest.ExternalAPIKeyKey, k)
		}
		if m := strings.TrimSpace(in.ExternalModel); m != "" {
			st.Set(guest.ExternalModelKey, m)
		}
		if p := strings.TrimSpace(in.ExternalSystemPrompt); p != "" {
			st.Set(guest.ExternalSystemPromptKey, p)
		}
		if d := strings.TrimSpace(in.ExternalRecentDialog); d != "" {
			st.Set(guest.ExternalRecentDialogKey, d)
		}
	}
	lc := h.RT.Lifecycle
	if lc == nil {
		lc = lifecycle.NewDefault(h.RT)
	}
	ctx = lifecycle.WithRunState(ctx, st)
	if err := (lifecycle.Runner{}).Run(ctx, lc, st); err != nil {
		return st, err
	}
	return st, nil
}

func trimSkillPaths(in []string) []string {
	out := make([]string, 0, len(in))
	for _, p := range in {
		p = strings.TrimSpace(p)
		if p != "" {
			out = append(out, p)
		}
	}
	return out
}
