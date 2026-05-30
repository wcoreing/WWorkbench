package store

import (
	"database/sql"
	"time"

	"WNavicat/internal/errno"
	"WNavicat/internal/model"

	"github.com/google/uuid"
)

const sshForwardSelectSQL = `SELECT id, name, ssh_host_id, local_port, remote_host, remote_port, created_at, updated_at FROM ssh_forward_presets`

// ListSSHForwardPresets 列出 SSH 端口转发预设。
func (s *Store) ListSSHForwardPresets() ([]model.SSHForwardPresetDO, error) {
	rows, err := s.db.Query(sshForwardSelectSQL + ` ORDER BY updated_at DESC`)
	if err != nil {
		return nil, errno.Wrap(errno.CodeStoreFailed, "读取端口转发预设失败", err)
	}
	defer rows.Close()
	var out []model.SSHForwardPresetDO
	for rows.Next() {
		var p model.SSHForwardPresetDO
		if err := rows.Scan(&p.ID, &p.Name, &p.SSHHostID, &p.LocalPort, &p.RemoteHost, &p.RemotePort, &p.CreatedAt, &p.UpdatedAt); err != nil {
			return nil, errno.Wrap(errno.CodeStoreFailed, "读取端口转发预设失败", err)
		}
		out = append(out, p)
	}
	return out, rows.Err()
}

// GetSSHForwardPreset 按 ID 获取预设。
func (s *Store) GetSSHForwardPreset(id string) (*model.SSHForwardPresetDO, error) {
	var p model.SSHForwardPresetDO
	err := s.db.QueryRow(sshForwardSelectSQL+` WHERE id = ?`, id).Scan(
		&p.ID, &p.Name, &p.SSHHostID, &p.LocalPort, &p.RemoteHost, &p.RemotePort, &p.CreatedAt, &p.UpdatedAt,
	)
	if err == sql.ErrNoRows {
		return nil, errno.New(errno.CodeNotFound, "端口转发预设不存在", id)
	}
	if err != nil {
		return nil, errno.Wrap(errno.CodeStoreFailed, "读取端口转发预设失败", err)
	}
	return &p, nil
}

// SaveSSHForwardPreset 保存 SSH 端口转发预设。
func (s *Store) SaveSSHForwardPreset(p model.SSHForwardPresetDO) error {
	now := time.Now().Unix()
	if p.ID == "" {
		p.ID = uuid.NewString()
		p.CreatedAt = now
	}
	p.UpdatedAt = now
	_, err := s.db.Exec(`INSERT INTO ssh_forward_presets (id, name, ssh_host_id, local_port, remote_host, remote_port, created_at, updated_at)
		VALUES (?, ?, ?, ?, ?, ?, ?, ?)
		ON CONFLICT(id) DO UPDATE SET
			name=excluded.name, ssh_host_id=excluded.ssh_host_id, local_port=excluded.local_port,
			remote_host=excluded.remote_host, remote_port=excluded.remote_port, updated_at=excluded.updated_at`,
		p.ID, p.Name, p.SSHHostID, p.LocalPort, p.RemoteHost, p.RemotePort, p.CreatedAt, p.UpdatedAt)
	if err != nil {
		return errno.Wrap(errno.CodeStoreFailed, "保存端口转发预设失败", err)
	}
	return nil
}

// DeleteSSHForwardPreset 删除预设。
func (s *Store) DeleteSSHForwardPreset(id string) error {
	res, err := s.db.Exec(`DELETE FROM ssh_forward_presets WHERE id = ?`, id)
	if err != nil {
		return errno.Wrap(errno.CodeStoreFailed, "删除端口转发预设失败", err)
	}
	n, _ := res.RowsAffected()
	if n == 0 {
		return errno.New(errno.CodeNotFound, "端口转发预设不存在", id)
	}
	return nil
}
