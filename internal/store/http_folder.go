package store

import (
	"database/sql"
	"strings"
	"time"

	"WNavicat/internal/errno"
	"WNavicat/internal/model"

	"github.com/google/uuid"
)

const httpFolderSelectSQL = `SELECT id, name, parent_id, sort_order, created_at, updated_at FROM http_folders`

// ListHTTPFolders 列出 HTTP 目录。
func (s *Store) ListHTTPFolders() ([]model.HTTPFolderDO, error) {
	rows, err := s.db.Query(httpFolderSelectSQL + ` ORDER BY sort_order ASC, updated_at DESC`)
	if err != nil {
		return nil, errno.Wrap(errno.CodeStoreFailed, "读取 HTTP 目录失败", err)
	}
	defer rows.Close()
	var out []model.HTTPFolderDO
	for rows.Next() {
		var f model.HTTPFolderDO
		if err := rows.Scan(&f.ID, &f.Name, &f.ParentID, &f.SortOrder, &f.CreatedAt, &f.UpdatedAt); err != nil {
			return nil, errno.Wrap(errno.CodeStoreFailed, "读取 HTTP 目录失败", err)
		}
		out = append(out, f)
	}
	return out, rows.Err()
}

// SaveHTTPFolder 保存 HTTP 目录并返回含 ID 的记录（新建时在本层生成 ID）。
func (s *Store) SaveHTTPFolder(f model.HTTPFolderDO) (model.HTTPFolderDO, error) {
	now := time.Now().Unix()
	if f.ID == "" {
		f.ID = uuid.NewString()
		f.CreatedAt = now
	}
	f.UpdatedAt = now
	_, err := s.db.Exec(`INSERT INTO http_folders (id, name, parent_id, sort_order, created_at, updated_at)
		VALUES (?, ?, ?, ?, ?, ?)
		ON CONFLICT(id) DO UPDATE SET
			name=excluded.name, parent_id=excluded.parent_id,
			sort_order=excluded.sort_order, updated_at=excluded.updated_at`,
		f.ID, f.Name, f.ParentID, f.SortOrder, f.CreatedAt, f.UpdatedAt)
	if err != nil {
		return model.HTTPFolderDO{}, errno.Wrap(errno.CodeStoreFailed, "保存 HTTP 目录失败", err)
	}
	return f, nil
}

// DeleteHTTPFolders 批量删除目录及其子目录，并删除这些目录下的全部接口。
func (s *Store) DeleteHTTPFolders(ids []string) error {
	return s.BatchDeleteHTTP(ids, nil)
}

// DeleteHTTPFolder 删除目录（不级联删除接口，调用方需先迁移接口）。
func (s *Store) DeleteHTTPFolder(id string) error {
	res, err := s.db.Exec(`DELETE FROM http_folders WHERE id = ?`, id)
	if err != nil {
		return errno.Wrap(errno.CodeStoreFailed, "删除 HTTP 目录失败", err)
	}
	n, _ := res.RowsAffected()
	if n == 0 {
		return errno.New(errno.CodeNotFound, "HTTP 目录不存在", id)
	}
	return nil
}

// BatchDeleteHTTP 批量删除目录（含子目录及目录内接口）与独立勾选的接口。
func (s *Store) BatchDeleteHTTP(folderIDs, requestIDs []string) error {
	allFolders, err := s.ListHTTPFolders()
	if err != nil {
		return err
	}
	expanded := expandHTTPFolderDescendants(allFolders, dedupeNonEmptyStrings(folderIDs))
	for _, fid := range expanded {
		if _, err := s.db.Exec(`DELETE FROM http_requests WHERE folder_id = ?`, fid); err != nil {
			return errno.Wrap(errno.CodeStoreFailed, "删除目录下 HTTP 接口失败", err)
		}
	}
	for _, rid := range dedupeNonEmptyStrings(requestIDs) {
		if err := s.deleteHTTPRequestIfExists(rid); err != nil {
			return err
		}
	}
	for _, fid := range expanded {
		if err := s.deleteHTTPFolderIfExists(fid); err != nil {
			return err
		}
	}
	return nil
}

// expandHTTPFolderDescendants 展开目录 id，包含所有子目录。
func expandHTTPFolderDescendants(all []model.HTTPFolderDO, roots []string) []string {
	children := make(map[string][]string)
	for _, f := range all {
		pid := f.ParentID
		children[pid] = append(children[pid], f.ID)
	}
	seen := make(map[string]struct{})
	var out []string
	var walk func(id string)
	walk = func(id string) {
		if _, ok := seen[id]; ok {
			return
		}
		seen[id] = struct{}{}
		out = append(out, id)
		for _, cid := range children[id] {
			walk(cid)
		}
	}
	for _, root := range roots {
		walk(root)
	}
	return out
}

func dedupeNonEmptyStrings(ids []string) []string {
	seen := make(map[string]struct{}, len(ids))
	out := make([]string, 0, len(ids))
	for _, id := range ids {
		id = strings.TrimSpace(id)
		if id == "" {
			continue
		}
		if _, ok := seen[id]; ok {
			continue
		}
		seen[id] = struct{}{}
		out = append(out, id)
	}
	return out
}

func (s *Store) deleteHTTPRequestIfExists(id string) error {
	_, err := s.db.Exec(`DELETE FROM http_requests WHERE id = ?`, id)
	if err != nil {
		return errno.Wrap(errno.CodeStoreFailed, "删除 HTTP 请求失败", err)
	}
	return nil
}

func (s *Store) deleteHTTPFolderIfExists(id string) error {
	_, err := s.db.Exec(`DELETE FROM http_folders WHERE id = ?`, id)
	if err != nil {
		return errno.Wrap(errno.CodeStoreFailed, "删除 HTTP 目录失败", err)
	}
	return nil
}

// GetHTTPFolder 按 ID 获取目录。
func (s *Store) GetHTTPFolder(id string) (*model.HTTPFolderDO, error) {
	var f model.HTTPFolderDO
	err := s.db.QueryRow(httpFolderSelectSQL+` WHERE id = ?`, id).Scan(
		&f.ID, &f.Name, &f.ParentID, &f.SortOrder, &f.CreatedAt, &f.UpdatedAt,
	)
	if err == sql.ErrNoRows {
		return nil, errno.New(errno.CodeNotFound, "HTTP 目录不存在", id)
	}
	if err != nil {
		return nil, errno.Wrap(errno.CodeStoreFailed, "读取 HTTP 目录失败", err)
	}
	return &f, nil
}
