package app

import (
	"context"
	"strings"
	"time"

	"WWorkbench/internal/aliyuncms"
	"WWorkbench/internal/errno"
	"WWorkbench/internal/model"
	"WWorkbench/internal/session"

	"github.com/google/uuid"
)

// ListCloudAccounts 列出云账号（不含 AccessKey Secret）。
func (s *Service) ListCloudAccounts() ApiResult[[]model.CloudAccountDO] {
	list, err := s.store.ListCloudAccounts()
	if err != nil {
		return ErrResult[[]model.CloudAccountDO](err)
	}
	if list == nil {
		list = []model.CloudAccountDO{}
	}
	for i := range list {
		stripCloudSecret(&list[i])
	}
	return OkResult(list)
}

// SaveCloudAccount 保存阿里云账号。密钥留空则保持已存密钥。
func (s *Service) SaveCloudAccount(a model.CloudAccountDO) ApiResult[model.CloudAccountDO] {
	a.Name = strings.TrimSpace(a.Name)
	a.AccessKeyID = strings.TrimSpace(a.AccessKeyID)
	a.AccessKeySecret = strings.TrimSpace(a.AccessKeySecret)
	a.Provider = "aliyun"
	if a.Name == "" || a.AccessKeyID == "" {
		return ErrResult[model.CloudAccountDO](errno.New(errno.CodeInvalidArg, "请填写账号名称和 AccessKey ID", ""))
	}
	if a.ID == "" {
		a.ID = uuid.NewString()
	}
	if a.AccessKeySecret == "" {
		existing, err := s.store.GetCloudAccount(a.ID)
		if err != nil {
			if ae := errno.Extract(err); ae != nil && ae.Code == errno.CodeNotFound {
				return ErrResult[model.CloudAccountDO](errno.New(errno.CodeInvalidArg, "请填写 AccessKey Secret", ""))
			}
			return ErrResult[model.CloudAccountDO](err)
		}
		a.AccessKeySecret = existing.AccessKeySecret
		if a.CreatedAt == 0 {
			a.CreatedAt = existing.CreatedAt
		}
	}
	if err := s.store.SaveCloudAccount(a); err != nil {
		return ErrResult[model.CloudAccountDO](err)
	}
	saved, err := s.store.GetCloudAccount(a.ID)
	if err != nil {
		return ErrResult[model.CloudAccountDO](err)
	}
	stripCloudSecret(saved)
	return OkResult(*saved)
}

// ListECSInstances 按云账号和地域列出 ECS，供 SSH 主机点选绑定。
func (s *Service) ListECSInstances(accountID, region string) ApiResult[[]model.ECSInstanceDO] {
	accountID = strings.TrimSpace(accountID)
	region = strings.TrimSpace(region)
	if accountID == "" || region == "" {
		return ErrResult[[]model.ECSInstanceDO](errno.New(errno.CodeInvalidArg, "请选择云账号和地域", ""))
	}
	account, err := s.store.GetCloudAccount(accountID)
	if err != nil {
		return ErrResult[[]model.ECSInstanceDO](err)
	}
	parent := s.ctx
	if parent == nil {
		parent = context.Background()
	}
	ctx, cancel := session.WithTimeout(parent, 20)
	defer cancel()
	list, err := aliyuncms.ListInstances(ctx, account.AccessKeyID, account.AccessKeySecret, region)
	if err != nil {
		return ErrResult[[]model.ECSInstanceDO](err)
	}
	if list == nil {
		list = []model.ECSInstanceDO{}
	}
	return OkResult(list)
}

// GetECSMonitor 读取 SSH 主机绑定的 ECS 最近一小时云监控。
func (s *Service) GetECSMonitor(hostID string) ApiResult[model.ECSMonitorDO] {
	hostID = strings.TrimSpace(hostID)
	if hostID == "" {
		return ErrResult[model.ECSMonitorDO](errno.New(errno.CodeInvalidArg, "缺少 SSH 主机", ""))
	}
	host, err := s.sshHosts.Get(hostID)
	if err != nil {
		return ErrResult[model.ECSMonitorDO](err)
	}
	if strings.TrimSpace(host.CloudInstanceID) == "" || strings.TrimSpace(host.CloudAccountID) == "" {
		return ErrResult[model.ECSMonitorDO](errno.New(errno.CodeInvalidArg, "这台主机还没绑定阿里云 ECS", ""))
	}
	account, err := s.store.GetCloudAccount(host.CloudAccountID)
	if err != nil {
		return ErrResult[model.ECSMonitorDO](err)
	}
	parent := s.ctx
	if parent == nil {
		parent = context.Background()
	}
	ctx, cancel := session.WithTimeout(parent, 12)
	defer cancel()
	mon, err := aliyuncms.QueryECS(ctx, account.AccessKeyID, account.AccessKeySecret, host.CloudRegion, host.CloudInstanceID)
	if err != nil {
		return ErrResult[model.ECSMonitorDO](err)
	}
	if mon.Series == nil {
		mon.Series = []model.ECSMetricSeriesDO{}
	}
	if mon.FetchedAt == 0 {
		mon.FetchedAt = time.Now().Unix()
	}
	return OkResult(mon)
}

func stripCloudSecret(a *model.CloudAccountDO) {
	a.HasSecret = strings.TrimSpace(a.AccessKeySecret) != ""
	a.AccessKeySecret = ""
}
