package store

import (
	"database/sql"
	"encoding/json"
	"time"

	"WNavicat/internal/errno"
	"WNavicat/internal/model"
)

const envPresetSelectSQL = `SELECT id, name, active, runtimes_json, created_at, updated_at FROM env_presets`

// ListEnvPresets 列出环境预设。
func (s *Store) ListEnvPresets() ([]model.EnvPresetDO, error) {
	rows, err := s.db.Query(envPresetSelectSQL + ` ORDER BY updated_at DESC`)
	if err != nil {
		return nil, errno.Wrap(errno.CodeStoreFailed, "查询环境预设失败", err)
	}
	defer rows.Close()
	var list []model.EnvPresetDO
	for rows.Next() {
		item, err := scanEnvPreset(rows.Scan)
		if err != nil {
			return nil, err
		}
		list = append(list, item)
	}
	if err := rows.Err(); err != nil {
		return nil, errno.Wrap(errno.CodeStoreFailed, "查询环境预设失败", err)
	}
	return list, nil
}

// GetEnvPreset 按 ID 获取环境预设。
func (s *Store) GetEnvPreset(id string) (*model.EnvPresetDO, error) {
	row := s.db.QueryRow(envPresetSelectSQL+` WHERE id = ?`, id)
	var idVal, name, runtimesJSON string
	var active int
	var createdAt, updatedAt int64
	if err := row.Scan(&idVal, &name, &active, &runtimesJSON, &createdAt, &updatedAt); err != nil {
		if err == sql.ErrNoRows {
			return nil, errno.New(errno.CodeNotFound, "环境预设不存在", id)
		}
		return nil, errno.Wrap(errno.CodeStoreFailed, "读取环境预设失败", err)
	}
	return decodeEnvPreset(idVal, name, active == 1, runtimesJSON), nil
}

// SaveEnvPreset 保存环境预设。
func (s *Store) SaveEnvPreset(p model.EnvPresetDO) error {
	if p.ID == "" {
		return errno.New(errno.CodeInvalidArg, "预设 ID 不能为空", "")
	}
	if p.Name == "" {
		return errno.New(errno.CodeInvalidArg, "预设名称不能为空", "")
	}
	if p.Runtimes == nil {
		p.Runtimes = map[string]string{}
	}
	raw, err := json.Marshal(p.Runtimes)
	if err != nil {
		return errno.Wrap(errno.CodeStoreFailed, "序列化环境预设失败", err)
	}
	now := time.Now().Unix()
	if p.Active {
		if _, err := s.db.Exec(`UPDATE env_presets SET active = 0`); err != nil {
			return errno.Wrap(errno.CodeStoreFailed, "更新环境预设失败", err)
		}
	}
	_, err = s.db.Exec(`INSERT INTO env_presets (id, name, active, runtimes_json, created_at, updated_at)
		VALUES (?, ?, ?, ?, ?, ?)
		ON CONFLICT(id) DO UPDATE SET
		name=excluded.name, active=excluded.active, runtimes_json=excluded.runtimes_json, updated_at=excluded.updated_at`,
		p.ID, p.Name, boolToInt(p.Active), string(raw), now, now)
	if err != nil {
		return errno.Wrap(errno.CodeStoreFailed, "保存环境预设失败", err)
	}
	return nil
}

// DeleteEnvPreset 删除环境预设。
func (s *Store) DeleteEnvPreset(id string) error {
	res, err := s.db.Exec(`DELETE FROM env_presets WHERE id = ?`, id)
	if err != nil {
		return errno.Wrap(errno.CodeStoreFailed, "删除环境预设失败", err)
	}
	n, err := res.RowsAffected()
	if err != nil {
		return errno.Wrap(errno.CodeStoreFailed, "删除环境预设失败", err)
	}
	if n == 0 {
		return errno.New(errno.CodeNotFound, "环境预设不存在", id)
	}
	return nil
}

// scanEnvPreset 扫描环境预设行。
func scanEnvPreset(scan func(dest ...any) error) (model.EnvPresetDO, error) {
	var id, name, runtimesJSON string
	var active int
	var createdAt, updatedAt int64
	if err := scan(&id, &name, &active, &runtimesJSON, &createdAt, &updatedAt); err != nil {
		return model.EnvPresetDO{}, errno.Wrap(errno.CodeStoreFailed, "读取环境预设失败", err)
	}
	return *decodeEnvPreset(id, name, active == 1, runtimesJSON), nil
}

// decodeEnvPreset 解码环境预设。
func decodeEnvPreset(id, name string, active bool, runtimesJSON string) *model.EnvPresetDO {
	runtimes := map[string]string{}
	_ = json.Unmarshal([]byte(runtimesJSON), &runtimes)
	return &model.EnvPresetDO{
		ID:       id,
		Name:     name,
		Active:   active,
		Runtimes: runtimes,
	}
}
