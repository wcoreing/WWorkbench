package store

import (
	"database/sql"
	"time"

	"WWorkbench/internal/errno"
	"WWorkbench/internal/model"
)

const dockerShellHostSelectSQL = `SELECT id, context_id, container_id, name, image, created_at, updated_at FROM docker_shell_hosts`

// ListDockerShellHosts 列出已注册的 Docker 容器主机。
func (s *Store) ListDockerShellHosts() ([]model.DockerShellHostDO, error) {
	rows, err := s.db.Query(dockerShellHostSelectSQL + ` ORDER BY updated_at DESC`)
	if err != nil {
		return nil, errno.Wrap(errno.CodeStoreFailed, "查询 Docker Shell 主机失败", err)
	}
	defer rows.Close()
	var list []model.DockerShellHostDO
	for rows.Next() {
		var h model.DockerShellHostDO
		if err := rows.Scan(&h.ID, &h.ContextID, &h.ContainerID, &h.Name, &h.Image, &h.CreatedAt, &h.UpdatedAt); err != nil {
			return nil, errno.Wrap(errno.CodeStoreFailed, "读取 Docker Shell 主机失败", err)
		}
		list = append(list, h)
	}
	if err := rows.Err(); err != nil {
		return nil, errno.Wrap(errno.CodeStoreFailed, "查询 Docker Shell 主机失败", err)
	}
	return list, nil
}

// GetDockerShellHost 按 ID 获取 Docker 容器主机。
func (s *Store) GetDockerShellHost(id string) (*model.DockerShellHostDO, error) {
	row := s.db.QueryRow(dockerShellHostSelectSQL+` WHERE id = ?`, id)
	var h model.DockerShellHostDO
	if err := row.Scan(&h.ID, &h.ContextID, &h.ContainerID, &h.Name, &h.Image, &h.CreatedAt, &h.UpdatedAt); err != nil {
		if err == sql.ErrNoRows {
			return nil, errno.New(errno.CodeNotFound, "Docker Shell 主机不存在", id)
		}
		return nil, errno.Wrap(errno.CodeStoreFailed, "读取 Docker Shell 主机失败", err)
	}
	return &h, nil
}

// SaveDockerShellHost 保存 Docker 容器主机。
func (s *Store) SaveDockerShellHost(h model.DockerShellHostDO) error {
	if h.ID == "" || h.ContextID == "" || h.ContainerID == "" {
		return errno.New(errno.CodeInvalidArg, "Docker Shell 主机参数不完整", "")
	}
	if h.Name == "" {
		h.Name = h.ContainerID
		if len(h.Name) > 12 {
			h.Name = h.Name[:12]
		}
	}
	now := time.Now().Unix()
	if h.CreatedAt == 0 {
		h.CreatedAt = now
	}
	h.UpdatedAt = now
	_, err := s.db.Exec(`INSERT INTO docker_shell_hosts (id, context_id, container_id, name, image, created_at, updated_at)
		VALUES (?, ?, ?, ?, ?, ?, ?)
		ON CONFLICT(id) DO UPDATE SET
		context_id=excluded.context_id, container_id=excluded.container_id,
		name=excluded.name, image=excluded.image, updated_at=excluded.updated_at`,
		h.ID, h.ContextID, h.ContainerID, h.Name, h.Image, h.CreatedAt, h.UpdatedAt)
	if err != nil {
		return errno.Wrap(errno.CodeStoreFailed, "保存 Docker Shell 主机失败", err)
	}
	return nil
}

// DeleteDockerShellHost 删除已注册的 Docker 容器主机。
func (s *Store) DeleteDockerShellHost(id string) error {
	_, err := s.db.Exec(`DELETE FROM docker_shell_hosts WHERE id = ?`, id)
	if err != nil {
		return errno.Wrap(errno.CodeStoreFailed, "删除 Docker Shell 主机失败", err)
	}
	return nil
}
