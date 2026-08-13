package harness

import (
	"context"
	"fmt"
	"strings"
	"time"

	"github.com/wcoreing/ningharness/guest"
	"github.com/wcoreing/ningharness/lifecycle"
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
	// OnDelta 本轮流式增量（经 guest.WithDeltaHandler 注入，产品勿自管 SSE）。
	OnDelta func(delta string)
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
	if paths := trimSkillPaths(in.SkillPaths); len(paths) > 0 {
		st.Set(skill.PathsValueKey, paths)
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
