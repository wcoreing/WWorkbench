package store

import (
	"database/sql"
	"strings"
	"time"

	"WWorkbench/internal/errno"
	"WWorkbench/internal/model"
)

const sshHostSelectSQL = `SELECT id, name, host, port, user_name, password_enc, key_path,
	cloud_account_id, cloud_region, cloud_instance_id,
	sg_sync, sg_id, sg_last_cidr, sg_synced_at,
	created_at, updated_at FROM ssh_hosts`

// scanSSHHost 扫描一行 SSH 主机并解密密码。
// 密文损坏时仍返回台账字段（Password 空、HasPassword=true），避免整表 List 失败导致云同步漏主机。
func (s *Store) scanSSHHost(
	id, name, host, user, pwdEnc, keyPath, cloudAccountID, cloudRegion, cloudInstanceID string,
	sgSync int, sgID, sgLastCIDR string, sgSyncedAt int64,
	port int,
	createdAt, updatedAt int64,
) (model.SSHHostDO, error) {
	h := model.SSHHostDO{
		ID: id, Name: name, Host: host, Port: port, User: user,
		KeyPath: keyPath, CloudAccountID: cloudAccountID, CloudRegion: cloudRegion,
		CloudInstanceID: cloudInstanceID,
		SgSync:          sgSync != 0, SgID: sgID, SgLastCIDR: sgLastCIDR, SgSyncedAt: sgSyncedAt,
		CreatedAt: createdAt, UpdatedAt: updatedAt,
	}
	if pwdEnc != "" {
		h.HasPassword = true
		pwd, err := s.encryptor.Decrypt(pwdEnc)
		if err != nil {
			return h, nil
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
		var id, name, host, user, pwdEnc, keyPath, cloudAccountID, cloudRegion, cloudInstanceID string
		var sgID, sgLastCIDR string
		var sgSync int
		var sgSyncedAt, createdAt, updatedAt int64
		var port int
		if err := rows.Scan(&id, &name, &host, &port, &user, &pwdEnc, &keyPath,
			&cloudAccountID, &cloudRegion, &cloudInstanceID,
			&sgSync, &sgID, &sgLastCIDR, &sgSyncedAt,
			&createdAt, &updatedAt); err != nil {
			return nil, errno.Wrap(errno.CodeStoreFailed, "读取 SSH 主机失败", err)
		}
		h, err := s.scanSSHHost(id, name, host, user, pwdEnc, keyPath, cloudAccountID, cloudRegion, cloudInstanceID,
			sgSync, sgID, sgLastCIDR, sgSyncedAt, port, createdAt, updatedAt)
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
	var hid, name, host, user, pwdEnc, keyPath, cloudAccountID, cloudRegion, cloudInstanceID string
	var sgID, sgLastCIDR string
	var sgSync int
	var sgSyncedAt, createdAt, updatedAt int64
	var port int
	if err := row.Scan(&hid, &name, &host, &port, &user, &pwdEnc, &keyPath,
		&cloudAccountID, &cloudRegion, &cloudInstanceID,
		&sgSync, &sgID, &sgLastCIDR, &sgSyncedAt,
		&createdAt, &updatedAt); err != nil {
		if err == sql.ErrNoRows {
			return nil, errno.New(errno.CodeNotFound, "SSH 主机不存在", id)
		}
		return nil, errno.Wrap(errno.CodeStoreFailed, "读取 SSH 主机失败", err)
	}
	h, err := s.scanSSHHost(hid, name, host, user, pwdEnc, keyPath, cloudAccountID, cloudRegion, cloudInstanceID,
		sgSync, sgID, sgLastCIDR, sgSyncedAt, port, createdAt, updatedAt)
	if err != nil {
		return nil, err
	}
	return &h, nil
}

func sgSyncInt(v bool) int {
	if v {
		return 1
	}
	return 0
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
	_, err = s.db.Exec(`INSERT INTO ssh_hosts (id, name, host, port, user_name, password_enc, key_path,
		cloud_account_id, cloud_region, cloud_instance_id,
		sg_sync, sg_id, sg_last_cidr, sg_synced_at,
		created_at, updated_at)
		VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
		ON CONFLICT(id) DO UPDATE SET
		name=excluded.name, host=excluded.host, port=excluded.port,
		user_name=excluded.user_name, password_enc=excluded.password_enc,
		key_path=excluded.key_path, cloud_account_id=excluded.cloud_account_id,
		cloud_region=excluded.cloud_region, cloud_instance_id=excluded.cloud_instance_id,
		sg_sync=excluded.sg_sync, sg_id=excluded.sg_id,
		sg_last_cidr=excluded.sg_last_cidr, sg_synced_at=excluded.sg_synced_at,
		updated_at=excluded.updated_at`,
		h.ID, h.Name, h.Host, h.Port, h.User, pwdEnc, h.KeyPath,
		h.CloudAccountID, h.CloudRegion, h.CloudInstanceID,
		sgSyncInt(h.SgSync), h.SgID, h.SgLastCIDR, h.SgSyncedAt,
		h.CreatedAt, h.UpdatedAt)
	if err != nil {
		return errno.Wrap(errno.CodeStoreFailed, "保存 SSH 主机失败", err)
	}
	return nil
}

// SaveSSHHostLedger 云同步写入台账：更新元数据，不覆盖本机已有 password_enc / 安全组同步状态。
func (s *Store) SaveSSHHostLedger(h model.SSHHostDO) error {
	h.Name = strings.TrimSpace(h.Name)
	h.Host = strings.TrimSpace(h.Host)
	h.User = strings.TrimSpace(h.User)
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
	if h.CreatedAt == 0 {
		h.CreatedAt = now
	}
	h.UpdatedAt = now
	_, err := s.db.Exec(`INSERT INTO ssh_hosts (id, name, host, port, user_name, password_enc, key_path,
		cloud_account_id, cloud_region, cloud_instance_id,
		sg_sync, sg_id, sg_last_cidr, sg_synced_at,
		created_at, updated_at)
		VALUES (?, ?, ?, ?, ?, '', ?, ?, ?, ?, 0, '', '', 0, ?, ?)
		ON CONFLICT(id) DO UPDATE SET
		name=excluded.name, host=excluded.host, port=excluded.port,
		user_name=excluded.user_name,
		key_path=CASE WHEN excluded.key_path = '' THEN ssh_hosts.key_path ELSE excluded.key_path END,
		cloud_account_id=excluded.cloud_account_id,
		cloud_region=excluded.cloud_region, cloud_instance_id=excluded.cloud_instance_id,
		updated_at=excluded.updated_at`,
		h.ID, h.Name, h.Host, h.Port, h.User, h.KeyPath,
		h.CloudAccountID, h.CloudRegion, h.CloudInstanceID, h.CreatedAt, h.UpdatedAt)
	if err != nil {
		return errno.Wrap(errno.CodeStoreFailed, "同步 SSH 主机台账失败", err)
	}
	return nil
}

// UpdateSSHHostSGSyncState 只更新安全组同步后的本机 IP / 安全组记录。
func (s *Store) UpdateSSHHostSGSyncState(id, sgID, lastCIDR string, syncedAt int64) error {
	id = strings.TrimSpace(id)
	if id == "" {
		return errno.New(errno.CodeInvalidArg, "SSH 主机 ID 不能为空", "")
	}
	_, err := s.db.Exec(
		`UPDATE ssh_hosts SET sg_id = CASE WHEN ? != '' THEN ? ELSE sg_id END, sg_last_cidr = ?, sg_synced_at = ?, updated_at = ? WHERE id = ?`,
		strings.TrimSpace(sgID), strings.TrimSpace(sgID), strings.TrimSpace(lastCIDR), syncedAt, time.Now().Unix(), id,
	)
	if err != nil {
		return errno.Wrap(errno.CodeStoreFailed, "更新安全组同步状态失败", err)
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
