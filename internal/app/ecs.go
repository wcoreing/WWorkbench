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

// GetECSMonitor 读取 SSH 主机绑定的 ECS 云监控。windowHours：1 / 6 / 24 / 168。
func (s *Service) GetECSMonitor(hostID string, windowHours int) ApiResult[model.ECSMonitorDO] {
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
	ctx, cancel := session.WithTimeout(parent, 20)
	defer cancel()
	mon, err := aliyuncms.QueryECS(ctx, account.AccessKeyID, account.AccessKeySecret, host.CloudRegion, host.CloudInstanceID, windowHours)
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

// GetOSSMonitor 读取 SSH 主机同账号、同地域的 OSS 带宽云监控（内网+公网汇总）。
func (s *Service) GetOSSMonitor(hostID string, windowHours int) ApiResult[model.OSSMonitorDO] {
	hostID = strings.TrimSpace(hostID)
	if hostID == "" {
		return ErrResult[model.OSSMonitorDO](errno.New(errno.CodeInvalidArg, "缺少 SSH 主机", ""))
	}
	host, err := s.sshHosts.Get(hostID)
	if err != nil {
		return ErrResult[model.OSSMonitorDO](err)
	}
	if strings.TrimSpace(host.CloudAccountID) == "" || strings.TrimSpace(host.CloudRegion) == "" {
		return ErrResult[model.OSSMonitorDO](errno.New(errno.CodeInvalidArg, "这台主机还没绑定阿里云账号和地域", ""))
	}
	account, err := s.store.GetCloudAccount(host.CloudAccountID)
	if err != nil {
		return ErrResult[model.OSSMonitorDO](err)
	}
	parent := s.ctx
	if parent == nil {
		parent = context.Background()
	}
	ctx, cancel := session.WithTimeout(parent, 25)
	defer cancel()
	mon, err := aliyuncms.QueryOSS(ctx, account.AccessKeyID, account.AccessKeySecret, host.CloudRegion, windowHours)
	if err != nil {
		return ErrResult[model.OSSMonitorDO](err)
	}
	if mon.Series == nil {
		mon.Series = []model.ECSMetricSeriesDO{}
	}
	if mon.FetchedAt == 0 {
		mon.FetchedAt = time.Now().Unix()
	}
	return OkResult(mon)
}

// SyncSSHHostSecurityGroup 把本机公网 IP 写入主机绑定 ECS 的安全组（SSH 端口）。
// 需要 AccessKey 具备 AuthorizeSecurityGroup / RevokeSecurityGroup。
func (s *Service) SyncSSHHostSecurityGroup(hostID string) ApiResult[model.SecurityGroupSyncResultDO] {
	out, err := s.syncSSHHostSecurityGroup(strings.TrimSpace(hostID))
	if err != nil {
		return ErrResult[model.SecurityGroupSyncResultDO](err)
	}
	return OkResult(out)
}

// syncSSHHostSGIfEnabled 主机勾了 sgSync 时，连接前尽力同步本机 IP；失败不阻断连接。
func (s *Service) syncSSHHostSGIfEnabled(hostID string) {
	hostID = strings.TrimSpace(hostID)
	if hostID == "" {
		return
	}
	host, err := s.sshHosts.Get(hostID)
	if err != nil || host == nil || !host.SgSync {
		return
	}
	_, _ = s.syncSSHHostSecurityGroup(hostID)
}

func (s *Service) syncSSHHostSecurityGroup(hostID string) (model.SecurityGroupSyncResultDO, error) {
	var zero model.SecurityGroupSyncResultDO
	if hostID == "" {
		return zero, errno.New(errno.CodeInvalidArg, "缺少 SSH 主机", "")
	}
	host, err := s.sshHosts.Get(hostID)
	if err != nil {
		return zero, err
	}
	if strings.TrimSpace(host.CloudInstanceID) == "" || strings.TrimSpace(host.CloudAccountID) == "" {
		return zero, errno.New(errno.CodeInvalidArg, "先绑定阿里云 ECS，才能同步安全组", "")
	}
	account, err := s.store.GetCloudAccount(host.CloudAccountID)
	if err != nil {
		return zero, err
	}
	parent := s.ctx
	if parent == nil {
		parent = context.Background()
	}
	ctx, cancel := session.WithTimeout(parent, 20)
	defer cancel()
	res, err := aliyuncms.SyncHomeIPToSecurityGroup(
		ctx,
		account.AccessKeyID, account.AccessKeySecret,
		host.CloudRegion, host.CloudInstanceID, host.SgID,
		host.Port, host.SgLastCIDR,
	)
	if err != nil {
		return zero, err
	}
	out := model.SecurityGroupSyncResultDO{
		PublicIP: res.PublicIP, CIDR: res.CIDR, SecurityGroup: res.SecurityGroup,
		Port: res.Port, Skipped: res.Skipped, RevokedOldCIDR: res.RevokedOldCIDR, Message: res.Message,
	}
	if res.CIDR != "" {
		_ = s.store.UpdateSSHHostSGSyncState(host.ID, res.SecurityGroup, res.CIDR, time.Now().Unix())
	}
	return out, nil
}

func stripCloudSecret(a *model.CloudAccountDO) {
	a.HasSecret = strings.TrimSpace(a.AccessKeySecret) != ""
	a.AccessKeySecret = ""
}
