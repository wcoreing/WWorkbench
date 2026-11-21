package app

import (
	"strings"

	"WWorkbench/internal/errno"
	"WWorkbench/internal/workbenchtools"
)

// CloseLearningEpisodeArgs 人审收口参数。
type CloseLearningEpisodeArgs struct {
	EpisodeID   string   `json:"episodeId"`
	SelectedIDs []string `json:"selectedIds"`
	Skip        bool     `json:"skip"`
	Intent      string   `json:"intent"`
}

// CloseLearningEpisode 成长卡确认后收口（写 Skill + 关 Episode）。
func (s *Service) CloseLearningEpisode(in CloseLearningEpisodeArgs) ApiResult[map[string]interface{}] {
	if s.toolsRegistry == nil {
		return ErrResult[map[string]interface{}](errno.New(errno.CodeInvalidArg, "工具注册表未就绪", ""))
	}
	if strings.TrimSpace(in.EpisodeID) == "" {
		return ErrResult[map[string]interface{}](errno.New(errno.CodeInvalidArg, "episodeId 不能为空", ""))
	}
	deps := s.toolsRegistry.Deps()
	return toolResMap(workbenchtools.CloseLearningEpisode(deps, in.EpisodeID, in.SelectedIDs, in.Skip))
}

// OfferLearningEpisodeClose 主动弹出成长卡（设置/舞台按钮）。
func (s *Service) OfferLearningEpisodeClose(episodeID string, force bool) ApiResult[map[string]interface{}] {
	if s.toolsRegistry == nil {
		return ErrResult[map[string]interface{}](errno.New(errno.CodeInvalidArg, "工具注册表未就绪", ""))
	}
	deps := s.toolsRegistry.Deps()
	ep, ok := workbenchtools.OfferEpisodeClose(deps, strings.TrimSpace(episodeID), force)
	if !ok {
		return OkResult(map[string]interface{}{
			"ok":      true,
			"offered": false,
			"note":    "无可沉淀条目或近期已弹过",
		})
	}
	return OkResult(map[string]interface{}{
		"ok":           true,
		"offered":      true,
		"episodeId":    ep.ID,
		"pendingCount": len(ep.PendingLessons),
	})
}
