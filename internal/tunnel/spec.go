package tunnel

import (
	"WWorkbench/internal/model"
)

// SpecFromConnection 从连接配置生成隧道规格。
func SpecFromConnection(c model.ConnectionDO) model.TunnelSpecDO {
	port := c.SSHPort
	if port <= 0 {
		port = 22
	}
	return model.TunnelSpecDO{
		Enabled:    c.SSHEnabled,
		Host:       c.SSHHost,
		Port:       port,
		User:       c.SSHUser,
		KeyPath:    c.SSHKeyPath,
		Password:   c.SSHPassword,
		TargetHost: c.Host,
		TargetPort: c.Port,
	}
}
