package conn

import (
	"context"

	"WNavicat/internal/adapter"
	"WNavicat/internal/errno"
	"WNavicat/internal/model"
	"WNavicat/internal/session"
	"WNavicat/internal/store"
	"WNavicat/internal/tunnel"

	"github.com/google/uuid"
)

// Service 连接服务。
type Service struct {
	store    *store.Store
	registry *adapter.Registry
	tunnel   tunnel.Provider
}

// NewService 创建连接服务。
func NewService(st *store.Store, registry *adapter.Registry, tp tunnel.Provider) *Service {
	return &Service{store: st, registry: registry, tunnel: tp}
}

// List 列出连接（含敏感字段，仅供内部使用）。
func (s *Service) List() ([]model.ConnectionDO, error) {
	return s.store.ListConnections()
}

// Get 按 ID 获取连接（含敏感字段）。
func (s *Service) Get(id string) (*model.ConnectionDO, error) {
	return s.store.GetConnection(id)
}

// Save 保存连接。
func (s *Service) Save(c model.ConnectionDO) (*model.ConnectionDO, error) {
	if c.ID == "" {
		c.ID = uuid.NewString()
	}
	if c.DbType == "" {
		c.DbType = "mysql"
	}
	if err := tunnel.ValidateConnectionSSH(c); err != nil {
		return nil, err
	}
	cCopy := c
	if err := tunnel.ResolveConnection(s.store, &cCopy); err != nil {
		return nil, err
	}
	if err := s.store.SaveConnection(c); err != nil {
		return nil, err
	}
	return &c, nil
}

// Delete 删除连接。
func (s *Service) Delete(id string) error {
	return s.store.DeleteConnection(id)
}

// Test 测试连接。
func (s *Service) Test(ctx context.Context, c model.ConnectionDO) error {
	if c.DbType == "" {
		c.DbType = "mysql"
	}
	if c.Port <= 0 {
		c.Port = 3306
	}
	if err := tunnel.ValidateConnectionSSH(c); err != nil {
		return err
	}
	cCopy := c
	if err := tunnel.ResolveConnection(s.store, &cCopy); err != nil {
		return err
	}
	ad, err := s.registry.Get(c.DbType)
	if err != nil {
		return err
	}
	spec := tunnel.SpecFromConnection(cCopy)
	tun, err := s.tunnel.Dial(ctx, spec, cCopy.Host, cCopy.Port)
	if err != nil {
		return err
	}
	defer tun.Close()
	cfg := model.ConnectionConfigDO{
		DbType:   cCopy.DbType,
		Host:     cCopy.Host,
		Port:     cCopy.Port,
		User:     cCopy.User,
		Password: cCopy.Password,
		Database: cCopy.Database,
		Charset:  cCopy.Charset,
		Tunnel:   spec,
	}
	db, err := ad.Open(ctx, cfg, tun)
	if err != nil {
		return err
	}
	defer db.Close()
	return ad.Ping(ctx, db)
}

// StripSecrets 清除连接中的敏感字段（用于 API 列表响应）。
func StripSecrets(c *model.ConnectionDO) {
	c.Password = ""
	c.SSHPassword = ""
}

// SessionRef 会话引用类型别名，供其他包使用。
type SessionRef = session.Session

// ValidateSessionID 校验会话 ID。
func ValidateSessionID(sessionID string) error {
	if sessionID == "" {
		return errno.New(errno.CodeInvalidArg, "sessionId 不能为空", "")
	}
	return nil
}
