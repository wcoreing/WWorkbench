package tunnel

import (
	"WNavicat/internal/errno"
	"WNavicat/internal/model"
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

// ValidateConnectionSSH 启用 SSH 时校验隧道字段。
func ValidateConnectionSSH(c model.ConnectionDO) error {
	if !c.SSHEnabled {
		return nil
	}
	if c.SSHHost == "" {
		return errno.New(errno.CodeInvalidArg, "请填写 SSH 主机", "")
	}
	if c.SSHUser == "" {
		return errno.New(errno.CodeInvalidArg, "请填写 SSH 用户名", "")
	}
	if c.SSHKeyPath == "" && c.SSHPassword == "" {
		return errno.New(errno.CodeInvalidArg, "请填写 SSH 密码或私钥路径", "")
	}
	return nil
}
