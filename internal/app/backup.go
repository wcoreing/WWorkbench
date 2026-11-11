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
	res := s.DeleteBackupPolicies([]string{id})
	if !res.Ok {
		if res.Error != nil {
			return ErrResult[bool](res.Error)
		}
		return ErrResult[bool](errno.New(errno.CodeUnknown, "删除备份策略失败", id))
	}
	return OkResult(true)
}

// DeleteBackupPolicies 批量删除备份策略：先落库删完，再卸 crontab 并删除远端 .ww-cron 脚本。
func (s *Service) DeleteBackupPolicies(ids []string) ApiResult[map[string]interface{}] {
	uniq := make([]string, 0, len(ids))
	seen := map[string]struct{}{}
	for _, id := range ids {
		id = strings.TrimSpace(id)
		if id == "" {
			continue
		}
		if _, ok := seen[id]; ok {
			continue
		}
		seen[id] = struct{}{}
		uniq = append(uniq, id)
	}
	if len(uniq) == 0 {
		return OkResult(map[string]interface{}{"deleted": 0, "requested": 0})
	}

	toClean := make([]model.BackupPolicyDO, 0, len(uniq))
	for _, id := range uniq {
		cur, err := s.store.GetBackupPolicy(id)
		if err != nil || cur == nil {
			continue
		}
		if strings.TrimSpace(cur.SSHHostID) == "" {
			continue
		}
		toClean = append(toClean, *cur)
	}

	deleted, err := s.store.DeleteBackupPolicies(uniq)
	if err != nil {
		return ErrResult[map[string]interface{}](err)
	}

	cronErrors := []string{}
	if s.toolsRegistry != nil && len(toClean) > 0 {
		if cerr := workbenchtools.RemoveBackupCrons(s.ctx, s.toolsRegistry.Deps(), toClean); cerr != nil {
			cronErrors = append(cronErrors, cerr.Error())
		}
	}
	if s.radar != nil && deleted > 0 {
		s.radar.EmitAsset(workbench.RadarDomainBackupPolicy, "backup", workbench.RadarOpDelete, strings.Join(uniq, ","), "ui-backup-delete", "", false)
	}
	out := map[string]interface{}{
		"deleted":   deleted,
		"requested": len(uniq),
	}
	if len(cronErrors) > 0 {
		out["cronErrors"] = cronErrors
		out["note"] = "策略已删除；部分主机 crontab/脚本清理失败，可稍后在该机手动检查"
	}
	return OkResult(out)
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

// ScanHostHealth 在指定工作目录扫描可备份资产（只读）。
func (s *Service) ScanHostHealth(sshHostID, workDir string) ApiResult[model.HostHealthReportDO] {
	if s.toolsRegistry == nil {
		return ErrResult[model.HostHealthReportDO](errno.New(errno.CodeInvalidArg, "工具注册表未就绪", ""))
	}
	report, err := workbenchtools.ScanHostHealth(s.ctx, s.toolsRegistry.Deps(), strings.TrimSpace(sshHostID), strings.TrimSpace(workDir))
	if err != nil {
		return ErrResult[model.HostHealthReportDO](err)
	}
	return OkResult(report)
}

// EnsureHostBackupPolicies 仅为勾选的扫描项创建备份策略。
func (s *Service) EnsureHostBackupPolicies(sshHostID, workDir string, findingIDs []string, withCron bool) ApiResult[model.EnsureHostBackupResultDO] {
	if s.toolsRegistry == nil {
		return ErrResult[model.EnsureHostBackupResultDO](errno.New(errno.CodeInvalidArg, "工具注册表未就绪", ""))
	}
	out, err := workbenchtools.EnsureHostBackupPolicies(
		s.ctx,
		s.toolsRegistry.Deps(),
		strings.TrimSpace(sshHostID),
		strings.TrimSpace(workDir),
		findingIDs,
		withCron,
	)
	if err != nil {
		return ErrResult[model.EnsureHostBackupResultDO](err)
	}
	return OkResult(out)
}
