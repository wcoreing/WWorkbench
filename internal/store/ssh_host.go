package store

import (
	"database/sql"
	"time"

	"WNavicat/internal/errno"
	"WNavicat/internal/model"
)

const sshHostSelectSQL = `SELECT id, name, host, port, user_name, password_enc, key_path, created_at, updated_at FROM ssh_hosts`

// scanSSHHost 扫描一行 SSH 主机并解密密码。
func (s *Store) scanSSHHost(
	id, name, host, user, pwdEnc, keyPath string,
	port int,
	createdAt, updatedAt int64,
) (model.SSHHostDO, error) {
	h := model.SSHHostDO{
		ID: id, Name: name, Host: host, Port: port, User: user,
		KeyPath: keyPath, CreatedAt: createdAt, UpdatedAt: updatedAt,
	}
	if pwdEnc != "" {
		pwd, err := s.encryptor.Decrypt(pwdEnc)
		if err != nil {
			return h, errno.Wrap(errno.CodeStoreFailed, "解密 SSH 密码失败", err)
		}
		h.Password = pwd
	}
	return h, nil
}

// ListSSHHosts 列出 SSH 主机。
func (s *Store) ListSSHHosts() ([]model.SSHHostDO, error) {
	rows, err := s.db.Query(sshHostSelectSQL + ` ORDER BY updated_at DESC`)
	if err != nil {
		return nil, errno.Wrap(errno.CodeStoreFailed, "查询 SSH 主机失败", err)
	}
	defer rows.Close()
	var list []model.SSHHostDO
	for rows.Next() {
		var id, name, host, user, pwdEnc, keyPath string
		var port int
		var createdAt, updatedAt int64
		if err := rows.Scan(&id, &name, &host, &port, &user, &pwdEnc, &keyPath, &createdAt, &updatedAt); err != nil {
			return nil, errno.Wrap(errno.CodeStoreFailed, "读取 SSH 主机失败", err)
		}
		h, err := s.scanSSHHost(id, name, host, user, pwdEnc, keyPath, port, createdAt, updatedAt)
		if err != nil {
			return nil, err
		}
		list = append(list, h)
	}
	if err := rows.Err(); err != nil {
		return nil, errno.Wrap(errno.CodeStoreFailed, "查询 SSH 主机失败", err)
	}
	return list, nil
}

// GetSSHHost 按 ID 获取 SSH 主机。
func (s *Store) GetSSHHost(id string) (*model.SSHHostDO, error) {
	row := s.db.QueryRow(sshHostSelectSQL+` WHERE id = ?`, id)
	var hid, name, host, user, pwdEnc, keyPath string
	var port int
	var createdAt, updatedAt int64
	if err := row.Scan(&hid, &name, &host, &port, &user, &pwdEnc, &keyPath, &createdAt, &updatedAt); err != nil {
		if err == sql.ErrNoRows {
			return nil, errno.New(errno.CodeNotFound, "SSH 主机不存在", id)
		}
		return nil, errno.Wrap(errno.CodeStoreFailed, "读取 SSH 主机失败", err)
	}
	h, err := s.scanSSHHost(hid, name, host, user, pwdEnc, keyPath, port, createdAt, updatedAt)
	if err != nil {
		return nil, err
	}
	return &h, nil
}

// SaveSSHHost 保存 SSH 主机。
func (s *Store) SaveSSHHost(h model.SSHHostDO) error {
	if h.Name == "" || h.Host == "" || h.User == "" {
		return errno.New(errno.CodeInvalidArg, "名称、主机、用户名不能为空", "")
	}
	if h.Port <= 0 {
		h.Port = 22
	}
	if h.ID == "" {
		return errno.New(errno.CodeInvalidArg, "SSH 主机 ID 不能为空", "")
	}
	now := time.Now().Unix()
	pwdEnc, err := s.encryptor.Encrypt(h.Password)
	if err != nil {
		return errno.Wrap(errno.CodeStoreFailed, "加密密码失败", err)
	}
	if h.CreatedAt == 0 {
		h.CreatedAt = now
	}
	h.UpdatedAt = now
	_, err = s.db.Exec(`INSERT INTO ssh_hosts (id, name, host, port, user_name, password_enc, key_path, created_at, updated_at)
		VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
		ON CONFLICT(id) DO UPDATE SET
		name=excluded.name, host=excluded.host, port=excluded.port,
		user_name=excluded.user_name, password_enc=excluded.password_enc,
		key_path=excluded.key_path, updated_at=excluded.updated_at`,
		h.ID, h.Name, h.Host, h.Port, h.User, pwdEnc, h.KeyPath, h.CreatedAt, h.UpdatedAt)
	if err != nil {
		return errno.Wrap(errno.CodeStoreFailed, "保存 SSH 主机失败", err)
	}
	return nil
}

// DeleteSSHHost 删除 SSH 主机。
func (s *Store) DeleteSSHHost(id string) error {
	_, err := s.db.Exec(`DELETE FROM ssh_hosts WHERE id = ?`, id)
	if err != nil {
		return errno.Wrap(errno.CodeStoreFailed, "删除 SSH 主机失败", err)
	}
	return nil
}
