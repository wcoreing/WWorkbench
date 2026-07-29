package terminal

import (
	"context"
	"io"

	"WWorkbench/internal/docker"
	"WWorkbench/internal/errno"
	"WWorkbench/internal/model"

	"github.com/google/uuid"
)

// OpenDocker 打开 Docker 容器终端会话。
func (m *Manager) OpenDocker(ctx context.Context, dockerMgr *docker.Manager, hostID string, cols, rows int) (*model.TerminalSessionInfoDO, error) {
	if dockerMgr == nil {
		return nil, errno.New(errno.CodeInvalidArg, "Docker 管理器未初始化", "")
	}
	host, err := dockerMgr.GetShellHost(hostID)
	if err != nil {
		return nil, err
	}
	exec, err := dockerMgr.AttachExec(ctx, host.ContextID, host.ContainerID, cols, rows)
	if err != nil {
		return nil, err
	}

	sid := uuid.NewString()
	title := docker.ResolveShellTitle(host.ContainerName, host.ContainerID)
	ts := &Session{
		ID:          sid,
		Kind:        kindDocker,
		HostID:      hostID,
		Title:       title,
		stdin:       exec.Conn.Conn,
		dockerExec:  exec,
		dockerMgr:   dockerMgr,
	}
	m.registerSession(ts, execReader(exec), func() { m.finish(sid) })

	return &model.TerminalSessionInfoDO{
		SessionID: sid,
		HostID:    hostID,
		Title:     title,
		Kind:      string(kindDocker),
	}, nil
}

func execReader(exec *docker.ExecSession) io.Reader {
	if exec.Conn.Reader != nil {
		return exec.Conn.Reader
	}
	return exec.Conn.Conn
}
