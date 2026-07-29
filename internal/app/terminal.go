package app

import (
	dockersvc "WWorkbench/internal/docker"
	"WWorkbench/internal/model"
	"WWorkbench/internal/session"
	"WWorkbench/internal/terminal"
	"WWorkbench/internal/tunnel"

	"github.com/wailsapp/wails/v2/pkg/runtime"
)

// ListSSHHosts 列出 SSH 主机（不含密码）。
func (s *Service) ListSSHHosts() ApiResult[[]model.SSHHostDO] {
	list, err := s.sshHosts.List()
	if err != nil {
		return ErrResult[[]model.SSHHostDO](err)
	}
	if list == nil {
		list = []model.SSHHostDO{}
	}
	for i := range list {
		terminal.StripSecrets(&list[i])
	}
	return OkResult(list)
}

// ListShellHosts 列出统一 Shell 主机（SSH + 已注册 Docker 容器）。
func (s *Service) ListShellHosts() ApiResult[[]model.ShellHostDO] {
	sshList, err := s.sshHosts.List()
	if err != nil {
		return ErrResult[[]model.ShellHostDO](err)
	}
	out := make([]model.ShellHostDO, 0, len(sshList)+8)
	for _, h := range sshList {
		terminal.StripSecrets(&h)
		out = append(out, model.ShellHostDO{
			ID:        h.ID,
			Kind:      model.ShellHostKindSSH,
			Name:      h.Name,
			Host:      h.Host,
			Port:      h.Port,
			User:      h.User,
			KeyPath:   h.KeyPath,
			Running:   true,
			CreatedAt: h.CreatedAt,
			UpdatedAt: h.UpdatedAt,
		})
	}
	ctx, cancel := session.WithTimeout(s.ctx, 20)
	defer cancel()
	dockerList, err := s.docker.ListShellHosts(ctx)
	if err != nil {
		return ErrResult[[]model.ShellHostDO](err)
	}
	out = append(out, dockerList...)
	return OkResult(out)
}

// EnsureDockerHost 注册 Docker 容器为 Shell 主机。
func (s *Service) EnsureDockerHost(contextID, containerID string) ApiResult[model.ShellHostDO] {
	ctx, cancel := session.WithTimeout(s.ctx, 15)
	defer cancel()
	host, err := s.docker.EnsureShellHost(ctx, contextID, containerID)
	if err != nil {
		return ErrResult[model.ShellHostDO](err)
	}
	return OkResult(*host)
}

// RemoveDockerHost 从主机列表移除 Docker 容器主机。
func (s *Service) RemoveDockerHost(id string) ApiResult[bool] {
	if err := s.docker.RemoveShellHost(id); err != nil {
		return ErrResult[bool](err)
	}
	return OkResult(true)
}

// PruneStoppedDockerHosts 清理已停止的 Docker 容器主机注册。
func (s *Service) PruneStoppedDockerHosts() ApiResult[int] {
	ctx, cancel := session.WithTimeout(s.ctx, 30)
	defer cancel()
	n, err := s.docker.PruneStoppedShellHosts(ctx)
	if err != nil {
		return ErrResult[int](err)
	}
	return OkResult(n)
}

// GetShellHost 按 ID 获取 Shell 主机。
func (s *Service) GetShellHost(id string) ApiResult[model.ShellHostDO] {
	if dockersvc.IsDockerHostID(id) {
		host, err := s.docker.GetShellHost(id)
		if err != nil {
			return ErrResult[model.ShellHostDO](err)
		}
		return OkResult(*host)
	}
	h, err := s.sshHosts.Get(id)
	if err != nil {
		return ErrResult[model.ShellHostDO](err)
	}
	terminal.StripSecrets(h)
	return OkResult(model.ShellHostDO{
		ID:        h.ID,
		Kind:      model.ShellHostKindSSH,
		Name:      h.Name,
		Host:      h.Host,
		Port:      h.Port,
		User:      h.User,
		Password:  h.Password,
		KeyPath:   h.KeyPath,
		CreatedAt: h.CreatedAt,
		UpdatedAt: h.UpdatedAt,
	})
}

// GetSSHHost 获取 SSH 主机详情（含密码，仅供编辑）。
func (s *Service) GetSSHHost(id string) ApiResult[model.SSHHostDO] {
	h, err := s.sshHosts.Get(id)
	if err != nil {
		return ErrResult[model.SSHHostDO](err)
	}
	return OkResult(*h)
}

// SaveSSHHost 保存 SSH 主机。
func (s *Service) SaveSSHHost(h model.SSHHostDO) ApiResult[model.SSHHostDO] {
	out, err := s.sshHosts.Save(h)
	if err != nil {
		return ErrResult[model.SSHHostDO](err)
	}
	terminal.StripSecrets(out)
	return OkResult(*out)
}

// DeleteSSHHost 删除 SSH 主机。
func (s *Service) DeleteSSHHost(id string) ApiResult[bool] {
	if err := s.sshHosts.Delete(id); err != nil {
		return ErrResult[bool](err)
	}
	return OkResult(true)
}

// TestSSHHost 测试 SSH 连接。
func (s *Service) TestSSHHost(h model.SSHHostDO) ApiResult[bool] {
	ctx, cancel := session.WithTimeout(s.ctx, 15)
	defer cancel()
	if err := s.sshHosts.Test(ctx, h); err != nil {
		return ErrResult[bool](err)
	}
	return OkResult(true)
}

// TrustSSHHost 信任 SSH 主机密钥（测试连接遇未知密钥后调用）。
func (s *Service) TrustSSHHost(host string, port int) ApiResult[bool] {
	if err := tunnel.TrustSSHHost(host, port); err != nil {
		return ErrResult[bool](err)
	}
	return OkResult(true)
}

// OpenTerminal 打开终端会话（SSH 或 Docker 容器）。
func (s *Service) OpenTerminal(hostID string, cols, rows int) ApiResult[model.TerminalSessionInfoDO] {
	ctx, cancel := session.WithTimeout(s.ctx, 30)
	defer cancel()
	var (
		info *model.TerminalSessionInfoDO
		err  error
	)
	if dockersvc.IsDockerHostID(hostID) {
		info, err = s.terminals.OpenDocker(ctx, s.docker, hostID, cols, rows)
	} else {
		info, err = s.terminals.Open(ctx, hostID, cols, rows)
	}
	if err != nil {
		return ErrResult[model.TerminalSessionInfoDO](err)
	}
	return OkResult(*info)
}

// OpenLocalTerminal 打开本机 Shell 终端。
func (s *Service) OpenLocalTerminal(cols, rows int) ApiResult[model.TerminalSessionInfoDO] {
	info, err := s.terminals.OpenLocal(cols, rows)
	if err != nil {
		return ErrResult[model.TerminalSessionInfoDO](err)
	}
	return OkResult(*info)
}

// CloseTerminal 关闭 SSH 终端会话。
func (s *Service) CloseTerminal(sessionID string) ApiResult[bool] {
	if err := s.terminals.Close(sessionID); err != nil {
		return ErrResult[bool](err)
	}
	return OkResult(true)
}

// WriteTerminal 向终端写入输入。
func (s *Service) WriteTerminal(sessionID, data string) ApiResult[bool] {
	if err := s.terminals.Write(sessionID, data); err != nil {
		return ErrResult[bool](err)
	}
	return OkResult(true)
}

// ResizeTerminal 调整终端尺寸。
func (s *Service) ResizeTerminal(sessionID string, cols, rows int) ApiResult[bool] {
	if err := s.terminals.Resize(sessionID, cols, rows); err != nil {
		return ErrResult[bool](err)
	}
	return OkResult(true)
}

// wireTerminalEvents 注册终端事件推送。
func (s *Service) wireTerminalEvents() {
	s.terminals.SetHandlers(
		func(sessionID, data string) {
			runtime.EventsEmit(s.ctx, "terminal:output", map[string]string{
				"sessionId": sessionID,
				"data":      data,
			})
		},
		func(sessionID string) {
			runtime.EventsEmit(s.ctx, "terminal:closed", map[string]string{
				"sessionId": sessionID,
			})
		},
	)
}
