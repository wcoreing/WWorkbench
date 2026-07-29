package notebook

import (
	"encoding/json"
	"strings"

	"WWorkbench/internal/errno"
	"WWorkbench/internal/model"
	"WWorkbench/internal/store"

	"github.com/google/uuid"
)

const uiSettingKey = "notebook_ui"

// Service 笔记本业务服务。
type Service struct {
	store *store.Store
}

// NewService 创建笔记本服务。
func NewService(st *store.Store) *Service {
	return &Service{store: st}
}

// ListGroups 列出分组（允许为空；笔记可挂在根目录 groupId=""）。
func (s *Service) ListGroups() ([]model.NotebookGroupDO, error) {
	list, err := s.store.ListNotebookGroups()
	if err != nil {
		return nil, err
	}
	if list == nil {
		list = []model.NotebookGroupDO{}
	}
	return list, nil
}

// SaveGroup 保存分组。
func (s *Service) SaveGroup(g model.NotebookGroupDO) (*model.NotebookGroupDO, error) {
	if g.ID == "" {
		g.ID = uuid.NewString()
	}
	if strings.TrimSpace(g.Name) == "" {
		return nil, errno.New(errno.CodeInvalidArg, "分组名称不能为空", "")
	}
	if err := s.store.SaveNotebookGroup(g); err != nil {
		return nil, err
	}
	return &g, nil
}

// DeleteGroup 删除分组，组内笔记移到根目录。
func (s *Service) DeleteGroup(id string) error {
	if strings.TrimSpace(id) == "" {
		return errno.New(errno.CodeInvalidArg, "分组 ID 不能为空", "")
	}
	return s.store.DeleteNotebookGroup(id)
}

// ListNotes 列出笔记摘要。
func (s *Service) ListNotes() ([]model.NoteSummaryDO, error) {
	return s.store.ListNoteSummaries()
}

// SearchNotes 搜索笔记。
func (s *Service) SearchNotes(keyword string) ([]model.NoteSummaryDO, error) {
	return s.store.SearchNotes(keyword)
}

// GetNote 获取笔记全文。
func (s *Service) GetNote(id string) (*model.NoteDO, error) {
	return s.store.GetNote(id)
}

// SaveNote 保存笔记（groupId 为空表示根目录）。
func (s *Service) SaveNote(n model.NoteDO) (*model.NoteDO, error) {
	if n.ID == "" {
		n.ID = uuid.NewString()
	}
	if strings.TrimSpace(n.Title) == "" {
		return nil, errno.New(errno.CodeInvalidArg, "笔记标题不能为空", "")
	}
	n.GroupID = strings.TrimSpace(n.GroupID)
	if n.Language == "" {
		n.Language = "plaintext"
	}
	if err := s.store.SaveNote(n); err != nil {
		return nil, err
	}
	saved, err := s.store.GetNote(n.ID)
	if err != nil {
		return nil, err
	}
	return saved, nil
}

// DeleteNote 删除笔记。
func (s *Service) DeleteNote(id string) error {
	return s.store.DeleteNote(id)
}

// DuplicateNote 复制笔记。
func (s *Service) DuplicateNote(id string) (*model.NoteDO, error) {
	n, err := s.store.GetNote(id)
	if err != nil {
		return nil, err
	}
	dup := *n
	dup.ID = uuid.NewString()
	dup.Title = n.Title + " 副本"
	dup.CreatedAt = 0
	dup.UpdatedAt = 0
	if err := s.store.SaveNote(dup); err != nil {
		return nil, err
	}
	return s.store.GetNote(dup.ID)
}

// GetUI 读取笔记本 UI 状态。
func (s *Service) GetUI() (model.NotebookUIDO, error) {
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

// ApplyLayout 应用侧栏分组与笔记树形布局。
func (s *Service) ApplyLayout(layout model.NotebookLayoutDO) error {
	if layout.NotesByGroup == nil {
		layout.NotesByGroup = map[string][]string{}
	}
	return s.store.ApplyNotebookLayout(layout)
}

// SaveUI 保存笔记本 UI 状态。
func (s *Service) SaveUI(ui model.NotebookUIDO) error {
	if ui.OpenTabIDs == nil {
		ui.OpenTabIDs = []string{}
	}
	raw, err := json.Marshal(ui)
	if err != nil {
		return errno.Wrap(errno.CodeStoreFailed, "序列化笔记本 UI 失败", err)
	}
	return s.store.SetAppSetting(uiSettingKey, string(raw))
}
