package notebook

import (
	"encoding/json"
	"strings"

	"WNavicat/internal/errno"
	"WNavicat/internal/model"
	"WNavicat/internal/store"

	"github.com/google/uuid"
)

const defaultGroupName = "默认"
const uiSettingKey = "notebook_ui"

// Service 笔记本业务服务。
type Service struct {
	store *store.Store
}

// NewService 创建笔记本服务。
func NewService(st *store.Store) *Service {
	return &Service{store: st}
}

// ListGroups 列出分组，若无分组则创建默认分组。
func (s *Service) ListGroups() ([]model.NotebookGroupDO, error) {
	list, err := s.store.ListNotebookGroups()
	if err != nil {
		return nil, err
	}
	if len(list) > 0 {
		return list, nil
	}
	g := model.NotebookGroupDO{
		ID:        uuid.NewString(),
		Name:      defaultGroupName,
		SortOrder: 0,
	}
	if err := s.store.SaveNotebookGroup(g); err != nil {
		return nil, err
	}
	return []model.NotebookGroupDO{g}, nil
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

// DeleteGroup 删除分组。
func (s *Service) DeleteGroup(id string) error {
	groups, err := s.store.ListNotebookGroups()
	if err != nil {
		return err
	}
	if len(groups) <= 1 {
		return errno.New(errno.CodeInvalidArg, "至少保留一个分组", id)
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

// SaveNote 保存笔记。
func (s *Service) SaveNote(n model.NoteDO) (*model.NoteDO, error) {
	if n.ID == "" {
		n.ID = uuid.NewString()
	}
	if strings.TrimSpace(n.Title) == "" {
		return nil, errno.New(errno.CodeInvalidArg, "笔记标题不能为空", "")
	}
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
