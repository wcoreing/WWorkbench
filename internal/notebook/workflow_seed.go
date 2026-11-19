package notebook

import (
	"WWorkbench/internal/model"
)

type builtinWorkflowSeed struct {
	WF     model.WorkflowDO
	Extras WorkflowNoteBodyExtras
}

// BuiltinWorkflows 内置教练工作流（只落笔记本）。
func BuiltinWorkflows() []model.WorkflowDO {
	seeds := builtinWorkflowSeeds()
	out := make([]model.WorkflowDO, 0, len(seeds))
	for _, s := range seeds {
		out = append(out, s.WF)
	}
	return out
}

func builtinWorkflowSeeds() []builtinWorkflowSeed {
	return []builtinWorkflowSeed{
		{
			WF: model.WorkflowDO{
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
		},
		{
			WF: model.WorkflowDO{
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
		},
		{
			WF: model.WorkflowDO{
				Name:  "微信文件传输助手",
				Title: "微信文件传输助手",
				Description: "本机已登录微信 → 经文件传输助手发文字/图片（desktop headed 金路径）。" +
					"无障碍树为空时用截图+相对坐标；发送前 offer_choices；禁止协议机器人与静默群发。",
				Intent:      "发给我 / 发到文件传输助手：沙箱发送，人确认会话与正文",
				SourceRunID: "seed",
				Steps: []model.WorkflowStepDO{
					{Action: "pause", Summary: "desktop_status → desktop_apps 取微信主窗 windowId（最大窗）；禁止 focus_window"},
					{Action: "pause", Summary: "offer_choices：确认会话=文件传输助手、正文或附件路径；人拒绝则停"},
					{Action: "pause", Summary: "⌘F + clipboard_set 搜「文件传输助手」→ 只截微信窗 → 多模态点联系人行（跳过 AI搜索/全部/文章）"},
					{Action: "pause", Summary: "确认标题后：文字用 clipboard_set+cmd+v+return；图片用 clipboard_set(imagePath)+粘贴发送"},
					{Action: "pause", Summary: "desktop_screenshot 验收；成功后可 update_skill 收口经验"},
				},
			},
			Extras: WorkflowNoteBodyExtras{
				Bind: "desktop",
				Lessons: `**金路径（必须遵守）**

1. **通道**：只用 desktop_* headed，禁止 browser_* / 协议扫码机器人。
2. **授权**：首次读取/操作微信走工作台弹窗；被拒后不要重复弹。
3. **窗口**：desktop_apps(app=微信或 WeChat) 取最大 windowId；后续截图与点击都带同一 windowId。
4. **搜会话**：⌘F（或 Ctrl+F）→ clipboard_set(text) → press headed 粘贴；再 **只截微信窗**。
5. **点选**：图上相对坐标 (rx,ry)；跳过 focus_search / chat_history / web / section；只点 contact/group。搜一搜索引行不是会话。
6. **发送**：先 offer_choices；「发给我」默认文件传输助手。发图：clipboard_set(imagePath=绝对路径) → 点输入区 → press cmd+v|ctrl+v headed → return headed。
7. **验收**：再截一张确认气泡出现；delivery 不确定时不要重复连发。
8. **告警**：个人微信群高频告警勿用本 Skill；改 notify_send(channel=wecom_webhook)。本 Skill 仅低频、人确认的沙箱发送。

**常见失败**

- 无障碍树空 → 正常，改 headed + 截图，勿死磕 snapshot ref。
- 点到「AI搜索」→ 重新截图，只点绿色联系人/群行。
- 多窗点错 → 重新 desktop_apps 选最大窗 windowId。
- 非视觉模型 → 请人换成支持视觉的模型后再估坐标。
`,
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
