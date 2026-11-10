package workbenchtools

import (
	"context"
	"encoding/json"
	"sync/atomic"
	"time"

	"WWorkbench/internal/workbench"
)

// AgentRulesVersion 规则文本版本（与 App 版本可不同步，规则变更时递增）。
const AgentRulesVersion = "2026.04.09-6"

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
- 禁止用 test/试试 等占位词；空命令仅开终端时可不填。

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
- shell_run = 给人看（注入 pip/下载/训练/脚本/管道），不返回 stdout；注入后立刻 get_shell_output(waitMs=8000～30000[, afterUpdatedAt]) 等新输出，禁止编造 stdout。
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

## 4c. 服务发现 → 自动生成备份策略（必做）
每发现/接入一台服务（新 SSH 主机、新库连接、新 Docker 业务容器、摸清某项目部署目录后），必须主动发现需备份资产并落策略，不要等用户再说「帮我备份」：
1. list_backup_policies，按 sshHostId / connectionId / path 去重，已有则跳过或更新。
2. 用 shell_probe（只读）在目标机探测常见路径，例如：
   - find /www /var/www /opt /home -maxdepth 5 \( -name '*.db' -o -name '.env' -o -type d -name data \) 2>/dev/null | head
   - 业务目录下的 data/、*.db、.env、uploads 重要配置
3. 为每个命中资产 save_backup_policy：
   - *.db → kind=sqlite；数据目录 → kind=files；MySQL/PG 连接 → kind=db + connectionId
   - beforeWrite=true；retainDays=7（生产可 14）；生产机建议 cronExpr（如 0 3 * * *）并带 sshHostId
4. 向用户简述「发现了哪些、已建哪些策略、保留几天/几份」；立即验证用 run_backup（无头），禁止为备份去 shell_run 开终端。

## 5. 数据库
- execute_sql 默认 readonly=true；写入需用户确认。
- 不要用 execute_sql「改插件界面」；连库与改 UI 是两层。
- 生产库覆盖、整库导入、无 WHERE 的 DELETE/TRUNCATE 等高危操作：先说明影响，等人拍板。

## 6. 容器 / HTTP / 资产
- 容器启停删除用 start_container / stop_container / remove_container，勿用 shell_probe 跑 docker rm/start/stop。
- HTTP：先 save_http_request / save_http_environment，再 execute_http。
- SSH / 库 / 日志 / Docker：save_* 落盘后再引用 ID；禁止只临时候参数打完就结束。

## 7. 笔记本与技能
- list_notes / search_notes / get_note 读；notebook_append_content 写。
- 首次发布技能 publish_agent_skill；改已有 update_agent_skill（不写笔记）。

## 8. 插件包（database 产品 UI，不是连库）
- 先 get_plugin_protocol；再改 src/ui；局部 edit_plugin_pack_file；构建 build_plugin_pack_ui。
- 禁止 list_skills 找 bridge；禁止复制 React/Host。

## 9. 软写护照
- 终端右键「允许 MCP 写入当前目录」后，该目录内软文件写（重定向/tee/rm）可免确认。
- 数据硬风险（同步/库文件/导入）永远不可免。
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
		workbench.CapRunBackup:
		return true
	default:
		return false
	}
}

const errNeedAgentRules = "请先调用 get_agent_rules 阅读系统约束，再执行写/动手操作（第三方 Agent 强制）"
