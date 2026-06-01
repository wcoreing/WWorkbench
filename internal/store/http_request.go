package store

import (
	"database/sql"
	"encoding/json"
	"time"

	"WNavicat/internal/errno"
	"WNavicat/internal/model"

	"github.com/google/uuid"
)

const httpRequestSelectSQL = `SELECT id, folder_id, name, method, url, params_json, headers_json, cookies_json, body, notes, sort_order, created_at, updated_at FROM http_requests`

// ListHTTPRequests 列出已保存的 HTTP 请求。
func (s *Store) ListHTTPRequests() ([]model.HTTPSavedRequestDO, error) {
	rows, err := s.db.Query(httpRequestSelectSQL + ` ORDER BY sort_order ASC, updated_at DESC`)
	if err != nil {
		return nil, errno.Wrap(errno.CodeStoreFailed, "读取 HTTP 请求列表失败", err)
	}
	defer rows.Close()
	var out []model.HTTPSavedRequestDO
	for rows.Next() {
		var r model.HTTPSavedRequestDO
		if err := rows.Scan(&r.ID, &r.FolderID, &r.Name, &r.Method, &r.URL, &r.ParamsJSON, &r.HeadersJSON, &r.CookiesJSON, &r.Body, &r.Notes, &r.SortOrder, &r.CreatedAt, &r.UpdatedAt); err != nil {
			return nil, errno.Wrap(errno.CodeStoreFailed, "读取 HTTP 请求列表失败", err)
		}
		out = append(out, r)
	}
	return out, rows.Err()
}

// GetHTTPRequest 按 ID 获取请求。
func (s *Store) GetHTTPRequest(id string) (*model.HTTPSavedRequestDO, error) {
	var r model.HTTPSavedRequestDO
	err := s.db.QueryRow(httpRequestSelectSQL+` WHERE id = ?`, id).Scan(
		&r.ID, &r.FolderID, &r.Name, &r.Method, &r.URL, &r.ParamsJSON, &r.HeadersJSON, &r.CookiesJSON, &r.Body, &r.Notes, &r.SortOrder, &r.CreatedAt, &r.UpdatedAt,
	)
	if err == sql.ErrNoRows {
		return nil, errno.New(errno.CodeNotFound, "HTTP 请求不存在", id)
	}
	if err != nil {
		return nil, errno.Wrap(errno.CodeStoreFailed, "读取 HTTP 请求失败", err)
	}
	return &r, nil
}

// SaveHTTPRequest 保存 HTTP 请求并返回含 ID 的记录（新建时在本层生成 ID）。
func (s *Store) SaveHTTPRequest(r model.HTTPSavedRequestDO) (model.HTTPSavedRequestDO, error) {
	now := time.Now().Unix()
	if r.ID == "" {
		r.ID = uuid.NewString()
		r.CreatedAt = now
	}
	r.UpdatedAt = now
	if r.ParamsJSON == "" {
		r.ParamsJSON = "[]"
	}
	if r.HeadersJSON == "" {
		r.HeadersJSON = "[]"
	}
	if r.CookiesJSON == "" {
		r.CookiesJSON = "[]"
	}
	_, err := s.db.Exec(`INSERT INTO http_requests (id, folder_id, name, method, url, params_json, headers_json, cookies_json, body, notes, sort_order, created_at, updated_at)
		VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
		ON CONFLICT(id) DO UPDATE SET
			folder_id=excluded.folder_id, name=excluded.name, method=excluded.method, url=excluded.url,
			params_json=excluded.params_json, headers_json=excluded.headers_json, cookies_json=excluded.cookies_json,
			body=excluded.body, notes=excluded.notes, sort_order=excluded.sort_order, updated_at=excluded.updated_at`,
		r.ID, r.FolderID, r.Name, r.Method, r.URL, r.ParamsJSON, r.HeadersJSON, r.CookiesJSON, r.Body, r.Notes, r.SortOrder, r.CreatedAt, r.UpdatedAt)
	if err != nil {
		return model.HTTPSavedRequestDO{}, errno.Wrap(errno.CodeStoreFailed, "保存 HTTP 请求失败", err)
	}
	return r, nil
}

// MoveHTTPRequestToFolder 将接口移入指定目录（folderID 为空表示根目录）。
func (s *Store) MoveHTTPRequestToFolder(id, folderID string) error {
	if _, err := s.GetHTTPRequest(id); err != nil {
		return err
	}
	if folderID != "" {
		if _, err := s.GetHTTPFolder(folderID); err != nil {
			return err
		}
	}
	res, err := s.db.Exec(
		`UPDATE http_requests SET folder_id = ?, updated_at = ? WHERE id = ?`,
		folderID, time.Now().Unix(), id,
	)
	if err != nil {
		return errno.Wrap(errno.CodeStoreFailed, "移动 HTTP 接口目录失败", err)
	}
	n, _ := res.RowsAffected()
	if n == 0 {
		return errno.New(errno.CodeNotFound, "HTTP 请求不存在", id)
	}
	return nil
}

// DeleteHTTPRequest 删除 HTTP 请求。
func (s *Store) DeleteHTTPRequest(id string) error {
	res, err := s.db.Exec(`DELETE FROM http_requests WHERE id = ?`, id)
	if err != nil {
		return errno.Wrap(errno.CodeStoreFailed, "删除 HTTP 请求失败", err)
	}
	n, _ := res.RowsAffected()
	if n == 0 {
		return errno.New(errno.CodeNotFound, "HTTP 请求不存在", id)
	}
	return nil
}

// ParseHTTPHeadersJSON 解析存储的请求头 JSON。
func ParseHTTPHeadersJSON(raw string) []model.HTTPHeaderKVDO {
	if raw == "" {
		return nil
	}
	var out []model.HTTPHeaderKVDO
	_ = json.Unmarshal([]byte(raw), &out)
	return out
}
