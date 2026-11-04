package store

import (
	"database/sql"
	"strings"
	"time"

	"WWorkbench/internal/errno"
	"WWorkbench/internal/model"
)

// ListCloudAccounts 列出云账号（含解密后的密钥，供调用方按需剥离）。
func (s *Store) ListCloudAccounts() ([]model.CloudAccountDO, error) {
	rows, err := s.db.Query(`SELECT id, name, provider, access_key_id, access_key_secret_enc, created_at, updated_at
		FROM cloud_accounts ORDER BY updated_at DESC`)
	if err != nil {
		return nil, errno.Wrap(errno.CodeStoreFailed, "查询云账号失败", err)
	}
	defer rows.Close()
	var list []model.CloudAccountDO
	for rows.Next() {
		a, err := s.scanCloudAccount(rows.Scan)
		if err != nil {
			return nil, err
		}
		list = append(list, a)
	}
	if err := rows.Err(); err != nil {
		return nil, errno.Wrap(errno.CodeStoreFailed, "查询云账号失败", err)
	}
	return list, nil
}

// GetCloudAccount 按 ID 获取云账号（含密钥）。
func (s *Store) GetCloudAccount(id string) (*model.CloudAccountDO, error) {
	row := s.db.QueryRow(`SELECT id, name, provider, access_key_id, access_key_secret_enc, created_at, updated_at
		FROM cloud_accounts WHERE id = ?`, id)
	a, err := s.scanCloudAccount(row.Scan)
	if err != nil {
		if err == sql.ErrNoRows {
			return nil, errno.New(errno.CodeNotFound, "云账号不存在", id)
		}
		return nil, err
	}
	return &a, nil
}

type scanner func(dest ...any) error

func (s *Store) scanCloudAccount(scan scanner) (model.CloudAccountDO, error) {
	var a model.CloudAccountDO
	var secretEnc string
	if err := scan(&a.ID, &a.Name, &a.Provider, &a.AccessKeyID, &secretEnc, &a.CreatedAt, &a.UpdatedAt); err != nil {
		if err == sql.ErrNoRows {
			return a, err
		}
		return a, errno.Wrap(errno.CodeStoreFailed, "读取云账号失败", err)
	}
	if secretEnc != "" {
		secret, err := s.encryptor.Decrypt(secretEnc)
		if err != nil {
			return a, errno.Wrap(errno.CodeStoreFailed, "解密云账号密钥失败", err)
		}
		a.AccessKeySecret = secret
	}
	return a, nil
}

// SaveCloudAccount 保存云账号并加密密钥。
func (s *Store) SaveCloudAccount(a model.CloudAccountDO) error {
	if strings.TrimSpace(a.ID) == "" || strings.TrimSpace(a.Name) == "" || strings.TrimSpace(a.AccessKeyID) == "" {
		return errno.New(errno.CodeInvalidArg, "云账号名称和 AccessKey ID 不能为空", "")
	}
	if strings.TrimSpace(a.AccessKeySecret) == "" {
		return errno.New(errno.CodeInvalidArg, "请填写 AccessKey Secret", "")
	}
	if a.Provider == "" {
		a.Provider = "aliyun"
	}
	now := time.Now().Unix()
	secretEnc, err := s.encryptor.Encrypt(a.AccessKeySecret)
	if err != nil {
		return errno.Wrap(errno.CodeStoreFailed, "加密云账号密钥失败", err)
	}
	if a.CreatedAt == 0 {
		a.CreatedAt = now
	}
	a.UpdatedAt = now
	_, err = s.db.Exec(`INSERT INTO cloud_accounts (id, name, provider, access_key_id, access_key_secret_enc, created_at, updated_at)
		VALUES (?, ?, ?, ?, ?, ?, ?)
		ON CONFLICT(id) DO UPDATE SET
		name=excluded.name, provider=excluded.provider, access_key_id=excluded.access_key_id,
		access_key_secret_enc=excluded.access_key_secret_enc, updated_at=excluded.updated_at`,
		a.ID, a.Name, a.Provider, a.AccessKeyID, secretEnc, a.CreatedAt, a.UpdatedAt)
	if err != nil {
		return errno.Wrap(errno.CodeStoreFailed, "保存云账号失败", err)
	}
	return nil
}
