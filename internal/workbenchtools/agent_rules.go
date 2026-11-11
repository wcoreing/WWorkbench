package workbenchtools

import (
	"context"
	"encoding/json"
	"sync/atomic"
	"time"

	"WWorkbench/internal/workbench"
)

// AgentRulesVersion 规则文本版本（与 App 版本可不同步，规则变更时递增）。
const AgentRulesVersion = "2026.04.28"

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
- 浏览器写操作写入**日志**（API：TaskRun / list_task_runs / get_task_run；session 对齐标签组）；get_workbench_context.taskRuns 含近期摘要。日志≠待办。
- 禁止用 test/试试 等占位词；空命令仅开终端时可不填。

## 0c. 词典（任务 / 日志 / 工作流）
- **任务**：人要办成的事（目标与焦点；常与 Chrome 标签组 session 对齐）。不是待办列表实体名。
- **日志**：这次实际发生的步骤痕迹（TaskRun）。界面「网页 | 日志」左侧列表即此；「录制」只是写入日志的动作。日志是生成/优化工作流的**参考**，不是必须逐步回放的脚本。
- **工作流**：给 Agent 用的 Skill / 前置上下文（标准笔记 role=skill；非画布）。结构固定：说明 → 经验 → 步骤(wwb-skill-steps) → **脚本** → **资源**。**引擎是 Agent**；步骤可优化。run_skill / replay 只是可选捷径。
- **磁盘真源**：笔记本 = ~/.wworkbench/notebook/（像 IDE，侧栏如实显示目录名/文件名，不做 id 映射）。工作流 Skill = 工作流/{name}/SKILL.md + 同级 assets/、scripts/；普通笔记 = 目录下 .md。
- **资源统一**：脚本在「## 脚本」或 scripts/；附件只进该 Skill 的 assets/，「## 资源」用 kind · 说明 · 链接 登记。样板：get_skill(skill=wwb-skill-standard)。
- **自我更新**：跑通或踩坑后必须 update_skill 写回 lessons / steps / script / resourcePaths；禁止只口头总结。
- 关系：任务产生日志 → 蒸馏草稿 → Agent 执行 → update_skill 沉淀 → 下次 get_skill 更强。

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

## 7. 笔记本 = 运维知识 IDE；工作流 = 笔记
- 主客是外置 Agent：落盘可复用的主机知识（巡检、脚本、配置、记忆），人在工作台看得见、可改、可跑。
- 读：list_notes / search_notes / get_note。写：notebook_append_content；附件进该笔记/Skill 目录的 assets（磁盘工作区）。
- **动手改某台机之前**：list_notes(sshHostId, role=memory) → get_note；没有则先问人再写 memory。
- **工作流笔记**（role=skill）：真源；结构为说明 + 经验 + 步骤提示 + 脚本 + 资源。list_skills / get_skill 直读；**优先 get_skill 后自己用工具执行**；跑完用 **update_skill** 沉淀；run_skill 仅为可选机械捷径。
- publish_agent_skill(noteId) 仅标记 skillId；日常改正文用 update_skill / 直接改 工作流/{name}/SKILL.md。
- 长期主机上下文 role=memory 且必须带 sshHostId。

## 8. 插件包（database 产品 UI，不是连库）
- 先 get_plugin_protocol；再改 src/ui；局部 edit_plugin_pack_file；构建 build_plugin_pack_ui。
- 禁止用 list_skills/get_skill 找 bridge；禁止复制 React/Host。

## 9. 软写护照
- 终端右键「允许 MCP 写入当前目录」后，该目录内软文件写（重定向/tee/rm）可免确认。
- 数据硬风险（同步/库文件/导入）永远不可免。

## 10. 浏览器舞台（结构化命令，对齐 Kimi WebBridge）
- 先 browser_status；extensionConnected=false 时按返回的 extDir 在 Chrome/Edge「加载已解压的扩展程序」。
- 命令风格：action + args；本机也可 POST http://127.0.0.1:18765/command {"action","args","session"} → {ok,data}|{ok:false,error:{code,message}}。
- 【标签组】一任务=一 session=一 Chrome 标签组。首次 navigate 带 session+group_title。结束 close_session；borrowed 不关。
- 快速定位：browser_find_tab。读页：snapshot / read_page；批量只读：browser_run。
- 标准闭环：find_tab → find/snapshot → click → wait → snapshot。
- 上传 / 网络 / 下拉 / 拖拽：browser_upload、browser_network、browser_select_option、browser_drag。
- click 可用 selector/name 走 CDP。写操作须填 intent。
- 【填表降级】browser_fill / select_option 优先；失败或结果带 hint=snapshot_then_click 时：先打开控件 → snapshot（浮层优先，含 gridcell/option）→ 用 ref 点「上个月/日格/选项」→ 再 snapshot 核对 input value。禁止在看不见格子时反复 fill/键盘硬填。
- Element/Ant 日期：fill(YYYY-MM-DD) 会逐步翻月；翻月失败同上走快照点选。
- 【询问开关】舞台顶栏「询问」默认关闭：click/fill/keys/navigate/select/upload/drag/run_skill/replay 等执行过程不弹每步确认；打开「询问」后才逐步弹窗。生成工作流（distill）等仍会确认。
- **日志**=TaskRun（参考材料）；**工作流**=笔记 role=skill（可挂 sourceRunId），不是日志本身，也不要求逐步回放。
- 舞台顶栏「网页 | 日志」：网页左=标签；日志左=列表（可多选/重命名/删除，不删工作流笔记）、右=步骤。
- 生成工作流：勾选步骤 → distill_workflow → 草稿；再 update_skill / 编辑优化。Agent：get_skill → 工具执行 → **update_skill 沉淀**；run_skill 可选。
- 录制：开始录制后用户操作写入日志（source=record）；list_task_runs / get_task_run。
- 试跑 replay_task_step：对照日志逐步点一遍（调试用）；不等于「工作流=必须回放」。
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
