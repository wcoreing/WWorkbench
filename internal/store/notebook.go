package store

import (
	"database/sql"
	"strings"
	"time"

	"WNavicat/internal/errno"
	"WNavicat/internal/model"
)

const (
	notebookGroupSelectSQL = `SELECT id, name, parent_id, sort_order, created_at, updated_at FROM notebook_groups`
	noteSelectSQL          = `SELECT id, group_id, title, content, language, ssh_host_id, connection_id, sort_order, created_at, updated_at FROM notes`
	noteSummarySelectSQL   = `SELECT id, group_id, title, language, ssh_host_id, connection_id, sort_order, updated_at FROM notes`
)

// ListNotebookGroups 列出笔记本分组。
func (s *Store) ListNotebookGroups() ([]model.NotebookGroupDO, error) {
	rows, err := s.db.Query(notebookGroupSelectSQL + ` ORDER BY sort_order ASC, updated_at DESC`)
	if err != nil {
		return nil, errno.Wrap(errno.CodeStoreFailed, "查询笔记本分组失败", err)
	}
	defer rows.Close()
	var list []model.NotebookGroupDO
	for rows.Next() {
		item, err := scanNotebookGroup(rows.Scan)
		if err != nil {
			return nil, err
		}
		list = append(list, item)
	}
	if err := rows.Err(); err != nil {
		return nil, errno.Wrap(errno.CodeStoreFailed, "查询笔记本分组失败", err)
	}
	return list, nil
}

// SaveNotebookGroup 保存笔记本分组。
func (s *Store) SaveNotebookGroup(g model.NotebookGroupDO) error {
	if g.ID == "" {
		return errno.New(errno.CodeInvalidArg, "分组 ID 不能为空", "")
	}
	if strings.TrimSpace(g.Name) == "" {
		return errno.New(errno.CodeInvalidArg, "分组名称不能为空", "")
	}
	now := time.Now().Unix()
	if g.CreatedAt == 0 {
		g.CreatedAt = now
	}
	g.UpdatedAt = now
	_, err := s.db.Exec(`INSERT INTO notebook_groups (id, name, parent_id, sort_order, created_at, updated_at)
		VALUES (?, ?, ?, ?, ?, ?)
		ON CONFLICT(id) DO UPDATE SET
		name=excluded.name, parent_id=excluded.parent_id, sort_order=excluded.sort_order, updated_at=excluded.updated_at`,
		g.ID, g.Name, g.ParentID, g.SortOrder, g.CreatedAt, g.UpdatedAt)
	if err != nil {
		return errno.Wrap(errno.CodeStoreFailed, "保存笔记本分组失败", err)
	}
	return nil
}

// DeleteNotebookGroup 删除笔记本分组及其下属笔记。
func (s *Store) DeleteNotebookGroup(id string) error {
	tx, err := s.db.Begin()
	if err != nil {
		return errno.Wrap(errno.CodeStoreFailed, "删除笔记本分组失败", err)
	}
	defer tx.Rollback()
	if _, err := tx.Exec(`DELETE FROM notes WHERE group_id = ?`, id); err != nil {
		return errno.Wrap(errno.CodeStoreFailed, "删除笔记本分组失败", err)
	}
	res, err := tx.Exec(`DELETE FROM notebook_groups WHERE id = ?`, id)
	if err != nil {
		return errno.Wrap(errno.CodeStoreFailed, "删除笔记本分组失败", err)
	}
	n, err := res.RowsAffected()
	if err != nil {
		return errno.Wrap(errno.CodeStoreFailed, "删除笔记本分组失败", err)
	}
	if n == 0 {
		return errno.New(errno.CodeNotFound, "笔记本分组不存在", id)
	}
	if err := tx.Commit(); err != nil {
		return errno.Wrap(errno.CodeStoreFailed, "删除笔记本分组失败", err)
	}
	return nil
}

// ListNoteSummaries 列出笔记摘要。
func (s *Store) ListNoteSummaries() ([]model.NoteSummaryDO, error) {
	rows, err := s.db.Query(noteSummarySelectSQL + ` ORDER BY sort_order ASC, updated_at DESC`)
	if err != nil {
		return nil, errno.Wrap(errno.CodeStoreFailed, "查询笔记失败", err)
	}
	defer rows.Close()
	var list []model.NoteSummaryDO
	for rows.Next() {
		item, err := scanNoteSummary(rows.Scan)
		if err != nil {
			return nil, err
		}
		list = append(list, item)
	}
	if err := rows.Err(); err != nil {
		return nil, errno.Wrap(errno.CodeStoreFailed, "查询笔记失败", err)
	}
	return list, nil
}

// SearchNotes 按标题或正文搜索笔记。
func (s *Store) SearchNotes(keyword string) ([]model.NoteSummaryDO, error) {
	kw := strings.TrimSpace(keyword)
	if kw == "" {
		return s.ListNoteSummaries()
	}
	pattern := "%" + kw + "%"
	rows, err := s.db.Query(noteSummarySelectSQL+` WHERE title LIKE ? OR id IN (
		SELECT id FROM notes WHERE content LIKE ?
	) ORDER BY updated_at DESC`, pattern, pattern)
	if err != nil {
		return nil, errno.Wrap(errno.CodeStoreFailed, "搜索笔记失败", err)
	}
	defer rows.Close()
	var list []model.NoteSummaryDO
	for rows.Next() {
		item, err := scanNoteSummary(rows.Scan)
		if err != nil {
			return nil, err
		}
		list = append(list, item)
	}
	if err := rows.Err(); err != nil {
		return nil, errno.Wrap(errno.CodeStoreFailed, "搜索笔记失败", err)
	}
	return list, nil
}

// GetNote 按 ID 获取笔记。
func (s *Store) GetNote(id string) (*model.NoteDO, error) {
	row := s.db.QueryRow(noteSelectSQL+` WHERE id = ?`, id)
	note, err := scanNote(row.Scan)
	if err != nil {
		if err == sql.ErrNoRows {
			return nil, errno.New(errno.CodeNotFound, "笔记不存在", id)
		}
		return nil, errno.Wrap(errno.CodeStoreFailed, "读取笔记失败", err)
	}
	return &note, nil
}

// SaveNote 保存笔记。
func (s *Store) SaveNote(n model.NoteDO) error {
	if n.ID == "" {
		return errno.New(errno.CodeInvalidArg, "笔记 ID 不能为空", "")
	}
	if strings.TrimSpace(n.Title) == "" {
		return errno.New(errno.CodeInvalidArg, "笔记标题不能为空", "")
	}
	if n.Language == "" {
		n.Language = "plaintext"
	}
	now := time.Now().Unix()
	if n.CreatedAt == 0 {
		n.CreatedAt = now
	}
	n.UpdatedAt = now
	_, err := s.db.Exec(`INSERT INTO notes (id, group_id, title, content, language, ssh_host_id, connection_id, sort_order, created_at, updated_at)
		VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
		ON CONFLICT(id) DO UPDATE SET
		group_id=excluded.group_id, title=excluded.title, content=excluded.content,
		language=excluded.language, ssh_host_id=excluded.ssh_host_id, connection_id=excluded.connection_id,
		sort_order=excluded.sort_order, updated_at=excluded.updated_at`,
		n.ID, n.GroupID, n.Title, n.Content, n.Language, n.SSHHostID, n.ConnectionID, n.SortOrder, n.CreatedAt, n.UpdatedAt)
	if err != nil {
		return errno.Wrap(errno.CodeStoreFailed, "保存笔记失败", err)
	}
	return nil
}

// DeleteNote 删除笔记。
func (s *Store) DeleteNote(id string) error {
	res, err := s.db.Exec(`DELETE FROM notes WHERE id = ?`, id)
	if err != nil {
		return errno.Wrap(errno.CodeStoreFailed, "删除笔记失败", err)
	}
	n, err := res.RowsAffected()
	if err != nil {
		return errno.Wrap(errno.CodeStoreFailed, "删除笔记失败", err)
	}
	if n == 0 {
		return errno.New(errno.CodeNotFound, "笔记不存在", id)
	}
	return nil
}

// scanNotebookGroup 扫描笔记本分组行。
func scanNotebookGroup(scan func(dest ...any) error) (model.NotebookGroupDO, error) {
	var g model.NotebookGroupDO
	if err := scan(&g.ID, &g.Name, &g.ParentID, &g.SortOrder, &g.CreatedAt, &g.UpdatedAt); err != nil {
		return g, err
	}
	return g, nil
}

// scanNoteSummary 扫描笔记摘要行。
func scanNoteSummary(scan func(dest ...any) error) (model.NoteSummaryDO, error) {
	var n model.NoteSummaryDO
	if err := scan(&n.ID, &n.GroupID, &n.Title, &n.Language, &n.SSHHostID, &n.ConnectionID, &n.SortOrder, &n.UpdatedAt); err != nil {
		return n, err
	}
	return n, nil
}

// scanNote 扫描笔记全文行。
func scanNote(scan func(dest ...any) error) (model.NoteDO, error) {
	var n model.NoteDO
	if err := scan(&n.ID, &n.GroupID, &n.Title, &n.Content, &n.Language, &n.SSHHostID, &n.ConnectionID, &n.SortOrder, &n.CreatedAt, &n.UpdatedAt); err != nil {
		return n, errno.Wrap(errno.CodeStoreFailed, "读取笔记失败", err)
	}
	return n, nil
}
