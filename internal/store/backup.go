package store

import (
	"database/sql"
	"strings"
	"time"

	"WWorkbench/internal/errno"
	"WWorkbench/internal/model"

	"github.com/google/uuid"
)

const backupPolicySelectSQL = `SELECT id, name, kind, ssh_host_id, connection_id, path, dest_root, before_write, retain_days, retain_count, cron_expr, enabled, created_at, updated_at FROM backup_policies`

const backupRunSelectSQL = `SELECT id, policy_id, trigger, status, dest_path, detail, intent, created_at FROM backup_runs`

func scanBackupPolicy(scanner interface {
	Scan(dest ...any) error
}) (model.BackupPolicyDO, error) {
	var p model.BackupPolicyDO
	var before, enabled int
	err := scanner.Scan(
		&p.ID, &p.Name, &p.Kind, &p.SSHHostID, &p.ConnectionID, &p.Path, &p.DestRoot,
		&before, &p.RetainDays, &p.RetainCount, &p.CronExpr, &enabled, &p.CreatedAt, &p.UpdatedAt,
	)
	if err != nil {
		return p, err
	}
	p.BeforeWrite = before != 0
	p.Enabled = enabled != 0
	return p, nil
}

// ListBackupPolicies 列出备份策略。
func (s *Store) ListBackupPolicies() ([]model.BackupPolicyDO, error) {
	rows, err := s.db.Query(backupPolicySelectSQL + ` ORDER BY updated_at DESC`)
	if err != nil {
		return nil, errno.Wrap(errno.CodeStoreFailed, "读取备份策略失败", err)
	}
	defer rows.Close()
	var out []model.BackupPolicyDO
	for rows.Next() {
		p, err := scanBackupPolicy(rows)
		if err != nil {
			return nil, errno.Wrap(errno.CodeStoreFailed, "读取备份策略失败", err)
		}
		out = append(out, p)
	}
	return out, rows.Err()
}

// GetBackupPolicy 按 ID 取策略。
func (s *Store) GetBackupPolicy(id string) (*model.BackupPolicyDO, error) {
	row := s.db.QueryRow(backupPolicySelectSQL+` WHERE id = ?`, id)
	p, err := scanBackupPolicy(row)
	if err == sql.ErrNoRows {
		return nil, errno.New(errno.CodeNotFound, "备份策略不存在", id)
	}
	if err != nil {
		return nil, errno.Wrap(errno.CodeStoreFailed, "读取备份策略失败", err)
	}
	return &p, nil
}

// SaveBackupPolicy 保存备份策略。
func (s *Store) SaveBackupPolicy(p model.BackupPolicyDO) (model.BackupPolicyDO, error) {
	now := time.Now().Unix()
	if strings.TrimSpace(p.ID) == "" {
		p.ID = uuid.NewString()
		p.CreatedAt = now
	}
	p.UpdatedAt = now
	if p.RetainDays < 0 {
		p.RetainDays = 0
	}
	if p.RetainCount < 0 {
		p.RetainCount = 0
	}
	// 按天优先：有 retain_days 时清空按份数，避免双规则打架。
	if p.RetainDays > 0 {
		p.RetainCount = 0
	}
	p.CronExpr = strings.TrimSpace(p.CronExpr)
	before, enabled := 0, 0
	if p.BeforeWrite {
		before = 1
	}
	if p.Enabled {
		enabled = 1
	}
	_, err := s.db.Exec(`INSERT INTO backup_policies (
		id, name, kind, ssh_host_id, connection_id, path, dest_root, before_write, retain_days, retain_count, cron_expr, enabled, created_at, updated_at
	) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
	ON CONFLICT(id) DO UPDATE SET
		name=excluded.name, kind=excluded.kind, ssh_host_id=excluded.ssh_host_id, connection_id=excluded.connection_id,
		path=excluded.path, dest_root=excluded.dest_root, before_write=excluded.before_write,
		retain_days=excluded.retain_days, retain_count=excluded.retain_count, cron_expr=excluded.cron_expr, enabled=excluded.enabled, updated_at=excluded.updated_at`,
		p.ID, p.Name, p.Kind, p.SSHHostID, p.ConnectionID, p.Path, p.DestRoot,
		before, p.RetainDays, p.RetainCount, p.CronExpr, enabled, p.CreatedAt, p.UpdatedAt)
	if err != nil {
		return p, errno.Wrap(errno.CodeStoreFailed, "保存备份策略失败", err)
	}
	return p, nil
}

// DeleteBackupPolicy 删除策略（不删历史 runs）。
func (s *Store) DeleteBackupPolicy(id string) error {
	res, err := s.db.Exec(`DELETE FROM backup_policies WHERE id = ?`, id)
	if err != nil {
		return errno.Wrap(errno.CodeStoreFailed, "删除备份策略失败", err)
	}
	n, _ := res.RowsAffected()
	if n == 0 {
		return errno.New(errno.CodeNotFound, "备份策略不存在", id)
	}
	return nil
}

// InsertBackupRun 写入一次备份记录。
func (s *Store) InsertBackupRun(r model.BackupRunDO) (model.BackupRunDO, error) {
	if strings.TrimSpace(r.ID) == "" {
		r.ID = uuid.NewString()
	}
	if r.CreatedAt == 0 {
		r.CreatedAt = time.Now().Unix()
	}
	_, err := s.db.Exec(`INSERT INTO backup_runs (id, policy_id, trigger, status, dest_path, detail, intent, created_at)
		VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
		r.ID, r.PolicyID, r.Trigger, r.Status, r.DestPath, r.Detail, r.Intent, r.CreatedAt)
	if err != nil {
		return r, errno.Wrap(errno.CodeStoreFailed, "写入备份记录失败", err)
	}
	return r, nil
}

// ListBackupRuns 列出近期执行记录；policyID 空则跨策略。
func (s *Store) ListBackupRuns(policyID string, limit int) ([]model.BackupRunDO, error) {
	if limit <= 0 {
		limit = 30
	}
	var (
		rows *sql.Rows
		err  error
	)
	if strings.TrimSpace(policyID) == "" {
		rows, err = s.db.Query(backupRunSelectSQL+` ORDER BY created_at DESC LIMIT ?`, limit)
	} else {
		rows, err = s.db.Query(backupRunSelectSQL+` WHERE policy_id = ? ORDER BY created_at DESC LIMIT ?`, policyID, limit)
	}
	if err != nil {
		return nil, errno.Wrap(errno.CodeStoreFailed, "读取备份记录失败", err)
	}
	defer rows.Close()
	var out []model.BackupRunDO
	for rows.Next() {
		var r model.BackupRunDO
		if err := rows.Scan(&r.ID, &r.PolicyID, &r.Trigger, &r.Status, &r.DestPath, &r.Detail, &r.Intent, &r.CreatedAt); err != nil {
			return nil, errno.Wrap(errno.CodeStoreFailed, "读取备份记录失败", err)
		}
		out = append(out, r)
	}
	return out, rows.Err()
}

// LatestOKBackupRun 最近一次成功备份。
func (s *Store) LatestOKBackupRun(policyID string) (*model.BackupRunDO, error) {
	row := s.db.QueryRow(backupRunSelectSQL+` WHERE policy_id = ? AND status = 'ok' ORDER BY created_at DESC LIMIT 1`, policyID)
	var r model.BackupRunDO
	err := row.Scan(&r.ID, &r.PolicyID, &r.Trigger, &r.Status, &r.DestPath, &r.Detail, &r.Intent, &r.CreatedAt)
	if err == sql.ErrNoRows {
		return nil, nil
	}
	if err != nil {
		return nil, errno.Wrap(errno.CodeStoreFailed, "读取备份记录失败", err)
	}
	return &r, nil
}
