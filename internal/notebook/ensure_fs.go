package notebook

import (
	"os"
	"path/filepath"
	"strings"
	"time"
)

// WorkspaceSchemaVersion 磁盘工作区协议版本；升级时直接重置工作区（不迁移旧数据）。
const WorkspaceSchemaVersion = 3

// EnsureFSNotebook 确保磁盘工作区：协议不对齐则清空重建；只种子系统目录与记忆入门。
// 幂等且可重入：热路径 ListGroups/GetNote 可安全调用，不会递归炸栈。
func (s *Service) EnsureFSNotebook() error {
	if s == nil {
		return errnoNotebook("笔记本未就绪")
	}
	s.ensureMu.Lock()
	defer s.ensureMu.Unlock()
	if s.fsReady {
		return nil
	}
	if err := s.EnsureWorkspace(); err != nil {
		return err
	}
	reset, err := s.resetWorkspaceIfNeeded()
	if err != nil {
		return err
	}
	if reset {
		if s.store != nil {
			_ = s.store.ClearNotebookTables()
		}
		_ = os.RemoveAll(filepath.Join(s.dataDir, "notebook-assets"))
	}
	if err := s.ensureSystemDirs(); err != nil {
		return err
	}
	if err := s.ensureMemorySeedFS(); err != nil {
		return err
	}
	if err := s.seedBuiltinWorkflowsFS(); err != nil {
		return err
	}
	s.fsReady = true
	return nil
}

func (s *Service) resetWorkspaceIfNeeded() (reset bool, err error) {
	m := s.readMeta()
	if m.Version >= WorkspaceSchemaVersion {
		return false, nil
	}
	root := s.workspaceRoot()
	entries, err := os.ReadDir(root)
	if err != nil && !os.IsNotExist(err) {
		return false, err
	}
	for _, e := range entries {
		name := e.Name()
		if name == MetaFileName {
			continue
		}
		_ = os.RemoveAll(filepath.Join(root, name))
	}
	if err := s.writeMeta(workspaceMeta{
		Version: WorkspaceSchemaVersion,
		ResetAt: time.Now().Unix(),
	}); err != nil {
		return false, err
	}
	return true, nil
}

func (s *Service) ensureSystemDirs() error {
	for _, name := range SystemTopDirs() {
		if err := os.MkdirAll(filepath.Join(s.workspaceRoot(), name), 0o700); err != nil {
			return err
		}
	}
	if err := s.ensureOpsSeedFS(); err != nil {
		return err
	}
	return nil
}

func (s *Service) ensureOpsSeedFS() error {
	// 整理页落盘目录（选料→按需求生成页）
	if err := os.MkdirAll(filepath.Join(s.workspaceRoot(), OpsGroupName, "整理页"), 0o700); err != nil {
		return err
	}
	path := filepath.Join(s.workspaceRoot(), OpsGroupName, "怎么用运维区.md")
	if _, err := os.Stat(path); err == nil {
		return nil
	}
	content := "# 运维工作区\n\n" +
		"本目录是**运维类产品**（终端 / Docker / 备份 / SFTP 等）的笔记本工作根，" +
		"与「工作流」（任务产品）相互隔离。\n\n" +
		"- 主机约定、巡检说明、发布备忘写在这里\n" +
		"- 可复用方法也可建成 Skill（同协议），不必挤进「工作流」\n" +
		"- 笔记本产品可看全盘；各业务产品只挂自己的工作根\n" +
		"- **整理页**：侧栏多选笔记 →「生成整理页」→ 选模板/写需求 → 落在 `运维/整理页/`，Agent 按需求收口成一页\n"
	if err := os.MkdirAll(filepath.Dir(path), 0o700); err != nil {
		return err
	}
	return os.WriteFile(path, []byte(content), 0o600)
}

func (s *Service) ensureMemorySeedFS() error {
	path := filepath.Join(s.workspaceRoot(), MemoryGroupName, "怎么用记忆区.md")
	if _, err := os.Stat(path); err == nil {
		return nil
	}
	content := "---\nrole: memory\n---\n\n# 怎么用记忆区\n\n" +
		"把**某台机 / 某个库**反复踩过的坑、约定、口令位置写成记忆笔记：\n\n" +
		"1. 选中或连接 SSH 后，自动成册于 `记忆区/{主机名}/`（索引「主机记忆.md」）\n" +
		"2. 同目录可再加笔记；角色选「记忆」并带 sshHostId\n" +
		"3. **项目部署等方法**：在 `记忆区/{主机}/项目/{名}/` 下放 `SKILL.md`（工作流协议，与顶栏「工作流/」同一套 get_skill / update_skill）\n" +
		"4. Agent 开跑优先注入该主机册；动手前 get_note；要发布再 get_skill\n\n" +
		"全局习惯（不绑主机）也会注入。成长感来自「记得你上次踩的坑」，不是又一套脚本。\n"
	if err := os.MkdirAll(filepath.Dir(path), 0o700); err != nil {
		return err
	}
	return os.WriteFile(path, []byte(content), 0o600)
}

// seedBuiltinWorkflowsFS 直接写盘种子，禁止再走 ListGroups/GetNote（避免 Ensure 递归）。
func (s *Service) seedBuiltinWorkflowsFS() error {
	for _, p := range BuiltinWorkflows() {
		name := strings.TrimSpace(p.Name)
		if name == "" {
			continue
		}
		noteID := SkillNoteID(name)
		dir, _, ok := s.skillDirAbs(noteID)
		if !ok {
			continue
		}
		path := filepath.Join(dir, SkillEntryFile)
		if _, err := os.Stat(path); err == nil {
			continue
		}
		p.NoteID = noteID
		content := FormatWorkflowNoteContent(p, WorkflowNoteBodyExtras{})
		if err := os.MkdirAll(filepath.Join(dir, SkillAssetsDir), 0o700); err != nil {
			return err
		}
		_ = os.MkdirAll(filepath.Join(dir, SkillScriptsDir), 0o700)
		if err := os.WriteFile(path, []byte(content), 0o600); err != nil {
			return err
		}
	}
	return nil
}

// ResolveSkillPaths 按 skill 引用返回笔记 id / 目录 / 附件目录（任意业务根；短名默认 工作流/）。
func (s *Service) ResolveSkillPaths(skillName string) (noteID, absDir, absAssets string, err error) {
	skillName = strings.TrimSpace(skillName)
	if skillName == "" {
		return "", "", "", errnoNotebook("skill name 为空")
	}
	noteID = SkillNoteID(skillName)
	if found := s.FindNoteIDBySkillID(skillName); found != "" {
		noteID = found
	}
	dir, _, ok := s.skillDirAbs(noteID)
	if !ok {
		return "", "", "", errnoNotebook("非法 skill name")
	}
	return noteID, dir, filepath.Join(dir, SkillAssetsDir), nil
}
