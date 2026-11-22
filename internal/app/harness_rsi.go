package app

import (
	"strings"

	"WWorkbench/internal/errno"
	"WWorkbench/internal/workbenchtools"
)

// ProposeHarnessPatchArgs 提出 Skill 进化候选。
type ProposeHarnessPatchArgs struct {
	EpisodeID    string `json:"episodeId"`
	SkillPath    string `json:"skillPath"`
	LessonsPatch string `json:"lessonsPatch"`
	Domain       string `json:"domain"`
	Intent       string `json:"intent"`
}

// ProposeHarnessPatch 生成 shadow harness 候选并推进化卡。
func (s *Service) ProposeHarnessPatch(in ProposeHarnessPatchArgs) ApiResult[map[string]interface{}] {
	if s.toolsRegistry == nil {
		return ErrResult[map[string]interface{}](errno.New(errno.CodeInvalidArg, "工具注册表未就绪", ""))
	}
	deps := s.toolsRegistry.Deps()
	return toolResMap(workbenchtools.ProposeHarnessPatch(deps, workbenchtools.ProposeHarnessArgs{
		EpisodeID:    strings.TrimSpace(in.EpisodeID),
		SkillPath:    strings.TrimSpace(in.SkillPath),
		LessonsPatch: strings.TrimSpace(in.LessonsPatch),
		Domain:       strings.TrimSpace(in.Domain),
		Intent:       strings.TrimSpace(in.Intent),
		EmitUI:       true,
	}))
}

// EvalHarnessCandidate 静态评测候选。
func (s *Service) EvalHarnessCandidate(candidateID string) ApiResult[map[string]interface{}] {
	if s.toolsRegistry == nil {
		return ErrResult[map[string]interface{}](errno.New(errno.CodeInvalidArg, "工具注册表未就绪", ""))
	}
	deps := s.toolsRegistry.Deps()
	return toolResMap(workbenchtools.EvalHarnessCandidate(deps, strings.TrimSpace(candidateID)))
}

// PromoteHarnessCandidateArgs 升版参数。
type PromoteHarnessCandidateArgs struct {
	CandidateID string `json:"candidateId"`
	Force       bool   `json:"force"`
	Intent      string `json:"intent"`
}

// PromoteHarnessCandidate 人确认后升版 Skill。
func (s *Service) PromoteHarnessCandidate(in PromoteHarnessCandidateArgs) ApiResult[map[string]interface{}] {
	if s.toolsRegistry == nil {
		return ErrResult[map[string]interface{}](errno.New(errno.CodeInvalidArg, "工具注册表未就绪", ""))
	}
	deps := s.toolsRegistry.Deps()
	return toolResMap(workbenchtools.PromoteHarnessCandidate(
		deps, strings.TrimSpace(in.CandidateID), strings.TrimSpace(in.Intent), in.Force,
	))
}

// DiscardHarnessCandidateArgs 丢弃/冻结。
type DiscardHarnessCandidateArgs struct {
	CandidateID string `json:"candidateId"`
	Freeze      bool   `json:"freeze"`
}

// DiscardHarnessCandidate 丢弃或冻结候选。
func (s *Service) DiscardHarnessCandidate(in DiscardHarnessCandidateArgs) ApiResult[map[string]interface{}] {
	if s.toolsRegistry == nil {
		return ErrResult[map[string]interface{}](errno.New(errno.CodeInvalidArg, "工具注册表未就绪", ""))
	}
	deps := s.toolsRegistry.Deps()
	return toolResMap(workbenchtools.DiscardHarnessCandidate(deps, strings.TrimSpace(in.CandidateID), in.Freeze))
}

// ListHarnessCandidates 列出未升版候选。
func (s *Service) ListHarnessCandidates(skillPath string, limit int) ApiResult[map[string]interface{}] {
	if s.toolsRegistry == nil {
		return ErrResult[map[string]interface{}](errno.New(errno.CodeInvalidArg, "工具注册表未就绪", ""))
	}
	deps := s.toolsRegistry.Deps()
	if deps == nil || deps.Harness == nil {
		return ErrResult[map[string]interface{}](errno.New(errno.CodeInvalidArg, "harness 账本未就绪", ""))
	}
	items := deps.Harness.List(skillPath, limit)
	return OkResult(map[string]interface{}{"ok": true, "candidates": items, "count": len(items)})
}
