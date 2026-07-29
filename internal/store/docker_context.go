package store

import (
	"database/sql"
	"time"

	"WWorkbench/internal/errno"
	"WWorkbench/internal/model"
)

const dockerContextSelectSQL = `SELECT id, name, kind, ssh_host_id, created_at, updated_at FROM docker_contexts`

// ListDockerContexts 列出已保存的 Docker 上下文（不含本地虚拟上下文）。
func (s *Store) ListDockerContexts() ([]model.DockerContextDO, error) {
	rows, err := s.db.Query(dockerContextSelectSQL + ` ORDER BY updated_at DESC`)
	if err != nil {
		return nil, errno.Wrap(errno.CodeStoreFailed, "查询 Docker 上下文失败", err)
	}
	defer rows.Close()
	var list []model.DockerContextDO
	for rows.Next() {
		var id, name, kind, sshHostID string
		var createdAt, updatedAt int64
		if err := rows.Scan(&id, &name, &kind, &sshHostID, &createdAt, &updatedAt); err != nil {
			return nil, errno.Wrap(errno.CodeStoreFailed, "读取 Docker 上下文失败", err)
		}
		list = append(list, model.DockerContextDO{
			ID:        id,
			Name:      name,
			Kind:      kind,
			SSHHostID: sshHostID,
			Endpoint:  sshDockerEndpoint(sshHostID),
		})
	}
	if err := rows.Err(); err != nil {
		return nil, errno.Wrap(errno.CodeStoreFailed, "查询 Docker 上下文失败", err)
	}
	return list, nil
}

// GetDockerContext 按 ID 获取 Docker 上下文。
func (s *Store) GetDockerContext(id string) (*model.DockerContextDO, error) {
	row := s.db.QueryRow(dockerContextSelectSQL+` WHERE id = ?`, id)
	var cid, name, kind, sshHostID string
	var createdAt, updatedAt int64
	if err := row.Scan(&cid, &name, &kind, &sshHostID, &createdAt, &updatedAt); err != nil {
		if err == sql.ErrNoRows {
			return nil, errno.New(errno.CodeNotFound, "Docker 上下文不存在", id)
		}
		return nil, errno.Wrap(errno.CodeStoreFailed, "读取 Docker 上下文失败", err)
	}
	return &model.DockerContextDO{
		ID:        cid,
		Name:      name,
		Kind:      kind,
		SSHHostID: sshHostID,
		Endpoint:  sshDockerEndpoint(sshHostID),
	}, nil
}

// SaveDockerContext 保存 SSH Docker 上下文。
func (s *Store) SaveDockerContext(c model.DockerContextDO) error {
	if c.ID == "" {
		return errno.New(errno.CodeInvalidArg, "Docker 上下文 ID 不能为空", "")
	}
	if c.Name == "" {
		return errno.New(errno.CodeInvalidArg, "Docker 上下文名称不能为空", "")
	}
	if c.SSHHostID == "" {
		return errno.New(errno.CodeInvalidArg, "请选择 SSH 主机", "")
	}
	if _, err := s.GetSSHHost(c.SSHHostID); err != nil {
		return err
	}
	if c.Kind == "" {
		c.Kind = "ssh"
	}
	now := time.Now().Unix()
	_, _ = s.db.Exec(`DELETE FROM docker_contexts WHERE ssh_host_id = ? AND id != ?`, c.SSHHostID, c.ID)
	_, err := s.db.Exec(`INSERT INTO docker_contexts (id, name, kind, ssh_host_id, created_at, updated_at)
		VALUES (?, ?, ?, ?, ?, ?)
		ON CONFLICT(id) DO UPDATE SET
		name=excluded.name, kind=excluded.kind, ssh_host_id=excluded.ssh_host_id, updated_at=excluded.updated_at`,
		c.ID, c.Name, c.Kind, c.SSHHostID, now, now)
	if err != nil {
		return errno.Wrap(errno.CodeStoreFailed, "保存 Docker 上下文失败", err)
	}
	return nil
}

// DeleteDockerContext 删除 Docker 上下文。
func (s *Store) DeleteDockerContext(id string) error {
	res, err := s.db.Exec(`DELETE FROM docker_contexts WHERE id = ?`, id)
	if err != nil {
		return errno.Wrap(errno.CodeStoreFailed, "删除 Docker 上下文失败", err)
	}
	n, err := res.RowsAffected()
	if err != nil {
		return errno.Wrap(errno.CodeStoreFailed, "删除 Docker 上下文失败", err)
	}
	if n == 0 {
		return errno.New(errno.CodeNotFound, "Docker 上下文不存在", id)
	}
	return nil
}

// sshDockerEndpoint 生成 SSH Docker 端点展示文案。
func sshDockerEndpoint(sshHostID string) string {
	if sshHostID == "" {
		return ""
	}
	return "ssh+docker://" + sshHostID
}
