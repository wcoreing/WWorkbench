package workbenchtools

import (
	"WWorkbench/internal/workbench"
)

func registerBrowserTools(r *Registry) {
	r.add(ToolDef{
		Name:        workbench.CapBrowserStatus,
		Description: "浏览器/执行器状态：executors.wwb / executors.kimi、扩展目录。动手前先调；任务操作走 browser_*，勿直连端口。",
		Parameters:  map[string]interface{}{"type": "object", "properties": map[string]interface{}{}},
		Handler:     toolBrowserStatus,
	})
	r.add(ToolDef{
		Name:        workbench.CapBrowserListTabs,
		Description: "列出 Chromium 中可操作的标签（排除 chrome://）。返回 tabId/url/title/active。",
		Parameters:  map[string]interface{}{"type": "object", "properties": map[string]interface{}{}},
		Handler:     toolBrowserListTabs,
	})
	r.add(ToolDef{
		Name:        workbench.CapBrowserAttach,
		Description: "附着指定 tabId，后续 snapshot/click/fill 作用于此标签（保留用户登录态）。",
		Parameters: map[string]interface{}{
			"type": "object",
			"properties": map[string]interface{}{
				"tabId":  map[string]interface{}{"type": "integer", "description": "来自 browser_list_tabs"},
				"intent": intentProp(),
			},
			"required": []string{"tabId"},
		},
		Handler: toolBrowserAttach,
	})
	r.add(ToolDef{
		Name:        workbench.CapBrowserFindTab,
		Description: "按 url/host/标题定位并附着；active=true 附着当前标签。可带 session（借用记账，不关用户组）。",
		Parameters: map[string]interface{}{
			"type": "object",
			"properties": map[string]interface{}{
				"url":     map[string]interface{}{"type": "string", "description": "URL/host 子串，如 xiaohongshu.com"},
				"query":   map[string]interface{}{"type": "string", "description": "同 url，标题也可匹配"},
				"active":  map[string]interface{}{"type": "boolean", "description": "附着用户正在看的标签"},
				"session": map[string]interface{}{"type": "string", "description": "任务名，借用标签记入会话但不关"},
			},
		},
		Handler: toolBrowserFindTab,
	})
	r.add(ToolDef{
		Name:        workbench.CapBrowserSnapshot,
		Description: "可交互元素树（含 open Shadow DOM；select 带 options）。默认 format=aria；json 返回 nodes。禁止编造 ref。",
		Parameters: map[string]interface{}{
			"type": "object",
			"properties": map[string]interface{}{
				"format":   map[string]interface{}{"type": "string", "description": "aria|json，默认 aria"},
				"maxNodes": map[string]interface{}{"type": "integer", "description": "最多节点数，aria 默认 80 / json 120"},
				"maxChars": map[string]interface{}{"type": "integer", "description": "aria 文本上限，默认 12000"},
				"frame":    map[string]interface{}{"type": "string", "description": "#f0 或 #f1…，默认主文档"},
			},
		},
		Handler: toolBrowserSnapshot,
	})
	r.add(ToolDef{
		Name:        workbench.CapBrowserRun,
		Description: "一批只读步骤一次往返：steps=[{action,args}]，允许 snapshot/find/wait/status/list_tabs/find_tab/evaluate/probe。写操作请单独 click/fill。",
		Parameters: map[string]interface{}{
			"type": "object",
			"properties": map[string]interface{}{
				"steps":   map[string]interface{}{"type": "array", "description": "[{action,args}]，最多 12"},
				"session": map[string]interface{}{"type": "string", "description": "任务名，可选"},
			},
			"required": []string{"steps"},
		},
		Handler: toolBrowserRun,
	})
	r.add(ToolDef{
		Name:        workbench.CapBrowserEvaluate,
		Description: "页内执行 JS（只读提取/属性）。code 建议 (()=>{...})()。勿用于登录绕过。",
		Parameters: map[string]interface{}{
			"type": "object",
			"properties": map[string]interface{}{
				"code":  map[string]interface{}{"type": "string"},
				"frame": map[string]interface{}{"type": "string"},
			},
			"required": []string{"code"},
		},
		Handler: toolBrowserEvaluate,
	})
	r.add(ToolDef{
		Name:        workbench.CapBrowserReadPage,
		Description: "读取页面正文（分页）。返回 text/complete/nextStart；未读完用 start=nextStart 继续。可 frame。",
		Parameters: map[string]interface{}{
			"type": "object",
			"properties": map[string]interface{}{
				"maxChars": map[string]interface{}{"type": "integer", "description": "本段最多字符，默认 8000，最大 60000"},
				"start":    map[string]interface{}{"type": "integer", "description": "起始偏移，续读时用上次 nextStart"},
				"frame":    map[string]interface{}{"type": "string"},
			},
		},
		Handler: toolBrowserReadPage,
	})
	r.add(ToolDef{
		Name:        workbench.CapBrowserUpload,
		Description: "向 input[type=file] 设置本机文件（CDP）。files 为绝对路径数组；可 ref/selector。须 intent；舞台「询问」开时才逐步确认。",
		Parameters: map[string]interface{}{
			"type": "object",
			"properties": map[string]interface{}{
				"files":    map[string]interface{}{"type": "array", "items": map[string]interface{}{"type": "string"}, "description": "本机绝对路径"},
				"ref":      map[string]interface{}{"type": "string"},
				"selector": map[string]interface{}{"type": "string"},
				"frame":    map[string]interface{}{"type": "string"},
				"intent":   intentProp(),
			},
			"required": []string{"files", "intent"},
		},
		Handler: toolBrowserUpload,
	})
	r.add(ToolDef{
		Name:        workbench.CapBrowserNetwork,
		Description: "标签网络捕获。cmd=start|list|detail|stop；list 可 filter；detail 需 requestId（先 list）。调试登录/接口失败用。",
		Parameters: map[string]interface{}{
			"type": "object",
			"properties": map[string]interface{}{
				"cmd":       map[string]interface{}{"type": "string", "description": "start|list|detail|stop"},
				"filter":    map[string]interface{}{"type": "string", "description": "URL 子串过滤（list）"},
				"requestId": map[string]interface{}{"type": "string", "description": "detail 用"},
				"limit":     map[string]interface{}{"type": "integer", "description": "list 条数，默认 80"},
			},
			"required": []string{"cmd"},
		},
		Handler: toolBrowserNetwork,
	})
	r.add(ToolDef{
		Name:        workbench.CapBrowserSelectOption,
		Description: "选下拉项：原生 select 或 Ant/Element 自定义下拉。提供触发器 ref + value（选项文案）。" +
			"失败可 snapshot 后点 option。须 intent；「询问」开时确认。",
		Parameters: map[string]interface{}{
			"type": "object",
			"properties": map[string]interface{}{
				"ref":      map[string]interface{}{"type": "string"},
				"selector": map[string]interface{}{"type": "string"},
				"value":    map[string]interface{}{"type": "string", "description": "选项文案或 value"},
				"option":   map[string]interface{}{"type": "string"},
				"frame":    map[string]interface{}{"type": "string"},
				"intent":   intentProp(),
			},
			"required": []string{"intent"},
		},
		Handler: toolBrowserSelectOption,
	})
	r.add(ToolDef{
		Name:        workbench.CapBrowserDrag,
		Description: "真指针拖拽：fromRef→toRef（或 selector/坐标）。看板排序、拖放上传等。须 intent；「询问」开时确认。",
		Parameters: map[string]interface{}{
			"type": "object",
			"properties": map[string]interface{}{
				"fromRef":      map[string]interface{}{"type": "string"},
				"toRef":        map[string]interface{}{"type": "string"},
				"fromSelector": map[string]interface{}{"type": "string"},
				"toSelector":   map[string]interface{}{"type": "string"},
				"fromX":        map[string]interface{}{"type": "number"},
				"fromY":        map[string]interface{}{"type": "number"},
				"toX":          map[string]interface{}{"type": "number"},
				"toY":          map[string]interface{}{"type": "number"},
				"steps":        map[string]interface{}{"type": "integer"},
				"frame":        map[string]interface{}{"type": "string"},
				"intent":       intentProp(),
			},
			"required": []string{"intent"},
		},
		Handler: toolBrowserDrag,
	})
	r.add(ToolDef{
		Name:        workbench.CapBrowserFind,
		Description: "在指定 frame 快照中按文案/角色/ref 子串查找节点（返回 matches）。",
		Parameters: map[string]interface{}{
			"type": "object",
			"properties": map[string]interface{}{
				"query":    map[string]interface{}{"type": "string", "description": "子串，如 新增方案 / 保存"},
				"maxNodes": map[string]interface{}{"type": "integer"},
				"frame":    map[string]interface{}{"type": "string"},
			},
			"required": []string{"query"},
		},
		Handler: toolBrowserFind,
	})
	r.add(ToolDef{
		Name:        workbench.CapBrowserWait,
		Description: "等待条件：text、textGone、nameIncludes、ref、selector、readyState。点击后先 wait 再 snapshot。",
		Parameters: map[string]interface{}{
			"type": "object",
			"properties": map[string]interface{}{
				"text":         map[string]interface{}{"type": "string", "description": "正文包含该文案"},
				"textGone":     map[string]interface{}{"type": "string", "description": "正文不再包含"},
				"nameIncludes": map[string]interface{}{"type": "string", "description": "可交互节点 name 子串"},
				"ref":          map[string]interface{}{"type": "string"},
				"selector":     map[string]interface{}{"type": "string"},
				"readyState":   map[string]interface{}{"type": "boolean", "description": "true=等待 document.readyState=complete"},
				"frame":        map[string]interface{}{"type": "string"},
				"timeoutMs":    map[string]interface{}{"type": "integer", "description": "默认 8000，最大 40000"},
			},
		},
		Handler: toolBrowserWait,
	})
	r.add(ToolDef{
		Name:        workbench.CapBrowserClick,
		Description: "点击（ref/selector）。auto：真指针；失败可 CDP 穿 closed shadow（selector 或 name）。须 intent；「询问」开时确认。",
		Parameters: map[string]interface{}{
			"type": "object",
			"properties": map[string]interface{}{
				"ref":      map[string]interface{}{"type": "string", "description": "快照中的 @eN"},
				"selector": map[string]interface{}{"type": "string", "description": "CSS；失败时 CDP performSearch 含 shadow"},
				"name":     map[string]interface{}{"type": "string", "description": "无障碍名称，CDP AX 兜底"},
				"mode":     map[string]interface{}{"type": "string", "description": "auto|pointer|dom，默认 auto"},
				"frame":    map[string]interface{}{"type": "string"},
				"executor": executorProp(),
				"intent":   intentProp(),
			},
			"required": []string{"intent"},
		},
		Handler: toolBrowserClick,
	})
	r.add(ToolDef{
		Name:        workbench.CapBrowserKeys,
		Description: "发送按键到焦点或指定 ref（Enter/Escape/Tab/Mod+A 等）。可提交表单。须 intent；「询问」开时确认。长文本请用 browser_fill。",
		Parameters: map[string]interface{}{
			"type": "object",
			"properties": map[string]interface{}{
				"keys":     map[string]interface{}{"type": "string", "description": "Enter | Escape | Tab | Mod+A | ArrowDown …"},
				"ref":      map[string]interface{}{"type": "string"},
				"selector": map[string]interface{}{"type": "string"},
				"frame":    map[string]interface{}{"type": "string"},
				"repeat":   map[string]interface{}{"type": "integer", "description": "重复次数，默认 1"},
				"intent":   intentProp(),
			},
			"required": []string{"keys", "intent"},
		},
		Handler: toolBrowserKeys,
	})
	r.add(ToolDef{
		Name:        workbench.CapBrowserScreenshot,
		Description: "截取当前附着标签可视区域，保存到本机并返回 path（jpeg 默认）。用于核对弹层/表单是否出现。",
		Parameters: map[string]interface{}{
			"type": "object",
			"properties": map[string]interface{}{
				"format":  map[string]interface{}{"type": "string", "description": "jpeg|png，默认 jpeg"},
				"quality": map[string]interface{}{"type": "integer", "description": "jpeg 质量 40–100，默认 72"},
			},
		},
		Handler: toolBrowserScreenshot,
	})
	r.add(ToolDef{
		Name:        workbench.CapBrowserFill,
		Description: "填值：input/textarea/contenteditable；日期 YYYY-MM-DD 自动开面板翻月点日；自定义下拉改道 select_option。" +
			"失败时看 hint=snapshot_then_click：snapshot 浮层后点 gridcell/option。须 intent；「询问」开时确认。",
		Parameters: map[string]interface{}{
			"type": "object",
			"properties": map[string]interface{}{
				"ref":      map[string]interface{}{"type": "string"},
				"selector": map[string]interface{}{"type": "string"},
				"value":    map[string]interface{}{"type": "string"},
				"frame":    map[string]interface{}{"type": "string"},
				"executor": executorProp(),
				"intent":   intentProp(),
			},
			"required": []string{"value", "intent"},
		},
		Handler: toolBrowserFill,
	})
	r.add(ToolDef{
		Name:        workbench.CapBrowserNavigate,
		Description: "导航到 URL。传 session+group_title 会归入 Chrome 标签组（Kimi 风格：一任务一组）。newTab 同组追加。须 intent；「询问」开时确认。",
		Parameters: map[string]interface{}{
			"type": "object",
			"properties": map[string]interface{}{
				"url":         map[string]interface{}{"type": "string"},
				"newTab":      map[string]interface{}{"type": "boolean"},
				"session":     map[string]interface{}{"type": "string", "description": "任务名，全程固定，如 xhs-publish"},
				"group_title": map[string]interface{}{"type": "string", "description": "标签组显示名（用户语言），建议首次 navigate 设置"},
				"executor":    executorProp(),
				"intent":      intentProp(),
			},
			"required": []string{"url", "intent"},
		},
		Handler: toolBrowserNavigate,
	})
	r.add(ToolDef{
		Name:        workbench.CapBrowserCloseSession,
		Description: "关闭某 session 标签组里 Agent 打开的标签；borrowed 用户标签保留。任务完成再调。",
		Parameters: map[string]interface{}{
			"type": "object",
			"properties": map[string]interface{}{
				"session": map[string]interface{}{"type": "string", "description": "任务名"},
			},
			"required": []string{"session"},
		},
		Handler: toolBrowserCloseSession,
	})
	r.add(ToolDef{
		Name:        workbench.CapBrowserGroupSession,
		Description: "把已打开标签收进 Chrome 彩色标签组（补救未带 session 打开的页）。urlIncludes 或 tabIds。",
		Parameters: map[string]interface{}{
			"type": "object",
			"properties": map[string]interface{}{
				"session":     map[string]interface{}{"type": "string", "description": "任务名，如 xhs-hot"},
				"group_title": map[string]interface{}{"type": "string", "description": "标签栏显示名，如 小红书爆款"},
				"urlIncludes": map[string]interface{}{"type": "string", "description": "URL 子串，如 xiaohongshu.com"},
				"tabIds":      map[string]interface{}{"type": "array", "items": map[string]interface{}{"type": "integer"}},
			},
		},
		Handler: toolBrowserGroupSession,
	})
	r.add(ToolDef{
		Name:        workbench.CapBrowserOpenFrame,
		Description: "跨域 iframe：按 frame=#fN 新开标签并附着；同域则提示直接用 frame 参数。须 intent；「询问」开时确认。",
		Parameters: map[string]interface{}{
			"type": "object",
			"properties": map[string]interface{}{
				"frame":       map[string]interface{}{"type": "string", "description": "#f1 …"},
				"forceNewTab": map[string]interface{}{"type": "boolean", "description": "同域也强制新开"},
				"intent":      intentProp(),
			},
			"required": []string{"frame", "intent"},
		},
		Handler: toolBrowserOpenFrame,
	})
	r.add(ToolDef{
		Name:        workbench.CapBrowserOpen,
		Description: "切换到浏览器舞台产品线（人看得见连接状态与最近动作）。",
		Parameters:  map[string]interface{}{"type": "object", "properties": map[string]interface{}{}},
		Handler:     toolBrowserOpen,
	})
	r.add(ToolDef{
		Name:        workbench.CapListTaskRuns,
		Description: "列出近期任务账本（session）。可按 session 过滤。含思考+操作；复盘/更新技能用。",
		Parameters: map[string]interface{}{
			"type": "object",
			"properties": map[string]interface{}{
				"session": map[string]interface{}{"type": "string", "description": "任务名，空=全部"},
				"limit":   map[string]interface{}{"type": "integer", "description": "默认 30"},
			},
		},
		Handler: toolListTaskRuns,
	})
	r.add(ToolDef{
		Name:        workbench.CapGetTaskRun,
		Description: "获取一次任务详情（含步骤时间线 kind/provider）。runId 来自 list_task_runs 或写操作返回的 taskRunId。",
		Parameters: map[string]interface{}{
			"type": "object",
			"properties": map[string]interface{}{
				"runId": map[string]interface{}{"type": "string"},
			},
			"required": []string{"runId"},
		},
		Handler: toolGetTaskRun,
	})
	r.add(ToolDef{
		Name: workbench.CapTaskRecord,
		Description: "写入任务账本（与浏览器插件解耦）。kind=thought 记 Agent 思考/决策；kind=op 记操作。" +
			"关键换策略/收口前须记 thought。自动同步 log.md。",
		Parameters: map[string]interface{}{
			"type": "object",
			"properties": map[string]interface{}{
				"session":  map[string]interface{}{"type": "string", "description": "任务 session；空=当前活跃"},
				"kind":     map[string]interface{}{"type": "string", "description": "thought|op，默认 thought"},
				"summary":  map[string]interface{}{"type": "string", "description": "人话摘要（必填其一）"},
				"intent":   map[string]interface{}{"type": "string"},
				"action":   map[string]interface{}{"type": "string"},
				"tool":     map[string]interface{}{"type": "string"},
				"provider": map[string]interface{}{"type": "string", "description": "agent|mcp|wwb|kimi|ui|record"},
				"title":    map[string]interface{}{"type": "string", "description": "开新 run 时标题"},
				"ok":       map[string]interface{}{"type": "boolean"},
				"error":    map[string]interface{}{"type": "string"},
			},
		},
		Handler: toolTaskRecord,
	})
	r.add(ToolDef{
		Name: workbench.CapReplayTaskStep,
		Description: "教练式重放任务一步：按 locator（selector→name→ref）重新定位后执行。" +
			"seq 省略则取第一个可重放写步；skip=true 跳过。须 intent；「询问」开时确认。返回 nextSeq。",
		Parameters: map[string]interface{}{
			"type": "object",
			"properties": map[string]interface{}{
				"runId":  map[string]interface{}{"type": "string", "description": "源任务 id"},
				"seq":    map[string]interface{}{"type": "integer", "description": "步骤序号；0/省略=第一个可重放步"},
				"skip":   map[string]interface{}{"type": "boolean", "description": "跳过本步"},
				"intent": intentProp(),
			},
			"required": []string{"runId", "intent"},
		},
		Handler: toolReplayTaskStep,
	})
	r.add(ToolDef{
		Name: workbench.CapDistillWorkflow,
		Description: "从日志蒸馏工作流笔记草稿（role=skill：说明/步骤提示/脚本/资源；含 wwb-skill-steps）。" +
			"日志只是参考：只保留成功写步，之后应编辑优化（合并 fill、删噪声、加 pause），不必忠实回放。" +
			"需确认+intent。之后 get_skill 让 Agent 执行；run_skill 仅为可选机械捷径。",
		Parameters: map[string]interface{}{
			"type": "object",
			"properties": map[string]interface{}{
				"runId":       map[string]interface{}{"type": "string"},
				"name":        map[string]interface{}{"type": "string", "description": "短名 a-z 开头，如 xhs-draft"},
				"title":       map[string]interface{}{"type": "string"},
				"description": map[string]interface{}{"type": "string"},
				"dropSeqs":    map[string]interface{}{"type": "array", "items": map[string]interface{}{"type": "integer"}},
				"intent":      intentProp(),
			},
			"required": []string{"runId", "intent"},
		},
		Handler: toolDistillWorkflow,
	})
	r.add(ToolDef{
		Name:        workbench.CapListWorkflows,
		Description: "列出工作流/Skill 笔记（Agent 前置提示标准包）+ 内置 cms_new_article。",
		Parameters: map[string]interface{}{
			"type": "object",
			"properties": map[string]interface{}{
				"limit": map[string]interface{}{"type": "integer"},
			},
		},
		Handler: toolListWorkflows,
	})
	r.add(ToolDef{
		Name:        workbench.CapGetWorkflow,
		Description: "读取工作流笔记（含 noteId/steps）。name 或 工作流/{name}/SKILL.md。",
		Parameters: map[string]interface{}{
			"type": "object",
			"properties": map[string]interface{}{
				"name": map[string]interface{}{"type": "string"},
				"id":   map[string]interface{}{"type": "string"},
			},
		},
		Handler: toolGetWorkflow,
	})
	r.add(ToolDef{
		Name:        workbench.CapSaveWorkflow,
		Description: "覆盖保存工作流笔记步骤（可优化路径，不必等同原日志）。需确认+intent；也可 get_note 改 wwb-skill-steps。",
		Parameters: map[string]interface{}{
			"type": "object",
			"properties": map[string]interface{}{
				"name":        map[string]interface{}{"type": "string"},
				"title":       map[string]interface{}{"type": "string"},
				"description": map[string]interface{}{"type": "string"},
				"steps":       map[string]interface{}{"type": "array", "description": "[{action,summary,locator,args}]"},
				"sourceRunId": map[string]interface{}{"type": "string"},
				"intent":      intentProp(),
			},
			"required": []string{"name", "steps", "intent"},
		},
		Handler: toolSaveWorkflow,
	})
	r.add(ToolDef{
		Name: workbench.CapUpdateSkill,
		Description: "自我更新 Skill：依据当前任务 log.md 归纳后，把经验/步骤/脚本/资源写回同目录 SKILL.md（SSOT）。" +
			"name=当前任务名（与 log 同目录）；禁止沉淀到别的工作流；禁止机械贴 log。主路径 get_skill→执行→update_skill。需确认+intent。",
		Parameters: map[string]interface{}{
			"type": "object",
			"properties": map[string]interface{}{
				"name":          map[string]interface{}{"type": "string", "description": "当前任务名=工作流目录名（与 log.md 同目录），如 小红书爆款·少即是多"},
				"lessons":       map[string]interface{}{"type": "string", "description": "追加到 ## 经验（人话：这次学到什么）"},
				"script":        map[string]interface{}{"type": "string", "description": "追加到 ## 脚本（可纯文本，自动包 fence）"},
				"scriptLang":    map[string]interface{}{"type": "string", "description": "脚本语言，默认 bash"},
				"resourcePaths": map[string]interface{}{"type": "array", "items": map[string]interface{}{"type": "string"}, "description": "本机绝对路径，挂到笔记资源"},
				"steps":         map[string]interface{}{"type": "array", "description": "优化后的步骤；传入则覆盖 wwb-skill-steps"},
				"replaceSteps":  map[string]interface{}{"type": "boolean", "description": "是否覆盖步骤；默认有 steps 即覆盖"},
				"title":         map[string]interface{}{"type": "string"},
				"description":   map[string]interface{}{"type": "string", "description": "更新导语说明"},
				"sourceRunId":   map[string]interface{}{"type": "string"},
				"intent":        intentProp(),
			},
			"required": []string{"name", "intent"},
		},
		Handler: toolUpdateSkill,
	})
	runSkillParams := map[string]interface{}{
		"type": "object",
		"properties": map[string]interface{}{
			"name":    map[string]interface{}{"type": "string"},
			"session": map[string]interface{}{"type": "string", "description": "任务名/标签组，可选"},
			"title":   map[string]interface{}{"type": "string", "description": "仅 cms_new_article 填标题"},
			"frame":   map[string]interface{}{"type": "string"},
			"intent":  intentProp(),
		},
		"required": []string{"name", "intent"},
	}
	r.add(ToolDef{
		Name:        workbench.CapRunSkill,
		Description: "可选：机械逐步跑工作流笔记里的浏览器步骤（失败即停）。主路径是 get_skill 后由 Agent 自己用工具完成。" +
			"name=cms_new_article 走内置。须 intent；「询问」开时确认。",
		Parameters:  runSkillParams,
		Handler:     toolRunWorkflow,
	})
}
