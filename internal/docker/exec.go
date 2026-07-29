package docker

import (
	"context"

	"WWorkbench/internal/errno"

	"github.com/docker/docker/api/types"
	"github.com/docker/docker/api/types/container"
)

// ExecSession 交互式 docker exec 会话。
type ExecSession struct {
	ExecID string
	Conn   types.HijackedResponse
	Handle *ClientHandle
}

// Close 关闭 exec 会话与 Docker 客户端。
func (s *ExecSession) Close() {
	if s == nil {
		return
	}
	_ = s.Conn.CloseWrite()
	s.Conn.Close()
	if s.Handle != nil {
		s.Handle.Close()
		s.Handle = nil
	}
}

// AttachExec 在容器内启动交互式 Shell（TTY）。
// attach 使用独立 context，避免 OpenTerminal 的 timeout cancel 掐断 hijack 流。
func (m *Manager) AttachExec(ctx context.Context, contextID, containerID string, cols, rows int) (*ExecSession, error) {
	if cols <= 0 {
		cols = 80
	}
	if rows <= 0 {
		rows = 24
	}
	handle, err := m.OpenClient(ctx, contextID)
	if err != nil {
		return nil, err
	}
	cli := handle.API()
	inspect, err := cli.ContainerInspect(ctx, containerID)
	if err != nil {
		handle.Close()
		return nil, errno.Wrap(errno.CodeConnFailed, "读取容器信息失败", err)
	}
	if inspect.State == nil || !inspect.State.Running {
		handle.Close()
		return nil, errno.New(errno.CodeInvalidArg, "容器未运行", containerID)
	}

	shell := resolveExecShell(ctx, cli, containerID)
	create, err := cli.ContainerExecCreate(ctx, containerID, container.ExecOptions{
		AttachStdin:  true,
		AttachStdout: true,
		AttachStderr: true,
		Tty:          true,
		Cmd:          []string{shell},
		ConsoleSize:  &[2]uint{uint(rows), uint(cols)},
	})
	if err != nil {
		handle.Close()
		return nil, errno.Wrap(errno.CodeConnFailed, "创建容器 Exec 失败", err)
	}

	// hijack 生命周期跟会话走，不能绑带 timeout 的 dial ctx
	hj, err := cli.ContainerExecAttach(context.Background(), create.ID, container.ExecAttachOptions{
		Tty:         true,
		ConsoleSize: &[2]uint{uint(rows), uint(cols)},
	})
	if err != nil {
		handle.Close()
		return nil, errno.Wrap(errno.CodeConnFailed, "附着容器 Exec 失败", err)
	}
	return &ExecSession{
		ExecID: create.ID,
		Conn:   hj,
		Handle: handle,
	}, nil
}

// resolveExecShell 选择容器内可用 Shell。
// 注意：不能用 `exec bash || exec sh`——busybox/ash 在 exec 失败时直接退出(127)，不会走 ||。
func resolveExecShell(ctx context.Context, cli interface {
	ContainerExecCreate(ctx context.Context, container string, options container.ExecOptions) (container.ExecCreateResponse, error)
	ContainerExecStart(ctx context.Context, execID string, config container.ExecStartOptions) error
	ContainerExecInspect(ctx context.Context, execID string) (container.ExecInspect, error)
}, containerID string) string {
	for _, sh := range []string{"/bin/bash", "/bin/sh", "bash", "sh"} {
		create, err := cli.ContainerExecCreate(ctx, containerID, container.ExecOptions{
			AttachStdout: true,
			AttachStderr: true,
			Cmd:          []string{sh, "-c", "exit 0"},
		})
		if err != nil {
			continue
		}
		if err := cli.ContainerExecStart(ctx, create.ID, container.ExecStartOptions{}); err != nil {
			continue
		}
		insp, err := cli.ContainerExecInspect(ctx, create.ID)
		if err != nil {
			continue
		}
		if insp.ExitCode == 0 {
			return sh
		}
	}
	return "/bin/sh"
}

// ResizeExec 调整容器 Exec TTY 尺寸。
func (m *Manager) ResizeExec(ctx context.Context, handle *ClientHandle, execID string, cols, rows int) error {
	if handle == nil || handle.API() == nil {
		return errno.New(errno.CodeSessionClosed, "Docker 客户端已关闭", execID)
	}
	if cols <= 0 {
		cols = 80
	}
	if rows <= 0 {
		rows = 24
	}
	err := handle.API().ContainerExecResize(context.Background(), execID, container.ResizeOptions{
		Height: uint(rows),
		Width:  uint(cols),
	})
	if err != nil {
		return errno.Wrap(errno.CodeConnFailed, "调整容器终端尺寸失败", err)
	}
	return nil
}
