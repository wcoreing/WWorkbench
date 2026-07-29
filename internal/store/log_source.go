package store

import (
	"database/sql"
	"time"

	"WWorkbench/internal/errno"
	"WWorkbench/internal/model"

	"github.com/google/uuid"
)

const logSourceSelectSQL = `SELECT id, name, source_type, path, ssh_host_id, docker_context_id, container_id, compose_dir, compose_service, tail_lines, sort_order, created_at, updated_at FROM log_sources`

// ListLogSources 列出已保存日志源。
func (s *Store) ListLogSources() ([]model.LogSourceDO, error) {
	rows, err := s.db.Query(logSourceSelectSQL + ` ORDER BY sort_order ASC, updated_at DESC`)
	if err != nil {
		return nil, errno.Wrap(errno.CodeStoreFailed, "读取日志源列表失败", err)
	}
	defer rows.Close()
	var out []model.LogSourceDO
	for rows.Next() {
		var r model.LogSourceDO
		if err := rows.Scan(
			&r.ID, &r.Name, &r.SourceType, &r.Path, &r.SSHHostID, &r.DockerContextID,
			&r.ContainerID, &r.ComposeDir, &r.ComposeService, &r.TailLines, &r.SortOrder, &r.CreatedAt, &r.UpdatedAt,
		); err != nil {
			return nil, errno.Wrap(errno.CodeStoreFailed, "读取日志源列表失败", err)
		}
		out = append(out, r)
	}
	return out, rows.Err()
}

// GetLogSource 按 ID 获取日志源。
func (s *Store) GetLogSource(id string) (*model.LogSourceDO, error) {
	var r model.LogSourceDO
	err := s.db.QueryRow(logSourceSelectSQL+` WHERE id = ?`, id).Scan(
		&r.ID, &r.Name, &r.SourceType, &r.Path, &r.SSHHostID, &r.DockerContextID,
		&r.ContainerID, &r.ComposeDir, &r.ComposeService, &r.TailLines, &r.SortOrder, &r.CreatedAt, &r.UpdatedAt,
	)
	if err == sql.ErrNoRows {
		return nil, errno.New(errno.CodeNotFound, "日志源不存在", id)
	}
	if err != nil {
		return nil, errno.Wrap(errno.CodeStoreFailed, "读取日志源失败", err)
	}
	return &r, nil
}

// SaveLogSource 保存日志源。
func (s *Store) SaveLogSource(r model.LogSourceDO) error {
	now := time.Now().Unix()
	if r.ID == "" {
		r.ID = uuid.NewString()
		r.CreatedAt = now
	}
	r.UpdatedAt = now
	if r.TailLines <= 0 {
		r.TailLines = 200
	}
	_, err := s.db.Exec(`INSERT INTO log_sources (id, name, source_type, path, ssh_host_id, docker_context_id, container_id, compose_dir, compose_service, tail_lines, sort_order, created_at, updated_at)
		VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
		ON CONFLICT(id) DO UPDATE SET
			name=excluded.name, source_type=excluded.source_type, path=excluded.path,
			ssh_host_id=excluded.ssh_host_id, docker_context_id=excluded.docker_context_id,
			container_id=excluded.container_id, compose_dir=excluded.compose_dir, compose_service=excluded.compose_service,
			tail_lines=excluded.tail_lines, sort_order=excluded.sort_order, updated_at=excluded.updated_at`,
		r.ID, r.Name, r.SourceType, r.Path, r.SSHHostID, r.DockerContextID,
		r.ContainerID, r.ComposeDir, r.ComposeService, r.TailLines, r.SortOrder, r.CreatedAt, r.UpdatedAt)
	if err != nil {
		return errno.Wrap(errno.CodeStoreFailed, "保存日志源失败", err)
	}
	return nil
}

// DeleteLogSource 删除日志源。
func (s *Store) DeleteLogSource(id string) error {
	res, err := s.db.Exec(`DELETE FROM log_sources WHERE id = ?`, id)
	if err != nil {
		return errno.Wrap(errno.CodeStoreFailed, "删除日志源失败", err)
	}
	n, _ := res.RowsAffected()
	if n == 0 {
		return errno.New(errno.CodeNotFound, "日志源不存在", id)
	}
	return nil
}
