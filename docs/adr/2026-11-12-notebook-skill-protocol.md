# ADR: 笔记本 Skill 协议与寻址

- 状态：Accepted
- 日期：2026-11-12

## 背景

工作流曾被理解成「仅顶栏 `工作流/` 目录」。实际产品需要：主机记忆册、项目部署方法等也走同一套 Skill（`SKILL.md` + `log.md` + assets/scripts），落在 `记忆区/{host}/项目/…` 等任意目录。

同时存在双轨：旧 `MarkNoteAsSkill` 曾强制迁到 `工作流/`，与「就地成 Skill」协议冲突；路径纯函数与 Resolve 逻辑分散；工具层 `findSkillNote` 曾平行扫列表。

## 决策

1. **Skill 是笔记本基础协议**，位置任意；`工作流/` 只是任务产品默认落点。
2. **寻址 SSOT** 在 `internal/notebook/skillref.go` + `FindNoteIDBySkillID`：
   - 短名 → `工作流/{name}/SKILL.md`
   - 目录路径 / 业务根名 → `{dir}/SKILL.md`（不做短名映射）
   - 工具层 `get_skill` 只调 `FindNoteIDBySkillID`，不再平行扫 ListSkillNotes
3. **就地 vs 任务区**：
   - `MarkNoteAsSkill`：同目录写成 `SKILL.md`
   - `PublishSkillToTaskRoot`：显式迁到 `工作流/{id}/SKILL.md`
4. **记忆真源**仅磁盘笔记本；SQLite 记忆 API 已删。

## 后果

- 发布/右键「标为工作流」默认不搬家；需要任务区时显式 Publish。
- get_skill / update_skill 继续认完整路径或无歧义短名。
- 记忆只走 notebook 磁盘；`store.EnsureMemoryZone` 为空壳兼容。
- 前端 `noteModel.skillNameFromNoteId` 与后端寻址同构；角色动作在 `useNotebookNoteRole`。
- `make check-bindings` 校验 Wails 绑定与 Go 导出一致；CI（`.github/workflows/ci.yml`）跑 Go 单测 + bindings + `tsc`。
- 前端打开/保存域：`useNotebookNotePersistence`；项目绑定：`useHostProjectBinding`。
- 路径 API（rename/move/copy/delete/mkdir/create-file）发 `notebook.path` 雷达 + `ui-notebook-*` writeId；FE `radarWrite` 跳过本机 UI 自写，外源才 remap/刷树。
- 侧栏建目录已行内化；旧 `NotebookGroupModal` 已删。
