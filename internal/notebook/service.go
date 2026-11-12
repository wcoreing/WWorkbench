package notebook

import (
	"encoding/json"
	"strings"
	"sync"

	"WWorkbench/internal/errno"
	"WWorkbench/internal/model"
	"WWorkbench/internal/store"

	"github.com/google/uuid"
)

const uiSettingKey = "notebook_ui"

// Service 笔记本业务服务（正文与资源真源 = 磁盘工作区 ~/.wworkbench/notebook）。
type Service struct {
	store    *store.Store // 仅 UI 设置等；笔记不再写 SQLite
	dataDir  string
	ensureMu sync.Mutex
	fsReady  bool
}

// NewService 创建笔记本服务并确保磁盘工作区。
func NewService(st *store.Store, dataDir string) *Service {
	s := &Service{store: st, dataDir: dataDir}
	_ = s.EnsureFSNotebook()
	return s
}

// WorkspacePath 返回固定工作区绝对路径（供 UI / Agent 提示）。
func (s *Service) WorkspacePath() string {
	if s == nil {
		return ""
	}
	return s.workspaceRoot()
}

// ListGroups 列出分组（目录）。
func (s *Service) ListGroups() ([]model.NotebookGroupDO, error) {
	_ = s.EnsureFSNotebook()
	list, err := s.listGroupsFS()
	if err != nil {
		return nil, err
	}
	if list == nil {
		list = []model.NotebookGroupDO{}
	}
	return list, nil
}

// SaveGroup 保存分组（建目录）。
func (s *Service) SaveGroup(g model.NotebookGroupDO) (*model.NotebookGroupDO, error) {
	_ = s.EnsureWorkspace()
	return s.saveGroupFS(g)
}

// DeleteGroup 删除分组目录（内容上提到父目录）。
func (s *Service) DeleteGroup(id string) error {
	if strings.TrimSpace(id) == "" {
		return errno.New(errno.CodeInvalidArg, "分组 ID 不能为空", "")
	}
	return s.deleteGroupFS(id)
}

// ListNotes 列出笔记摘要（扫盘）。
func (s *Service) ListNotes() ([]model.NoteSummaryDO, error) {
	_ = s.EnsureFSNotebook()
	return s.listNotesFS()
}

// SearchNotes 搜索笔记。
func (s *Service) SearchNotes(keyword string) ([]model.NoteSummaryDO, error) {
	_ = s.EnsureFSNotebook()
	return s.searchNotesFS(keyword)
}

// GetNote 获取笔记全文。
func (s *Service) GetNote(id string) (*model.NoteDO, error) {
	_ = s.EnsureFSNotebook()
	return s.getNoteFS(id)
}

// SaveNote 保存笔记到磁盘（Skill=目录/SKILL.md；普通= .md 文件）。
func (s *Service) SaveNote(n model.NoteDO) (*model.NoteDO, error) {
	_ = s.EnsureFSNotebook()
	if n.ID == "" && n.Role != model.NoteRoleSkill {
		n.ID = uuid.NewString() // 随后 saveNoteFS 会改成相对路径
	}
	if strings.TrimSpace(n.Title) == "" {
		return nil, errno.New(errno.CodeInvalidArg, "笔记标题不能为空", "")
	}
	n.GroupID = strings.TrimSpace(n.GroupID)
	if n.Language == "" {
		n.Language = "markdown"
	}
	SyncNoteMeta(&n)
	if n.Role == model.NoteRoleMemory && strings.TrimSpace(n.GroupID) == "" {
		n.GroupID = MemoryGroupID
	}
	if n.Role == model.NoteRoleSkill && strings.TrimSpace(n.GroupID) == "" {
		n.GroupID = SkillGroupID
	}
	return s.saveNoteFS(n)
}

// ListMemoryNotes 列出记忆笔记摘要。
func (s *Service) ListMemoryNotes(limit int) ([]model.NoteSummaryDO, error) {
	all, err := s.ListNotes()
	if err != nil {
		return nil, err
	}
	if limit <= 0 {
		limit = 40
	}
	out := make([]model.NoteSummaryDO, 0)
	for _, n := range all {
		if NormalizeNoteRole(n.Role) != model.NoteRoleMemory {
			continue
		}
		out = append(out, n)
		if len(out) >= limit {
			break
		}
	}
	return out, nil
}

// ListMemoryNotesForContext 按焦点资产匹配记忆笔记。
// bookletPrefixes 为当前主机册目录（如 记忆区/prod），同册笔记排在绑定笔记之前。
func (s *Service) ListMemoryNotesForContext(sshHostIDs []string, connectionID string, limit int, bookletPrefixes ...string) ([]model.NoteSummaryDO, error) {
	if limit <= 0 {
		limit = 5
	}
	all, err := s.ListMemoryNotes(80)
	if err != nil {
		return nil, err
	}
	hostSet := map[string]struct{}{}
	for _, id := range sshHostIDs {
		id = strings.TrimSpace(id)
		if id != "" {
			hostSet[id] = struct{}{}
		}
	}
	connID := strings.TrimSpace(connectionID)
	var booklet, bound, global []model.NoteSummaryDO
	for _, n := range all {
		inBook := NoteUnderBooklet(n.ID, bookletPrefixes)
		hostHit := false
		if n.SSHHostID != "" {
			_, hostHit = hostSet[n.SSHHostID]
		}
		connHit := connID != "" && n.ConnectionID != "" && n.ConnectionID == connID
		if inBook || hostHit || connHit {
			if inBook {
				booklet = append(booklet, n)
			} else {
				bound = append(bound, n)
			}
			continue
		}
		if n.SSHHostID == "" && n.ConnectionID == "" {
			global = append(global, n)
		}
	}
	out := make([]model.NoteSummaryDO, 0, limit)
	out = append(out, booklet...)
	out = append(out, bound...)
	if len(out) < limit {
		out = append(out, global...)
	}
	if len(out) > limit {
		out = out[:limit]
	}
	return out, nil
}

// DeleteNote 删除笔记及其附件目录。
func (s *Service) DeleteNote(id string) error {
	return s.deleteNoteFS(id)
}

// DeleteNotes 批量删除。
func (s *Service) DeleteNotes(ids []string) (int, error) {
	n := 0
	for _, id := range ids {
		if strings.TrimSpace(id) == "" {
			continue
		}
		if err := s.deleteNoteFS(id); err == nil {
			n++
		}
	}
	if n == 0 && len(ids) > 0 {
		return 0, errno.New(errno.CodeNotFound, "笔记不存在", "")
	}
	return n, nil
}

// DuplicateNote 复制笔记。
func (s *Service) DuplicateNote(id string) (*model.NoteDO, error) {
	n, err := s.GetNote(id)
	if err != nil {
		return nil, err
	}
	dup := *n
	dup.ID = ""
	dup.Title = n.Title + " 副本"
	dup.CreatedAt = 0
	dup.UpdatedAt = 0
	if dup.Role == model.NoteRoleSkill {
		dup.ID = SkillNoteID(SuggestSkillID(dup.Title, ""))
	}
	return s.SaveNote(dup)
}

// GetUI 读取笔记本 UI 状态（仍在 app settings）。
func (s *Service) GetUI() (model.NotebookUIDO, error) {
	if s.store == nil {
		return model.NotebookUIDO{OpenTabIDs: []string{}}, nil
	}
	raw, err := s.store.GetAppSetting(uiSettingKey)
	if err != nil {
		return model.NotebookUIDO{}, err
	}
	if raw == "" {
		return model.NotebookUIDO{OpenTabIDs: []string{}}, nil
	}
	var ui model.NotebookUIDO
	if err := json.Unmarshal([]byte(raw), &ui); err != nil {
		return model.NotebookUIDO{OpenTabIDs: []string{}}, nil
	}
	if ui.OpenTabIDs == nil {
		ui.OpenTabIDs = []string{}
	}
	return ui, nil
}

// ApplyLayout 应用侧栏布局（移动磁盘文件）。
func (s *Service) ApplyLayout(layout model.NotebookLayoutDO) error {
	if layout.NotesByGroup == nil {
		layout.NotesByGroup = map[string][]string{}
	}
	return s.applyLayoutFS(layout)
}

// SaveUI 保存笔记本 UI 状态。
func (s *Service) SaveUI(ui model.NotebookUIDO) error {
	if s.store == nil {
		return nil
	}
	if ui.OpenTabIDs == nil {
		ui.OpenTabIDs = []string{}
	}
	raw, err := json.Marshal(ui)
	if err != nil {
		return errno.Wrap(errno.CodeStoreFailed, "序列化笔记本 UI 失败", err)
	}
	return s.store.SetAppSetting(uiSettingKey, string(raw))
}
