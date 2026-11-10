package app

import (
	"encoding/json"
	"strings"

	"WWorkbench/internal/errno"
	"WWorkbench/internal/model"
	"WWorkbench/internal/workbench"
	"WWorkbench/internal/workbenchtools"

	"github.com/google/uuid"
)

func (s *Service) syncBackupCronNote(p model.BackupPolicyDO) string {
	if s.toolsRegistry == nil {
		return ""
	}
	note, err := workbenchtools.SyncBackupCron(s.ctx, s.toolsRegistry.Deps(), p)
	if err != nil {
		return "crontab 同步失败: " + err.Error()
	}
	return note
}

// ListBackupPolicies 列出备份策略资产。
func (s *Service) ListBackupPolicies() ApiResult[[]model.BackupPolicyDO] {
	list, err := s.store.ListBackupPolicies()
	if err != nil {
		return ErrResult[[]model.BackupPolicyDO](err)
	}
	if list == nil {
		list = []model.BackupPolicyDO{}
	}
	return OkResult(list)
}

// SaveBackupPolicy 保存备份策略。
func (s *Service) SaveBackupPolicy(p model.BackupPolicyDO) ApiResult[model.BackupPolicyDO] {
	kind := strings.ToLower(strings.TrimSpace(p.Kind))
	switch kind {
	case model.BackupKindFiles, model.BackupKindSQLite, model.BackupKindDB:
		p.Kind = kind
	default:
		return ErrResult[model.BackupPolicyDO](errno.New(errno.CodeInvalidArg, "kind 须为 files | sqlite | db", ""))
	}
	if strings.TrimSpace(p.Name) == "" {
		return ErrResult[model.BackupPolicyDO](errno.New(errno.CodeInvalidArg, "name 不能为空", ""))
	}
	op := workbench.RadarOpUpdate
	if strings.TrimSpace(p.ID) == "" {
		op = workbench.RadarOpCreate
		p.ID = uuid.NewString()
	}
	if kind == model.BackupKindDB {
		if strings.TrimSpace(p.ConnectionID) == "" {
			return ErrResult[model.BackupPolicyDO](errno.New(errno.CodeInvalidArg, "db 策略须提供 connectionId", ""))
		}
	} else if !strings.HasPrefix(strings.TrimSpace(p.Path), "/") {
		return ErrResult[model.BackupPolicyDO](errno.New(errno.CodeInvalidArg, "files/sqlite 须提供绝对路径", ""))
	}
	if strings.TrimSpace(p.DestRoot) == "" {
		p.DestRoot = "/www/backup/wworkbench"
	}
	p.CronExpr = strings.TrimSpace(p.CronExpr)
	if msg := workbenchtools.ValidateCronExpr(p.CronExpr); msg != "" {
		return ErrResult[model.BackupPolicyDO](errno.New(errno.CodeInvalidArg, msg, ""))
	}
	saved, err := s.store.SaveBackupPolicy(p)
	if err != nil {
		return ErrResult[model.BackupPolicyDO](err)
	}
	if note := s.syncBackupCronNote(saved); note != "" && strings.HasPrefix(note, "crontab 同步失败") {
		return ErrResult[model.BackupPolicyDO](errno.New(errno.CodeUnknown, note, saved.ID))
	}
	if s.radar != nil {
		s.radar.EmitAsset(workbench.RadarDomainBackupPolicy, "backup", op, saved.ID, "ui-backup-save", saved.Name, true)
	}
	return OkResult(saved)
}

// DeleteBackupPolicy 删除备份策略。
func (s *Service) DeleteBackupPolicy(id string) ApiResult[bool] {
	id = strings.TrimSpace(id)
	var existing *model.BackupPolicyDO
	if cur, err := s.store.GetBackupPolicy(id); err == nil {
		existing = cur
	}
	if err := s.store.DeleteBackupPolicy(id); err != nil {
		return ErrResult[bool](err)
	}
	if existing != nil && s.toolsRegistry != nil {
		_ = workbenchtools.RemoveBackupCron(s.ctx, s.toolsRegistry.Deps(), *existing)
	}
	if s.radar != nil {
		s.radar.EmitAsset(workbench.RadarDomainBackupPolicy, "backup", workbench.RadarOpDelete, id, "ui-backup-delete", "", false)
	}
	return OkResult(true)
}

// ListBackupRuns 列出备份执行记录（先同步远端 cron 产物到本地记录）。
func (s *Service) ListBackupRuns(policyID string, limit int) ApiResult[[]model.BackupRunDO] {
	if s.toolsRegistry != nil {
		_ = workbenchtools.SyncBackupRunsFromRemote(s.ctx, s.toolsRegistry.Deps(), strings.TrimSpace(policyID))
	}
	list, err := s.store.ListBackupRuns(policyID, limit)
	if err != nil {
		return ErrResult[[]model.BackupRunDO](err)
	}
	if list == nil {
		list = []model.BackupRunDO{}
	}
	return OkResult(list)
}

// RunBackupPolicy 界面确认后执行备份（不再弹 MCP 确认门）。
func (s *Service) RunBackupPolicy(policyID, intent string, force bool) ApiResult[map[string]interface{}] {
	if s.toolsRegistry == nil {
		return ErrResult[map[string]interface{}](errno.New(errno.CodeInvalidArg, "工具注册表未就绪", ""))
	}
	res := workbenchtools.RunBackupNow(s.ctx, s.toolsRegistry.Deps(), strings.TrimSpace(policyID), strings.TrimSpace(intent), force)
	if !res.OK {
		return ErrResult[map[string]interface{}](errno.New(errno.CodeUnknown, res.Error, ""))
	}
	var data map[string]interface{}
	if len(res.Data) > 0 {
		_ = json.Unmarshal(res.Data, &data)
	}
	if data == nil {
		data = map[string]interface{}{"ok": true}
	}
	return OkResult(data)
}
