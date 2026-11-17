package workbenchtools

import (
	"context"
	"encoding/json"
	"strings"
	"time"

	"WWorkbench/internal/workbench"
)

// AgentRulesVersion 规则文本版本（与 App 版本可不同步，规则变更时递增）。
const AgentRulesVersion = "2026.11.17a"

const agentRulesAckTTL = 2 * time.Hour

// AgentRulesText 第三方 Agent 系统约束全文（get_agent_rules 返回；MCP initialize 已注入摘要）。
const AgentRulesText = `WWorkbench 外置 Agent 系统约束（必须遵守）

## 0. 前馈优先（不再事后拒）
- MCP initialize.instructions 与本文件已说明约束；**不会**因未调用 get_agent_rules 而拒绝工具。
- get_agent_rules 可选：按 domain 复核分片（terminal/database/browser/desktop/notebook/backup/plugin/all）。
- 内置侧栏 Agent 开跑仍会 Mark 已读，供遥测。

## 0b. 意图声明卡（intent）
- 动手类请传 intent：人话说明「要干什么、影响谁/哪台机/哪个库」。
- 缺省或占位词时系统合成「未声明意图 · …」卡片，**不阻断**；确认弹窗与舞台仍可见。
- 浏览器/任务写操作写入**任务账本**（TaskRun；list_task_runs / get_task_run / task_record；session 对齐标签组）；同步 log.md。日志≠待办。
- **MCP 审计日志**（全产品资源）：每次工具终态写入 mcp_call_logs（意图 + 触及资源 kind:id + 工具）。复盘用 list_mcp_logs（默认 byIntent）/ get_mcp_log；get_workbench_context.mcpLogs 也有近期摘要。资源含 ssh/database/docker/log/http/note/backup/skill/browser/desktop，不只任务。
- 空命令仅开终端时可不填。

## 0c. 词典与自学习闭环（先探索，再确定）
- **任务**：人分配的目标（要办成的事；常与 Chrome 标签组 session 对齐）。不是待办列表实体名。
- **任务账本 / 日志**：SSOT。含 **思考（kind=thought）** 与 **操作（kind=op）**；TaskRun → 工作流/{name}/log.md。探索期如实记录；是总结技能的**资料**，不是必须逐步回放的脚本。
- **工作流协议（Skill）**：笔记本**基础能力**（任意目录下的 SKILL.md + log.md + assets/、scripts/）。结构：说明 → 经验 → 步骤 → 脚本 → 资源。**引擎是 Agent**。Skill **跟资源走**，不是「任务」的子类；顶栏「工作流/」只是任务产品默认落点。
- **Skill 归属（强制）**：
  - **项目方法**（智能配置、跨机同步、部署清单等）→ 项目/{项目名}/SKILL.md；update_skill / get_skill 必须传完整目录路径（如 name=项目/百度标注），**禁止**落到 工作流/。
  - **主机部署/巡检** → 记忆区/{主机}/项目/{名}/SKILL.md（传完整路径）。
  - **浏览器任务探索** → 仅此时默认 工作流/{任务名}/（与 log.md 同目录）。
  - 短名新建默认仍映射任务区；项目/运维收口**禁止用短名新建**，以免误进 工作流/。
- **插件解耦**：浏览器扩展（wwb）、Kimi WebBridge（kimi）、agent-browser 只是执行器；任务场景**禁止直连** 127.0.0.1:10086 / 18765，也**禁止**自己在终端跑 agent-browser 命令，一律经 browser_*（executor=wwb|kimi|agent-browser|auto），由工作台记 op。
- **自学习两阶段（必须遵守）**：
  1. **探索**：接受目标后动手完成；过程经验写入账本/log.md（browser_* 自动记 op；关键决策用 task_record(kind=thought)）。此阶段以达成目标为主，Skill 可先粗糙或不存在。
  2. **收口**：目标完成后，**推理总结**再 update_skill（归纳稳定路径/经验/脚本/资源）；**name=归属目录**（任务=工作流/{任务}；项目=项目/{名}；与 log.md 同目录），禁止沉淀到错误业务根；禁止机械把 log 逐步贴进 Skill，禁止只口头总结不落盘。**项目收口**用 update_skill(lessons=…) 即可，**不必 steps**，**禁止** distill_skill / 切任务页。**update_skill 免确认**：无实质变更则 skipped；有变更则**写前 pin 目录版本**再落盘（仍须 intent）。
  3. **宏↔Skill**：探索用单工具/fill(fields)；跑稳后用 browser_run(mode=macro)。收口时把该稳定段写成一条 wwb-skill-steps（action=browser_run，args.allowWrite=true，args.steps=嵌套步）。下次 get_skill → Agent 调 browser_run，或 run_skill 机械跑宏一步。宏≠自动写 Skill；挂钩靠收口沉淀。
- **谁执行**：当前在用的 Agent（Cursor / 侧栏 / 其他 MCP 客户端）负责两阶段；舞台只备资料与焦点，不指定通道、不机械写 Skill。
- **磁盘真源**：笔记本 = ~/.wworkbench/notebook/。根下按**业务工作根**分区：工作流/（任务）、项目/（Workbench 项目）、运维/、记忆区/。产品只挂自己的根；笔记本产品看全盘。样板：get_skill(skill=wwb-skill-standard)。当前目录若只有 log.md，update_skill 可带 steps 首创同目录 SKILL.md。
- **log.md**：与 SKILL.md 同目录的账本投影；同步时**只追加**更高 seq 的思考/操作并刷新头信息，不整文件覆盖。get_skill / list_skills **只认 SKILL.md**。
- **目录版本（笔记本基础能力）**：任意文件夹可 enable_dir_version；仓在目录内 .git。技能目录默认 ignore log.md。list_dir_versions / pin_dir_version；Skill 兼容 list/pin/restore_skill_version。update_skill：有变更时写前+写后各 pin（可 restore 回更新前）。
- 关系：分配目标 → 探索记账本（思考+操作）→ 完成后 update_skill(归属目录) → 下次 get_skill 更强。

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
- **@ 绑定 / 拖入 AI**：人从侧栏拖入的资产（ssh/database/docker/note/log/http）会出现在前馈「本轮 @ 绑定」；优先当默认操作对象，勿让用户再复述 ID。

## 6b. 产品挂载拖拽（开发约定）
- 前端统一 MIME：application/x-wworkbench-asset；列表行用 assetDragRowProps（拖+单击），AI 侧栏只认这一份协议。
- **禁止**同一节点叠 pressProps：其 pointerdown.preventDefault 会掐死 HTML5 拖拽。

## 7. 笔记本 = 底座；业务 = 工作根组合
- 笔记本是基础服务（树/编辑/版本/角色）；业务产品组合舞台 + 自己的工作根，禁止再造第二套文件树。
- 读：list_notes / search_notes / get_note。写：notebook_append_content；附件进该笔记/Skill 目录的 assets。
- **任务产品**工作根 = 工作流/；仅网页任务 Skill 默认落 工作流/{name}/SKILL.md + log.md。
- **项目产品**工作根 = 项目/（+ 记忆区/）；项目方法 Skill = 项目/{项目名}/SKILL.md；收口与智能配置沉淀**必须** update_skill(name=项目/{名})，并可用 configure_project_resources 把 skill:项目/{名}/SKILL.md 钉进 links。
- **运维类产品**工作根 = 运维/ + 记忆区/；主机约定写记忆册，不要塞进任务区「工作流/」。
- **整理页**（运维/整理页/）：人多选笔记作数据源并写需求；骨架页已落盘。收口时 get_note 读源 → notebook_append_content(appendToNoteId=整理页) 写重组正文；不是图谱、不要机械粘贴全文。
- **整理页账密**：该目录用于管理账号密码。源笔记中的账号/密码/口令/密钥/连接串必须原样写入整理页；禁止脱敏、打码、省略。聊天勿复述明文密码，写进整理页即可。
- **主机记忆册**：选中/连接 SSH 后自动成册于 记忆区/{主机名}/。开跑优先注入该册。
- **记忆区项目 + Skill 协议**：绑主机的部署等方法落 记忆区/{主机}/项目/{名}/SKILL.md（同一套 get_skill / update_skill）；必须传完整目录路径。
- **项目本地/远端目录**：约定笔记 frontmatter localPath / remotePath（侧栏右键设置）。发版前读约定或 get_workbench_context.hostProjects；本地改代码用 localPath，远端操作对准 remotePath。
- **项目产品线**：组合器——选本机文件夹为锚点；gitRemote 空则 detect_project_git / save_project 自动探测 origin。手动「添加资源」可钉 ssh/db/docker/log/http/**note**/skill/backup；**智能配置必须经 Agent**：suggest_project_resources → 核对 → configure_project_resources。list/get/save_project；get_workbench_context.projects。智能配置经验沉淀到 项目/{名}/，不要写进 工作流/。
- **Cursor 对话跨机**：不能靠 requestId。真源={localPath}/.wworkbench/cursor-transcripts/（跟 git）。sync_project_cursor_transcripts(id, intent) 从本机 ~/.cursor/projects/*/agent-transcripts 导入并镜像笔记；换机 pull 后 list_project_cursor_transcripts → get_project_cursor_transcript（默认 md）读最近 1～2 条再续作。禁止整份 jsonl 贴进聊天。
- **动手改某台机之前**：list_notes(sshHostId, role=memory) → get_note；部署再 get_skill(记忆区/…/项目/…)。
- **Skill 笔记**（role=skill / **/SKILL.md）：真源。list_skills / get_skill；**优先 get_skill 后自己用工具执行**；跑完 **update_skill**（name=完整目录路径；仅任务区可用短名）沉淀。
- publish_agent_skill(noteId) **就地**标为 Skill（同目录 SKILL.md），不迁到「工作流/」；任务区发布须显式落到 工作流/{name}/。
- 长期主机上下文 role=memory 且必须带 sshHostId；优先落主机册；项目方法用 项目/{名}/ Skill。
- Skill 寻址：短名查找优先已有 项目/→记忆区/→运维/→工作流/；短名**新建**默认仍 工作流/{name}；目录路径 → 该目录 SKILL.md（见 notebook/skillref）。
- 笔记本路径变更（改名/移动/复制/删除/建目录/建文件）会发 workbench-changed domain=notebook.path；writeId 前缀 ui-notebook-* 表示本机 UI 已处理。

## 8. 插件包（database 产品 UI，不是连库）
- 先 get_plugin_protocol；再改 src/ui；局部 edit_plugin_pack_file；构建 build_plugin_pack_ui。
- 禁止用 list_skills/get_skill 找 bridge；禁止复制 React/Host。

## 9. 软写护照
- 终端右键「允许 MCP 写入当前目录」后，该目录内软文件写（重定向/tee/rm）可免确认。
- 数据硬风险（同步/库文件/导入）永远不可免。

## 10. 浏览器舞台与任务账本（执行器可换）
- 先 browser_status：看 executors.wwb / executors.kimi / executors.agent-browser / recommended / capabilities；wwb 未连接时可按 extDir 加载扩展。
- **禁止**任务场景直连插件端口（10086/18765）；一律 browser_*（executor=wwb|kimi|agent-browser|auto），工作台自动记 op。
- **auto/默认**：优先 wwb（已含 CDP Accessibility AX 快照 + DOM 补充，效果对齐直连 Kimi）；其次 kimi；两者都不可用时落到 agent-browser。同一任务尽量固定 executor，勿中途混用导致附着错位（各执行器的 @eN 互不通用）。
- **executor=agent-browser**（免装扩展）：工作台专用的独立 Chrome，**登录态与用户日常浏览器不通**——首次访问需登录的站点，navigate 后请用户在弹出的窗口里登录，之后保留。ref 取快照里的 [ref=eN]，传 ref=@eN；iframe 内元素已内联进快照，直接用 ref，不要传 frame / open_frame；没有用户标签可借，不要 group_session / find_tab 找用户页，直接 navigate；close_session 会关掉这个浏览器（登录态仍在）。
- snapshot 默认 source=ax（getFullAXTree→@eN）；source=dom 强制旧 DOM 扫描；frame 非 #f0 时回退 DOM。
- 思考/决策：task_record(kind=thought, summary=…)；换策略、踩坑结论、收口前必记。
- 【标签组】一任务=一 session=一 Chrome 标签组。首次 navigate 带 session+group_title。结束 close_session；borrowed 不关。
- 快速定位：browser_find_tab。读页：snapshot / read_page；批量只读：browser_run。
- **可写宏**：路径跑稳后用 browser_run(allowWrite=true|mode=macro, intent, steps=[…]) 一次往返；允许 fill/click/keys/navigate/select_option/network；失败即停；禁 upload/drag。探索多字段仍优先 fill(fields)。**自学习挂钩**：账本记宏 op（须带 session）→ update_skill 把宏收成 skill 一步 → run_skill / 再调 browser_run 复跑。
- 标准闭环：find_tab → snapshot → click（看 observation）→ 下一步。**禁止** observation 已够用时再 browser_wait / 再 snapshot。
- **等壳不等数据**：waitFor* 只等稳定 UI（Submit/Update/Create/登录/保存成功/下拉选项名）；**禁止**把任务正文（如「物流很快」）当通用 wait 条件。业务正文仅当「确知打开的就是该条」时可选。
- waitFor 优先级：waitForRef / waitForSelector → waitForNameIncludes → waitForText（壳文案）→ 业务句（最后）。
- **observation 分级**：observation=ax|probe|false（或 includeSnapshot=true|probe|false）。无 waitFor 时 click 默认 ax（拿下一跳 @eN）；带 waitFor 且命中后默认 probe（快确认）；还需点新 ref 时传 observation=ax。
- **仅当** 对不上下一态时：click/navigate 带 waitFor*（默认 3s）。勿无脑独立 browser_wait。
- **标注样板**（含新建）：
  1. **建 task**：优先宿主侧 API/manage.py（已登录会话外）；**禁止**依赖 page 内 browser_evaluate fetch（LS 等站点 CSP 禁 unsafe-eval）。UI 备选：Import → 粘贴 JSON → 导入成功壳。
  2. navigate 列表/详情：waitForText=Labeling|Submit|Create（壳），observation=probe；勿等业务正文。
  3. snapshot → 若无编辑器：click(Create, waitForText=Submit, observation=ax)。
  4. click(标签, observation=false) → click(Submit, waitForText=Update, observation=probe)。
  5. browser_network(session=同 navigate)：start → Submit → verify filter=annotations method=POST status=201；勿漏 session（否则 adhoc 无 tab）。
  6. 连续多条：每条重复 3–5；换 task 用列表行或 ?task=id，仍等壳不业务句。
- 上传 / 网络 / 下拉 / 拖拽：browser_upload、browser_network、browser_select_option、browser_drag（拖拽必须 wwb）。
- navigate：load 完成后可 waitForText=壳文案（如 Labeling/Settings）；默认不附全量 ax；observation=probe 即可。勿 navigate 后再无脑 wait。
- 【填表】探索期多字段用 browser_fill(fields=[{ref,value,action?}]) 一次往返（软写；失败即停；勿塞 Submit）。单字段仍 ref+value。select_option 可作 field.action。失败或 hint=snapshot_then_click 时：打开控件 → snapshot → 点选项 → 再核对。
- 【询问开关】舞台顶栏「询问」默认关闭；打开后逐步确认。
- 舞台顶栏「网页 | 日志」：网页=操作面；日志=任务账本 + IDE（log.md 含思考/操作；Skill=SKILL.md）。
- **推荐闭环**：接目标 → task_record(thought) + browser_* 探索 → 完成后 update_skill。run_skill 仅为可选捷径。
- distill_skill 仅草稿；正式技能以 Agent 总结后的 update_skill 为准。
- 录制：source=record 写入账本；list_task_runs / get_task_run / SyncTaskRunLog→log.md。

## 11. 桌面应用（desktop_*，执行器 agent-desktop）
- 用途：浏览器之外的原生应用（访达、备忘录、微信、Excel、各类客户端）。网页任务仍走 browser_*，不要用桌面工具去点浏览器里的网页。
- **默认一个应用都读不了**。首次 desktop_snapshot / desktop_find / desktop_screenshot 某应用 → 工作台弹窗请用户授权「读取」；首次 desktop_act / desktop_launch → 请用户授权「操作」（含读取）。授权按应用长期有效，用户可在「AI 权限」里撤销。被拒绝后**不要重复请求**，先向用户说明为什么需要。
- 工作台自身不可被读取或操作（授权与确认弹窗在这里）。**禁止**自己在终端跑 agent-desktop 命令绕过授权；一律经 desktop_*。
- 先 desktop_status（是否安装、系统辅助功能 / 屏幕录制权限）；权限缺失时请用户到「系统设置 → 隐私与安全性」允许 WWorkbench，不要反复重试。
- **两套路**：① 语义（默认）：desktop_apps → desktop_snapshot / desktop_find → desktop_act(click/type/press…)；不抢焦点。② 物理 headed：无障碍树空（微信等自绘）时用 mouse_click/mouse_move/mouse_wheel（屏幕绝对坐标 x,y）、hover、drag、double_click；press 请加 headed=true（物理按键，先 mouse_click 点进输入区再按）。发图：clipboard_set(imagePath=…) → mouse_click 输入区 → press keys=cmd+v headed=true → press keys=return headed=true。
- **截图视觉**：desktop_screenshot / browser_screenshot 成功后，侧栏会把图压缩附图进下一轮模型（多模态）；据此估逻辑点坐标再 mouse_click。须使用支持视觉的模型；失败时接口会提示换模型。path 仍返回，可本机打开。隐私：只截任务所需。
- 无 AX 窗口上 focus_window / press --app 会失败；headed 的 press 改为系统级投递，**务必先点中目标窗口**。坐标与 screencapture -R 同为逻辑点。搜人：mouse_click 搜索框 → press cmd+f 或直接点搜 → clipboard_set → cmd+v headed → mouse_click 结果 → 发送。
- ref 形如 @<快照id>:eN，**原样使用**；报 STALE_REF 就重新快照。禁止编造 ref。
- type = 光标插入；set_value = 整体替换；clear 清空。delivery=delivered_unverified 时用 waitFor / find 核对，**不要重复同一动作**。
- 危险快捷键（cmd+q）默认拦；press + force=true 每次单独确认。
- 账本：desktop_act / desktop_launch 自动记 op。完成后 update_skill；桌面步骤暂不支持 run_skill 机械重放。
- 隐私：快照/截图是真实桌面内容；只取任务所需。
`

// MarkAgentRulesAck 标记当前调用方「已读系统规则」（内置 Agent 开跑 / get_agent_rules）。
func MarkAgentRulesAck(ctx context.Context) {
	stateOf(ctx).markRulesAck()
}

// AgentRulesAcked 当前调用方是否仍在已读有效期内。
func AgentRulesAcked(ctx context.Context) bool {
	return stateOf(ctx).rulesAcked()
}

// AgentRulesDomains 可分片领域。
func AgentRulesDomains() []string {
	return []string{"all", "terminal", "database", "browser", "desktop", "notebook", "backup", "plugin"}
}

// AgentRulesForDomain 按领域返回约束分片（all=全文）。
func AgentRulesForDomain(domain string) string {
	domain = strings.ToLower(strings.TrimSpace(domain))
	if domain == "" || domain == "all" {
		return AgentRulesText
	}
	sections := map[string][]string{
		"terminal": {"## 3. 终端与舞台", "## 9. 软写护照"},
		"database": {"## 5. 数据库", "## 4. 数据文件三层防护", "## 4b. 统一备份策略"},
		"browser":  {"## 10. 浏览器舞台与任务账本", "## 0c. 词典与自学习闭环"},
		"desktop":  {"## 11. 桌面应用", "## 0c. 词典与自学习闭环"},
		"notebook": {"## 7. 笔记本 = 底座", "## 0c. 词典与自学习闭环"},
		"backup":   {"## 4. 数据文件三层防护", "## 4b. 统一备份策略", "## 4c. 服务发现"},
		"plugin":   {"## 8. 插件包"},
	}
	heads, ok := sections[domain]
	if !ok {
		return AgentRulesText
	}
	var b strings.Builder
	b.WriteString("WWorkbench 约束分片 domain=" + domain + "（rulesVersion=" + AgentRulesVersion + "）\n\n")
	b.WriteString("## 0. 前馈优先\n- 本分片为摘要；完整见 get_agent_rules(domain=all)。不会因未读而拒绝工具。\n\n")
	full := AgentRulesText
	for _, head := range heads {
		start := strings.Index(full, head)
		if start < 0 {
			continue
		}
		rest := full[start+len(head):]
		endRel := strings.Index(rest, "\n## ")
		chunk := full[start:]
		if endRel >= 0 {
			chunk = full[start : start+len(head)+endRel]
		}
		b.WriteString(strings.TrimSpace(chunk))
		b.WriteString("\n\n")
	}
	return strings.TrimSpace(b.String())
}

// toolGetAgentRules 返回系统约束（可按 domain 分片），并标记已读。
func toolGetAgentRules(ctx context.Context, _ *Deps, raw json.RawMessage) ToolResult {
	var in struct {
		Domain string `json:"domain"`
	}
	_ = json.Unmarshal(raw, &in)
	domain := strings.TrimSpace(in.Domain)
	if domain == "" {
		domain = "all"
	}
	MarkAgentRulesAck(ctx)
	return OKData(map[string]interface{}{
		"ok":           true,
		"rulesVersion": AgentRulesVersion,
		"domain":       domain,
		"domains":      AgentRulesDomains(),
		"ackedFor":     agentRulesAckTTL.String(),
		"caller":       CallerID(ctx),
		"rules":        AgentRulesForDomain(domain),
		"note":         "可选复核；MCP initialize 已注入摘要。不会因未调用本工具而拒绝写操作。",
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
		workbench.CapDistillSkill,
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
		workbench.CapBrowserAttach,
		workbench.CapDesktopAct,
		workbench.CapDesktopLaunch,
		workbench.CapSyncProjectCursorTranscripts:
		return true
	default:
		return false
	}
}

