package docker

import (
	"context"
	"fmt"
	"strings"
	"time"

	"WWorkbench/internal/errno"
	"WWorkbench/internal/model"

	"github.com/docker/docker/client"
)

const dockerHostIDPrefix = "docker:"

// ShellHostID 生成 Docker 容器 Shell 主机 ID。
func ShellHostID(contextID, containerID string) string {
	return dockerHostIDPrefix + contextID + ":" + containerID
}

// ParseShellHostID 解析 Docker 容器 Shell 主机 ID。
func ParseShellHostID(id string) (contextID, containerID string, ok bool) {
	if !strings.HasPrefix(id, dockerHostIDPrefix) {
		return "", "", false
	}
	rest := strings.TrimPrefix(id, dockerHostIDPrefix)
	i := strings.Index(rest, ":")
	if i <= 0 || i >= len(rest)-1 {
		return "", "", false
	}
	return rest[:i], rest[i+1:], true
}

// IsDockerHostID 判断是否为 Docker 容器主机 ID。
func IsDockerHostID(id string) bool {
	_, _, ok := ParseShellHostID(id)
	return ok
}

// EnsureShellHost 注册容器为 Shell 主机并持久化。
func (m *Manager) EnsureShellHost(ctx context.Context, contextID, containerID string) (*model.ShellHostDO, error) {
	handle, err := m.openClient(ctx, contextID)
	if err != nil {
		return nil, err
	}
	defer handle.close()

	inspect, err := handle.client.ContainerInspect(ctx, containerID)
	if err != nil {
		return nil, errno.Wrap(errno.CodeConnFailed, "读取容器信息失败", err)
	}
	if inspect.State == nil || !inspect.State.Running {
		return nil, errno.New(errno.CodeInvalidArg, "容器未运行，无法注册为 Shell 主机", containerID)
	}
	name := strings.TrimPrefix(inspect.Name, "/")
	if name == "" {
		name = containerID
		if len(name) > 12 {
			name = name[:12]
		}
	}
	image := ""
	if inspect.Config != nil {
		image = inspect.Config.Image
	}
	id := ShellHostID(contextID, inspect.ID)
	createdAt := int64(0)
	if existing, err := m.store.GetDockerShellHost(id); err == nil && existing != nil {
		createdAt = existing.CreatedAt
	}
	rec := model.DockerShellHostDO{
		ID:          id,
		ContextID:   contextID,
		ContainerID: inspect.ID,
		Name:        name,
		Image:       image,
		CreatedAt:   createdAt,
	}
	if err := m.store.SaveDockerShellHost(rec); err != nil {
		return nil, err
	}
	saved, err := m.store.GetDockerShellHost(id)
	if err != nil {
		return nil, err
	}
	out := dockerHostToShell(saved)
	out.Running = true
	return out, nil
}

// GetShellHost 按 ID 获取已注册的 Docker Shell 主机。
func (m *Manager) GetShellHost(id string) (*model.ShellHostDO, error) {
	h, err := m.store.GetDockerShellHost(id)
	if err != nil {
		return nil, err
	}
	return dockerHostToShell(h), nil
}

// ListShellHosts 列出已注册的 Docker Shell 主机，并探测运行状态。
func (m *Manager) ListShellHosts(ctx context.Context) ([]model.ShellHostDO, error) {
	list, err := m.store.ListDockerShellHosts()
	if err != nil {
		return nil, err
	}
	out := make([]model.ShellHostDO, 0, len(list))
	for i := range list {
		out = append(out, *dockerHostToShell(&list[i]))
	}
	m.enrichRunning(ctx, out)
	return out, nil
}

// enrichRunning 按 Docker 上下文批量探测容器是否在运行。
func (m *Manager) enrichRunning(ctx context.Context, hosts []model.ShellHostDO) {
	byCtx := map[string][]int{}
	for i := range hosts {
		cid := hosts[i].ContextID
		if cid == "" {
			continue
		}
		byCtx[cid] = append(byCtx[cid], i)
	}
	for contextID, idxs := range byCtx {
		probeCtx, cancel := context.WithTimeout(ctx, 8*time.Second)
		handle, err := m.openClient(probeCtx, contextID)
		if err != nil {
			cancel()
			continue
		}
		for _, i := range idxs {
			st, err := handle.client.ContainerInspect(probeCtx, hosts[i].ContainerID)
			hosts[i].Running = err == nil && st.State != nil && st.State.Running
		}
		handle.close()
		cancel()
	}
}

// RemoveShellHost 从注册表移除 Docker Shell 主机（不影响容器）。
func (m *Manager) RemoveShellHost(id string) error {
	return m.store.DeleteDockerShellHost(id)
}

// PruneStoppedShellHosts 移除已停止或不可达的已注册容器主机。
func (m *Manager) PruneStoppedShellHosts(ctx context.Context) (int, error) {
	list, err := m.ListShellHosts(ctx)
	if err != nil {
		return 0, err
	}
	n := 0
	for _, h := range list {
		if h.Running {
			continue
		}
		if err := m.RemoveShellHost(h.ID); err != nil {
			return n, err
		}
		n++
	}
	return n, nil
}

// GetContainerShell 获取进入容器 Shell 的终端启动信息（注册主机）。
func (m *Manager) GetContainerShell(ctx context.Context, contextID, containerID string) (*model.ContainerShellDO, error) {
	host, err := m.EnsureShellHost(ctx, contextID, containerID)
	if err != nil {
		return nil, err
	}
	return &model.ContainerShellDO{
		Mode:        "docker",
		HostID:      host.ID,
		ContextID:   host.ContextID,
		ContainerID: host.ContainerID,
	}, nil
}

func dockerHostToShell(h *model.DockerShellHostDO) *model.ShellHostDO {
	title := h.Name
	if title == "" {
		title = h.ContainerID
		if len(title) > 12 {
			title = title[:12]
		}
	}
	return &model.ShellHostDO{
		ID:            h.ID,
		Kind:          model.ShellHostKindDocker,
		Name:          title,
		ContextID:     h.ContextID,
		ContainerID:   h.ContainerID,
		ContainerName: h.Name,
		Image:         h.Image,
		CreatedAt:     h.CreatedAt,
		UpdatedAt:     h.UpdatedAt,
	}
}

// ClientHandle 对外暴露的 Docker 客户端句柄。
type ClientHandle struct {
	inner *dockerClientHandle
}

// OpenClient 按上下文打开 Docker 客户端（调用方负责 Close）。
func (m *Manager) OpenClient(ctx context.Context, contextID string) (*ClientHandle, error) {
	h, err := m.openClient(ctx, contextID)
	if err != nil {
		return nil, err
	}
	return &ClientHandle{inner: h}, nil
}

// API 返回 Docker API 客户端。
func (h *ClientHandle) API() *client.Client {
	if h == nil || h.inner == nil {
		return nil
	}
	return h.inner.client
}

// Close 释放客户端。
func (h *ClientHandle) Close() {
	if h != nil && h.inner != nil {
		h.inner.close()
	}
}

// ResolveShellTitle 生成容器终端标题。
func ResolveShellTitle(name, containerID string) string {
	if name != "" {
		return fmt.Sprintf("%s · docker", name)
	}
	id := containerID
	if len(id) > 12 {
		id = id[:12]
	}
	return fmt.Sprintf("%s · docker", id)
}
