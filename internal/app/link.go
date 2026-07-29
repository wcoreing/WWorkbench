package app

import (
	"time"

	"WWorkbench/internal/errno"
	"WWorkbench/internal/model"
	"WWorkbench/internal/tunnel"

	"github.com/google/uuid"
)

// EnsureSSHHostFromConnection 为数据库连接解析或创建对应 SSH 主机（用于跨产品跳转）。
func (s *Service) EnsureSSHHostFromConnection(connectionID string) ApiResult[model.SSHHostDO] {
	conn, err := s.conns.Get(connectionID)
	if err != nil {
		return ErrResult[model.SSHHostDO](err)
	}
	if !conn.SSHEnabled {
		return ErrResult[model.SSHHostDO](errno.New(errno.CodeInvalidArg, "连接未启用 SSH 隧道", connectionID))
	}
	if conn.SSHHostID != "" {
		host, err := s.store.GetSSHHost(conn.SSHHostID)
		if err != nil {
			return ErrResult[model.SSHHostDO](err)
		}
		return OkResult(*host)
	}
	if err := tunnel.ResolveConnection(s.store, conn); err != nil {
		return ErrResult[model.SSHHostDO](err)
	}
	hosts, err := s.store.ListSSHHosts()
	if err != nil {
		return ErrResult[model.SSHHostDO](err)
	}
	port := conn.SSHPort
	if port <= 0 {
		port = 22
	}
	for _, h := range hosts {
		if h.Host == conn.SSHHost && h.Port == port && h.User == conn.SSHUser {
			if conn.SSHHostID != h.ID {
				conn.SSHHostID = h.ID
				_ = s.store.SaveConnection(*conn)
			}
			return OkResult(h)
		}
	}
	now := time.Now().Unix()
	host := model.SSHHostDO{
		ID:        uuid.NewString(),
		Name:      conn.Name + " SSH",
		Host:      conn.SSHHost,
		Port:      port,
		User:      conn.SSHUser,
		KeyPath:   conn.SSHKeyPath,
		Password:  conn.SSHPassword,
		CreatedAt: now,
		UpdatedAt: now,
	}
	if err := s.store.SaveSSHHost(host); err != nil {
		return ErrResult[model.SSHHostDO](err)
	}
	conn.SSHHostID = host.ID
	if err := s.store.SaveConnection(*conn); err != nil {
		return ErrResult[model.SSHHostDO](err)
	}
	return OkResult(host)
}
