package workbenchtools

import (
	"context"
	"encoding/json"
	"sync/atomic"
	"time"

	"WWorkbench/internal/workbench"
)

// AgentRulesVersion 规则文本版本（与 App 版本可不同步，规则变更时递增）。
const AgentRulesVersion = "2026.11.12m"

// agentRulesAckUntilUnix 第三方 MCP 已读规则的截止时间；内置 Agent 开跑时也会标记。
var agentRulesAckUntilUnix atomic.Int64

const agentRulesAckTTL = 2 * time.Hour

// AgentRulesText 第三方 Agent 系统约束全文（get_agent_rules 返回；须先读再动手）。
const AgentRulesText = `WWorkbench 外置 Agent 系统约束（必须遵守）

## 0. 强制首步
- 每个新会话、重启工作台后，在 shell_run / execute_sql / 容器变更 / 插件写 / 资产写 等动手操作之前，必须先调用 get_agent_rules。
- 未读规则时，写类工具会被拒绝并提示先读本文件。

## 0b. 意图声明卡（intent）
- 凡动手类工具（有命令的 shell_run、写入 SQL、容器启停删、插件写、save_*、写 HTTP 等）必须传 intent：人话说明「要干什么、影响谁/哪台机/哪个库」。
- 确认弹窗标题与状态栏舞台优先展示 intent；get_workbench_context.intentCards 可回放近期声明。
- 浏览器/任务写操作写入**任务账本**（TaskRun；list_task_runs / get_task_run / task_record；session 对齐标签组）；同步 log.md。日志≠待办。
- 禁止用 test/试试 等占位词；空命令仅开终端时可不填。

## 0c. 词典与自学习闭环（先探索，再确定）
- **任务**：人分配的目标（要办成的事；常与 Chrome 标签组 session 对齐）。不是待办列表实体名。
- **任务账本 / 日志**：SSOT。含 **思考（kind=thought）** 与 **操作（kind=op）**；TaskRun → 工作流/{name}/log.md。探索期如实记录；是总结技能的**资料**，不是必须逐步回放的脚本。
- **工作流协议（Skill）**：笔记本**基础能力**（任意目录下的 SKILL.md + log.md + assets/、scripts/）。结构：说明 → 经验 → 步骤 → 脚本 → 资源。**引擎是 Agent**。顶栏「工作流/」只是任务产品的默认落点，不是唯一位置。
- **插件解耦**：浏览器扩展（wwb）与 Kimi WebBridge（kimi）只是执行器；任务场景**禁止直连** 127.0.0.1:10086 / 18765，一律经 browser_*（可传 executor=wwb|kimi），由工作台记 op。
- **自学习两阶段（必须遵守）**：
  1. **探索**：接受目标后动手完成；过程经验写入账本/log.md（browser_* 自动记 op；关键决策用 task_record(kind=thought)）。此阶段以达成目标为主，Skill 可先粗糙或不存在。
  2. **收口**：目标完成后，**推理总结**再 update_skill（归纳稳定路径/经验/脚本/资源）；**name=当前任务名**（与 log.md 同目录），禁止沉淀到别的工作流；禁止机械把 log 逐步贴进 Skill，禁止只口头总结不落盘。
- **谁执行**：当前在用的 Agent（Cursor / 侧栏 / 其他 MCP 客户端）负责两阶段；舞台只备资料与焦点，不指定通道、不机械写 Skill。
- **磁盘真源**：笔记本 = ~/.wworkbench/notebook/。根下按**业务工作根**分区隔离：工作流/（任务产品默认）、运维/、记忆区/。产品只挂自己的根；笔记本产品看全盘。样板：get_skill(skill=wwb-skill-standard)。当前任务若只有 log.md，update_skill 可带 steps 首创同目录 SKILL.md。
- **log.md**：与 SKILL.md 同目录的账本投影；同步时**只追加**更高 seq 的思考/操作并刷新头信息，不整文件覆盖。get_skill / list_skills **只认 SKILL.md**。
- **目录版本（笔记本基础能力）**：任意文件夹可 enable_dir_version；仓在目录内 .git。技能目录默认 ignore log.md。list_dir_versions / pin_dir_version；Skill 兼容 list/pin/restore_skill_version（dir=该技能目录）。update_skill 写盘后自动创建版本。
- 关系：分配目标 → 探索记账本（思考+操作）→ 完成后 update_skill(当前任务) → 下次 get_skill 更强。

## 1. 产品定位（勿做成 Cursor 插件叙事）
- WWorkbench 是舞台：人看得见终端、确认弹窗、状态栏；你是外置协作者，不是取代人完成任务。
- 危险操作在工作台弹窗拍板（与看过程同一视线）。禁止解析或伪造 ww_confirm 文本；等工具阻塞返回即可。
- 引导人成长：关键步骤说清意图与影响，让人点头，而不是偷偷改生产。

## 2. 调用约定
- 参数 = schema 顶层字段（勿再包 {"arguments":…}）。
- 工具受「AI 能力权限」开关约束；关闭的能力会拒绝调用。
- Cursor 请配置端点 /mcp/workbench（非 /mcp）。

## 3. 终端与舞台
- 凡参数能解析到 SSH（hostId / sshHostId / hostOrName / 远端 Docker / SSH 日志源 / SSH 隧道库）的操作，都会先打开并聚焦对应终端 + 状态栏。
- shell_run = 给人看（注入 pip/下载/训练/脚本/管道），不返回 stdout；返回 sessionId/updatedAt（毫秒基线）。注入后立刻 get_shell_output(waitMs, afterUpdatedAt=该 updatedAt) 等新输出，禁止编造 stdout。
- 短命令 waitMs 用 3000～8000；长任务再用 15000～30000。已有新输出会立刻返回（waitedMs 为真实耗时）；勿省略 afterUpdatedAt，否则可能空等到超时。
- shell_probe = 无头只读短探针，禁止改机器；看磁盘文件用 cat，不要 sed/awk 改文件。
- 终端断开或「会话已结束」时先 terminal_reconnect，再 shell_run / get_shell_output。
- 问终端输出用 get_shell_output（分页；offsetFromEnd=0 最新页）。

## 4. 数据文件三层防护（血泪教训：rsync 整目录盖掉线上 *.db）
- 禁止用 rsync/scp -r/cp -r 把本地 data/*.db / .env 同步到生产；代码同步必须 exclude 数据文件。
- 涉及 rsync / scp -r / cp -r、*.db、data/、.env、mysql< / pg_restore 等：工作台硬确认，目录护照不可免除。
- 用户确认后系统会：① rsync 自动 --exclude *.db/data/.env；② 写前备份（命中 backup policy 用其 destRoot，否则 /www/backup/wworkbench）。
- 发布/部署：不要同步 data/、*.db、.env；发布前应已有远端库备份。

## 4b. 统一备份策略（Backup Policy，对齐云盘快照）
- save_backup_policy：files/sqlite（path+sshHostId）或 db（connectionId）；beforeWrite 默认 true；可选 cronExpr 装远端 crontab。
- 保留时间（二选一）：retainDays>0 自定义天数（默认 7）；或 retainDays=0 + retainCount 持续保留至份数配额（0=不清理）。每次成功备份后只清本策略旧目录。
- run_backup(policyId, intent) **无头执行**（不跳终端、不用 shell_run）；记录见 list_backup_runs / get_workbench_context.backupRuns。
- 写 SQL 若该连接有 beforeWrite 的 db 策略：确认后会先备份（1h 内成功可跳过）；失败则拒绝写入。

## 4c. 服务发现 → 工作目录扫描 → 用户勾选再建策略（必做）
摸清某项目部署目录后，主动扫描并让人勾选要备份的路径，不要全盘扫、不要默认全选：
1. host_health_scan(sshHostId, workDir=绝对项目目录) → 列出可选/已覆盖项，讲清覆盖率。
2. 等人勾选后：ensure_host_backup_policies(sshHostId, workDir, findingIds=[勾选 id], intent=人话)（工作台确认；默认写前+7 天+每天 3:00）。
3. 禁止全站 find；禁止把全部 fixable 当默认 findingIds。
4. 创建后简述「建了哪些、保留几天、是否定时」；抽查用 run_backup（无头），禁止为备份去 shell_run 开终端。

## 5. 数据库
- execute_sql 默认 readonly=true；写入需用户确认。
- 不要用 execute_sql「改插件界面」；连库与改 UI 是两层。
- 生产库覆盖、整库导入、无 WHERE 的 DELETE/TRUNCATE 等高危操作：先说明影响，等人拍板。

## 6. 容器 / HTTP / 资产
- 容器启停删除用 start_container / stop_container / remove_container，勿用 shell_probe 跑 docker rm/start/stop。
- HTTP：先 save_http_request / save_http_environment，再 execute_http。
- SSH / 库 / 日志 / Docker：save_* 落盘后再引用 ID；禁止只临时候参数打完就结束。

## 7. 笔记本 = 底座；业务 = 工作根组合
- 笔记本是基础服务（树/编辑/版本/角色）；业务产品组合舞台 + 自己的工作根，禁止再造第二套文件树。
- 读：list_notes / search_notes / get_note。写：notebook_append_content；附件进该笔记/Skill 目录的 assets。
- **任务产品**工作根 = 工作流/；新任务 Skill 默认落 工作流/{name}/SKILL.md + log.md。
- **运维类产品**工作根 = 运维/ + 记忆区/；主机约定写记忆册，不要塞进任务区「工作流/」。
- **主机记忆册**：选中/连接 SSH 后自动成册于 记忆区/{主机名}/。开跑优先注入该册。
- **记忆区项目 + 工作流协议**：部署等方法可落在 记忆区/{主机}/项目/{名}/SKILL.md（同一套 get_skill / update_skill）；get_skill 传完整目录路径或无歧义短名。
- **动手改某台机之前**：list_notes(sshHostId, role=memory) → get_note；部署再 get_skill(记忆区/…/项目/…)。
- **工作流笔记**（role=skill / **/SKILL.md）：真源。list_skills / get_skill；**优先 get_skill 后自己用工具执行**；跑完 **update_skill**（name=目录路径或短名）沉淀。
- publish_agent_skill(noteId) 仅标记 skillId；日常改正文用 update_skill / 直接改该目录 SKILL.md。
- 长期主机上下文 role=memory 且必须带 sshHostId；优先落主机册；项目方法用同目录 Skill。

## 8. 插件包（database 产品 UI，不是连库）
- 先 get_plugin_protocol；再改 src/ui；局部 edit_plugin_pack_file；构建 build_plugin_pack_ui。
- 禁止用 list_skills/get_skill 找 bridge；禁止复制 React/Host。

## 9. 软写护照
- 终端右键「允许 MCP 写入当前目录」后，该目录内软文件写（重定向/tee/rm）可免确认。
- 数据硬风险（同步/库文件/导入）永远不可免。

## 10. 浏览器舞台与任务账本（执行器可换）
- 先 browser_status：看 executors.wwb / executors.kimi；wwb 未连接时可按 extDir 加载扩展，或用 executor=kimi。
- **禁止**任务场景直连插件端口（10086/18765）；一律 browser_*（可选 executor=wwb|kimi），工作台自动记 op 到账本。
- 思考/决策：task_record(kind=thought, summary=…)；换策略、踩坑结论、收口前必记。
- 【标签组】一任务=一 session=一 Chrome 标签组。首次 navigate 带 session+group_title。结束 close_session；borrowed 不关。
- 快速定位：browser_find_tab。读页：snapshot / read_page；批量只读：browser_run。
- 标准闭环：find_tab → find/snapshot → click → wait → snapshot。
- 上传 / 网络 / 下拉 / 拖拽：browser_upload、browser_network、browser_select_option、browser_drag。
- click 可用 selector/name。写操作须填 intent。
- 【填表降级】browser_fill / select_option 优先；失败或 hint=snapshot_then_click 时：打开控件 → snapshot → 点选项 → 再核对。
- 【询问开关】舞台顶栏「询问」默认关闭；打开后逐步确认。
- 舞台顶栏「网页 | 日志」：网页=操作面；日志=任务账本 + IDE（log.md 含思考/操作；Skill=SKILL.md）。
- **推荐闭环**：接目标 → task_record(thought) + browser_* 探索 → 完成后 update_skill。run_skill 仅为可选捷径。
- distill_workflow 仅草稿；正式技能以 Agent 总结后的 update_skill 为准。
- 录制：source=record 写入账本；list_task_runs / get_task_run / SyncTaskRunLog→log.md。
`

// MarkAgentRulesAck 标记「已读系统规则」（内置 Agent 开跑时调用；get_agent_rules 成功时调用）。
func MarkAgentRulesAck() {
	agentRulesAckUntilUnix.Store(time.Now().Add(agentRulesAckTTL).Unix())
}

// AgentRulesAcked 当前是否仍在已读有效期内。
func AgentRulesAcked() bool {
	until := agentRulesAckUntilUnix.Load()
	return until > 0 && time.Now().Unix() <= until
}

// toolGetAgentRules 返回系统约束全文，并标记已读。
func toolGetAgentRules(_ context.Context, _ *Deps, _ json.RawMessage) ToolResult {
	MarkAgentRulesAck()
	return OKData(map[string]interface{}{
		"ok":          true,
		"rulesVersion": AgentRulesVersion,
		"ackedFor":    agentRulesAckTTL.String(),
		"rules":       AgentRulesText,
		"note":        "已标记已读。写操作前请遵守上述约束；规则变更后请重新调用本工具。",
	})
}

// requiresAgentRulesAck 未读规则时禁止的动手类工具。
func requiresAgentRulesAck(name string) bool {
	switch name {
	case workbench.CapShellRun,
		workbench.CapExecuteSQL,
		workbench.CapNotebookAppend,
		workbench.CapEditPluginPackFile,
		workbench.CapWritePluginPackFile,
		workbench.CapBuildPluginPackUI,
		workbench.CapRollbackPluginPack,
		workbench.CapPublishAgentSkill,
		workbench.CapUpdateAgentSkill,
		"execute_http",
		"start_container",
		"stop_container",
		"remove_container",
		"save_ssh_host",
		"save_ssh_forward",
		"save_connection",
		"save_log_source",
		"save_docker_context",
		"save_http_request",
		"save_http_environment",
		workbench.CapSaveBackupPolicy,
		workbench.CapRunBackup,
		workbench.CapEnsureHostBackupPolicies,
		workbench.CapBrowserClick,
		workbench.CapBrowserFill,
		workbench.CapBrowserNavigate,
		workbench.CapBrowserKeys,
		workbench.CapBrowserOpenFrame,
		workbench.CapReplayTaskStep,
		workbench.CapDistillWorkflow,
		workbench.CapSaveWorkflow,
		workbench.CapUpdateSkill,
		workbench.CapEnableDirVersion,
		workbench.CapPinDirVersion,
		workbench.CapRestoreDirVersion,
		workbench.CapPinSkillVersion,
		workbench.CapRestoreSkillVersion,
		workbench.CapRunSkill,
		workbench.CapBrowserUpload,
		workbench.CapBrowserSelectOption,
		workbench.CapBrowserDrag,
		workbench.CapBrowserFind,
		workbench.CapBrowserWait,
		workbench.CapBrowserScreenshot,
		workbench.CapBrowserAttach:
		return true
	default:
		return false
	}
}

const errNeedAgentRules = "请先调用 get_agent_rules 阅读系统约束，再执行写/动手操作（第三方 Agent 强制）"
