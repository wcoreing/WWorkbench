package notebook

import (
	"WWorkbench/internal/model"
)

// BuiltinWorkflows 内置教练工作流（只落笔记本）。
func BuiltinWorkflows() []model.WorkflowDO {
	return []model.WorkflowDO{
		{
			Name:        "wwb-skill-standard",
			Title:       "Skill 标准样板",
			Description: "WWorkbench Skill 正文标准：说明/经验/步骤/脚本/资源；资源统一挂本笔记附件目录。",
			Intent:      "给人对齐 Skill 结构与资源管理约定",
			SourceRunID: "seed",
			Steps: []model.WorkflowStepDO{
				{
					Action:  "navigate",
					Summary: "打开工作台文档占位页（可改）",
					Locator: map[string]interface{}{"url": "https://www.xiaohongshu.com/explore"},
					Args: map[string]interface{}{
						"newTab": true, "session": "skill-standard", "group_title": "Skill标准",
					},
				},
				{
					Action:  "pause",
					Summary: "对照本笔记各段结构；需要真实业务时复制本笔记再改 name/步骤",
				},
			},
		},
		{
			Name:        "xhs-hot-browse",
			Title:       "小红书逛热门",
			Description: "打开探索流后暂停，请人点感兴趣的笔记；需要自动点时再编辑加 click（用 name 子串）。",
			Intent:      "逛小红书热门探索流（教练式，不自动乱点）",
			SourceRunID: "seed",
			Steps: []model.WorkflowStepDO{
				{
					Action:  "navigate",
					Summary: "打开小红书探索",
					Locator: map[string]interface{}{"url": "https://www.xiaohongshu.com/explore"},
					Args: map[string]interface{}{
						"newTab": true, "session": "xhs-hot", "group_title": "小红书爆款",
					},
				},
				{
					Action:  "pause",
					Summary: "请在探索流点开一条感兴趣的笔记，再继续蒸馏或手工操作",
				},
			},
		},
	}
}

// EnsureBuiltinWorkflows 幂等写入内置工作流笔记（直接写盘，避免 Ensure 递归）。
func (s *Service) EnsureBuiltinWorkflows() error {
	if err := s.EnsureSkillGroup(); err != nil {
		return err
	}
	return s.seedBuiltinWorkflowsFS()
}
