# ADR: 笔记本 Skill 协议与寻址

- 状态：Accepted
- 日期：2026-11-12
- 修订：2026-11-16（Skill 跟资源走；与任务区解耦）

## 背景

工作流曾被理解成「仅顶栏 `工作流/` 目录」。实际产品需要：主机记忆册、项目部署方法等也走同一套 Skill（`SKILL.md` + `log.md` + assets/scripts），落在 `项目/{名}/`、`记忆区/{host}/项目/…` 等任意目录。

同时存在双轨：旧 `MarkNoteAsSkill` 曾强制迁到 `工作流/`，与「就地成 Skill」协议冲突；短名新建默认任务区，导致**项目方法**误进任务树。

## 决策

1. **Skill 是笔记本基础协议**，位置任意；**跟资源走**，不是任务子类。
2. **归属**：
   - 项目方法 → `项目/{项目名}/`
   - 主机部署/巡检 → `记忆区/{主机}/项目/{名}/`
   - 浏览器任务探索 → `工作流/{任务名}/`（任务产品默认落点）
3. **寻址 SSOT** 在 `internal/notebook/skillref.go` + `FindNoteIDBySkillID`：
   - 短名**查找**：优先已有 `项目/` → `记忆区/` → `运维/` → `工作流/`
   - 短名**新建**默认：`工作流/{name}/SKILL.md`（任务兼容；项目/运维收口必须传完整路径）
   - 目录路径 / 业务根名 → `{dir}/SKILL.md`
4. **就地 vs 任务区**：
   - `MarkNoteAsSkill`：同目录写成 `SKILL.md`
   - `PublishSkillToTaskRoot`：显式迁到 `工作流/{id}/SKILL.md`
5. **记忆真源**仅磁盘笔记本；SQLite 记忆 API 已删。

## 后果

- 项目指挥台「收口沉淀」固定 `update_skill(name=项目/{名})`，禁止落到 `工作流/`。
- 任务产品收口传 `工作流/{任务}` 完整路径。
- get_skill / update_skill 继续认完整路径或无歧义短名（查找优先项目册）。
- 前端 `noteModel.skillNameFromNoteId` 与后端寻址同构；角色动作在 `useNotebookNoteRole`。
