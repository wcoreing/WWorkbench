package store

import (
	"database/sql"
	"encoding/json"
	"time"

	"WNavicat/internal/errno"
	"WNavicat/internal/model"

	"github.com/google/uuid"
)

const httpRequestSelectSQL = `SELECT id, name, method, url, headers_json, body, sort_order, created_at, updated_at FROM http_requests`

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
		if err := rows.Scan(&r.ID, &r.Name, &r.Method, &r.URL, &r.HeadersJSON, &r.Body, &r.SortOrder, &r.CreatedAt, &r.UpdatedAt); err != nil {
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
		&r.ID, &r.Name, &r.Method, &r.URL, &r.HeadersJSON, &r.Body, &r.SortOrder, &r.CreatedAt, &r.UpdatedAt,
	)
	if err == sql.ErrNoRows {
		return nil, errno.New(errno.CodeNotFound, "HTTP 请求不存在", id)
	}
	if err != nil {
		return nil, errno.Wrap(errno.CodeStoreFailed, "读取 HTTP 请求失败", err)
	}
	return &r, nil
}

// SaveHTTPRequest 保存 HTTP 请求。
func (s *Store) SaveHTTPRequest(r model.HTTPSavedRequestDO) error {
	now := time.Now().Unix()
	if r.ID == "" {
		r.ID = uuid.NewString()
		r.CreatedAt = now
	}
	r.UpdatedAt = now
	if r.HeadersJSON == "" {
		r.HeadersJSON = "[]"
	}
	_, err := s.db.Exec(`INSERT INTO http_requests (id, name, method, url, headers_json, body, sort_order, created_at, updated_at)
		VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
		ON CONFLICT(id) DO UPDATE SET
			name=excluded.name, method=excluded.method, url=excluded.url,
			headers_json=excluded.headers_json, body=excluded.body, sort_order=excluded.sort_order, updated_at=excluded.updated_at`,
		r.ID, r.Name, r.Method, r.URL, r.HeadersJSON, r.Body, r.SortOrder, r.CreatedAt, r.UpdatedAt)
	if err != nil {
		return errno.Wrap(errno.CodeStoreFailed, "保存 HTTP 请求失败", err)
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
