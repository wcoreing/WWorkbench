package tunnel

import (
	"WWorkbench/internal/errno"
	"WWorkbench/internal/model"
	"WWorkbench/internal/store"
)

// ResolveConnection 解析连接 SSH 配置（引用已保存 SSH 主机时填充隧道字段）。
func ResolveConnection(st *store.Store, c *model.ConnectionDO) error {
	if !c.SSHEnabled {
		return nil
	}
	if c.SSHHostID == "" {
		return ValidateConnectionSSH(*c)
	}
	h, err := st.GetSSHHost(c.SSHHostID)
	if err != nil {
		return err
	}
	c.SSHHost = h.Host
	c.SSHPort = h.Port
	if c.SSHPort <= 0 {
		c.SSHPort = 22
	}
	c.SSHUser = h.User
	c.SSHKeyPath = h.KeyPath
	c.SSHPassword = h.Password
	return ValidateConnectionSSH(*c)
}

// ValidateConnectionSSH 启用 SSH 时校验隧道字段。
func ValidateConnectionSSH(c model.ConnectionDO) error {
	if !c.SSHEnabled {
		return nil
	}
	if c.SSHHostID != "" {
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
