package store

import (
	"database/sql"
	"encoding/json"
	"time"

	"WWorkbench/internal/errno"
	"WWorkbench/internal/model"

	"github.com/google/uuid"
)

const httpEnvSelectSQL = `SELECT id, name, vars_json, created_at, updated_at FROM http_environments`

// ListHTTPEnvironments 列出 HTTP 环境预设。
func (s *Store) ListHTTPEnvironments() ([]model.HTTPEnvironmentDO, error) {
	rows, err := s.db.Query(httpEnvSelectSQL + ` ORDER BY updated_at DESC`)
	if err != nil {
		return nil, errno.Wrap(errno.CodeStoreFailed, "读取 HTTP 环境列表失败", err)
	}
	defer rows.Close()
	var out []model.HTTPEnvironmentDO
	for rows.Next() {
		var e model.HTTPEnvironmentDO
		if err := rows.Scan(&e.ID, &e.Name, &e.VarsJSON, &e.CreatedAt, &e.UpdatedAt); err != nil {
			return nil, errno.Wrap(errno.CodeStoreFailed, "读取 HTTP 环境列表失败", err)
		}
		out = append(out, e)
	}
	return out, rows.Err()
}

// GetHTTPEnvironment 按 ID 获取环境预设。
func (s *Store) GetHTTPEnvironment(id string) (*model.HTTPEnvironmentDO, error) {
	var e model.HTTPEnvironmentDO
	err := s.db.QueryRow(httpEnvSelectSQL+` WHERE id = ?`, id).Scan(
		&e.ID, &e.Name, &e.VarsJSON, &e.CreatedAt, &e.UpdatedAt,
	)
	if err == sql.ErrNoRows {
		return nil, errno.New(errno.CodeNotFound, "HTTP 环境不存在", id)
	}
	if err != nil {
		return nil, errno.Wrap(errno.CodeStoreFailed, "读取 HTTP 环境失败", err)
	}
	return &e, nil
}

// SaveHTTPEnvironment 保存 HTTP 环境预设（新建时写入 e.ID）。
func (s *Store) SaveHTTPEnvironment(e *model.HTTPEnvironmentDO) error {
	now := time.Now().Unix()
	if e.ID == "" {
		e.ID = uuid.NewString()
		e.CreatedAt = now
	}
	e.UpdatedAt = now
	if e.VarsJSON == "" {
		e.VarsJSON = "{}"
	}
	_, err := s.db.Exec(`INSERT INTO http_environments (id, name, vars_json, created_at, updated_at)
		VALUES (?, ?, ?, ?, ?)
		ON CONFLICT(id) DO UPDATE SET name=excluded.name, vars_json=excluded.vars_json, updated_at=excluded.updated_at`,
		e.ID, e.Name, e.VarsJSON, e.CreatedAt, e.UpdatedAt)
	if err != nil {
		return errno.Wrap(errno.CodeStoreFailed, "保存 HTTP 环境失败", err)
	}
	return nil
}

// DeleteHTTPEnvironment 删除 HTTP 环境预设。
func (s *Store) DeleteHTTPEnvironment(id string) error {
	res, err := s.db.Exec(`DELETE FROM http_environments WHERE id = ?`, id)
	if err != nil {
		return errno.Wrap(errno.CodeStoreFailed, "删除 HTTP 环境失败", err)
	}
	n, _ := res.RowsAffected()
	if n == 0 {
		return errno.New(errno.CodeNotFound, "HTTP 环境不存在", id)
	}
	return nil
}

// ParseHTTPEnvironmentVars 解析环境变量 JSON。
func ParseHTTPEnvironmentVars(jsonText string) map[string]string {
	if jsonText == "" {
		return nil
	}
	var m map[string]string
	if err := json.Unmarshal([]byte(jsonText), &m); err != nil {
		return nil
	}
	return m
}
