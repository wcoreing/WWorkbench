package store

import (
	"database/sql"

	"WNavicat/internal/errno"
)

// 应用设置键名。
const (
	SettingTheme              = "theme"
	SettingActiveProduct      = "active_product"
	SettingTerminalOpacity    = "terminal_opacity"
	SettingLastConnectionID   = "last_connection_id"
	SettingLastDockerContext  = "last_docker_context_id"
)

// GetAppSetting 读取单项应用设置。
func (s *Store) GetAppSetting(key string) (string, error) {
	var value string
	err := s.db.QueryRow(`SELECT value FROM app_settings WHERE key = ?`, key).Scan(&value)
	if err == sql.ErrNoRows {
		return "", nil
	}
	if err != nil {
		return "", errno.Wrap(errno.CodeStoreFailed, "读取应用设置失败", err)
	}
	return value, nil
}

// SetAppSetting 写入单项应用设置。
func (s *Store) SetAppSetting(key, value string) error {
	_, err := s.db.Exec(`INSERT INTO app_settings (key, value) VALUES (?, ?)
		ON CONFLICT(key) DO UPDATE SET value=excluded.value`, key, value)
	if err != nil {
		return errno.Wrap(errno.CodeStoreFailed, "保存应用设置失败", err)
	}
	return nil
}

// ListAppSettings 列出全部应用设置。
func (s *Store) ListAppSettings() (map[string]string, error) {
	rows, err := s.db.Query(`SELECT key, value FROM app_settings`)
	if err != nil {
		return nil, errno.Wrap(errno.CodeStoreFailed, "读取应用设置失败", err)
	}
	defer rows.Close()
	out := map[string]string{}
	for rows.Next() {
		var key, value string
		if err := rows.Scan(&key, &value); err != nil {
			return nil, errno.Wrap(errno.CodeStoreFailed, "读取应用设置失败", err)
		}
		out[key] = value
	}
	if err := rows.Err(); err != nil {
		return nil, errno.Wrap(errno.CodeStoreFailed, "读取应用设置失败", err)
	}
	return out, nil
}
