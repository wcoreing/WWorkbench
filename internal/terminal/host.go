package terminal

import (
	"context"

	"WNavicat/internal/errno"
	"WNavicat/internal/model"
	"WNavicat/internal/store"
	"WNavicat/internal/tunnel"

	"github.com/google/uuid"
)

// HostService SSH 主机配置服务。
type HostService struct {
	store *store.Store
}

// NewHostService 创建 SSH 主机服务。
func NewHostService(st *store.Store) *HostService {
	return &HostService{store: st}
}

// List 列出 SSH 主机。
func (s *HostService) List() ([]model.SSHHostDO, error) {
	return s.store.ListSSHHosts()
}

// Get 按 ID 获取 SSH 主机。
func (s *HostService) Get(id string) (*model.SSHHostDO, error) {
	return s.store.GetSSHHost(id)
}

// mergeSecrets 编辑时合并已保存的密码。
func (s *HostService) mergeSecrets(h model.SSHHostDO) (model.SSHHostDO, error) {
	if h.Password != "" || h.ID == "" {
		return h, nil
	}
	existing, err := s.store.GetSSHHost(h.ID)
	if err != nil {
		return h, err
	}
	h.Password = existing.Password
	return h, nil
}

// Save 保存 SSH 主机。
func (s *HostService) Save(h model.SSHHostDO) (*model.SSHHostDO, error) {
	if h.ID == "" {
		h.ID = uuid.NewString()
	}
	var err error
	h, err = s.mergeSecrets(h)
	if err != nil {
		return nil, err
	}
	if err := ValidateSSHHost(h); err != nil {
		return nil, err
	}
	if err := s.store.SaveSSHHost(h); err != nil {
		return nil, err
	}
	return &h, nil
}

// Delete 删除 SSH 主机。
func (s *HostService) Delete(id string) error {
	return s.store.DeleteSSHHost(id)
}

// Test 测试 SSH 连接。
func (s *HostService) Test(ctx context.Context, h model.SSHHostDO) error {
	var err error
	h, err = s.mergeSecrets(h)
	if err != nil {
		return err
	}
	if err := ValidateSSHHost(h); err != nil {
		return err
	}
	client, err := tunnel.DialSSH(ctx, HostToSpec(h))
	if err != nil {
		return err
	}
	defer client.Close()
	sess, err := client.NewSession()
	if err != nil {
		return errno.Wrap(errno.CodeConnFailed, "创建 SSH 会话失败", err)
	}
	defer sess.Close()
	return sess.Run("echo ok")
}

// StripSecrets 清除敏感字段。
func StripSecrets(h *model.SSHHostDO) {
	h.Password = ""
}

// ValidateSSHHost 校验 SSH 主机配置。
func ValidateSSHHost(h model.SSHHostDO) error {
	if h.Host == "" {
		return errno.New(errno.CodeInvalidArg, "请填写 SSH 主机", "")
	}
	if h.User == "" {
		return errno.New(errno.CodeInvalidArg, "请填写 SSH 用户名", "")
	}
	if h.KeyPath == "" && h.Password == "" {
		return errno.New(errno.CodeInvalidArg, "请填写 SSH 密码或私钥路径", "")
	}
	return nil
}

// HostToSpec 将 SSH 主机转为隧道规格。
func HostToSpec(h model.SSHHostDO) model.TunnelSpecDO {
	port := h.Port
	if port <= 0 {
		port = 22
	}
	return model.TunnelSpecDO{
		Enabled:  true,
		Host:     h.Host,
		Port:     port,
		User:     h.User,
		KeyPath:  h.KeyPath,
		Password: h.Password,
	}
}
