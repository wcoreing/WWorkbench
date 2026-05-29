package docker

import (
	"context"
	"fmt"
	"io"
	"strings"
	"time"

	"WNavicat/internal/errno"
	"WNavicat/internal/model"
	"WNavicat/internal/store"
	"WNavicat/internal/terminal"

	"github.com/docker/docker/api/types/container"
	"github.com/docker/docker/api/types/image"
	"github.com/docker/docker/client"
)

const (
	// LocalContextID 本地 Docker 上下文标识。
	LocalContextID = "local"
)

// Manager Docker 引擎管理。
type Manager struct {
	store          *store.Store
	activeEndpoint string
}

// NewManager 创建 Docker 管理器。
func NewManager(st *store.Store) *Manager {
	return &Manager{store: st}
}

// dialLocalClient 尝试多个端点连接本地 Docker 引擎。
func (m *Manager) dialLocalClient(ctx context.Context) (*client.Client, string, error) {
	var lastErr error
	for _, host := range candidateDockerEndpoints() {
		if !socketExists(host) {
			continue
		}
		cli, err := client.NewClientWithOpts(
			client.WithHost(host),
			client.WithAPIVersionNegotiation(),
		)
		if err != nil {
			lastErr = err
			continue
		}
		if _, err := cli.Ping(ctx); err != nil {
			_ = cli.Close()
			lastErr = err
			continue
		}
		m.activeEndpoint = host
		return cli, host, nil
	}
	if lastErr != nil {
		return nil, "", errno.Wrap(errno.CodeConnFailed, "无法连接 Docker 引擎，请确认 Docker Desktop 已启动", lastErr)
	}
	return nil, "", errno.New(errno.CodeConnFailed, "未找到 Docker socket，请启动 Docker Desktop", resolveDockerEndpoint())
}

type dockerClientHandle struct {
	cli    interface{ Close() error }
	client *client.Client
}

// close 释放 Docker 客户端（含 SSH 隧道）。
func (h *dockerClientHandle) close() {
	if h.cli != nil {
		_ = h.cli.Close()
	}
}

// openClient 按上下文打开 Docker 客户端。
func (m *Manager) openClient(ctx context.Context, contextID string) (*dockerClientHandle, error) {
	if contextID == LocalContextID {
		cli, _, err := m.dialLocalClient(ctx)
		if err != nil {
			return nil, err
		}
		return &dockerClientHandle{cli: cli, client: cli}, nil
	}
	ctxDO, err := m.store.GetDockerContext(contextID)
	if err != nil {
		return nil, err
	}
	if ctxDO.Kind != "ssh" || ctxDO.SSHHostID == "" {
		return nil, errno.New(errno.CodeInvalidArg, "不支持的 Docker 上下文", contextID)
	}
	host, err := m.store.GetSSHHost(ctxDO.SSHHostID)
	if err != nil {
		return nil, err
	}
	cli, err := dialSSHDocker(ctx, terminal.HostToSpec(*host))
	if err != nil {
		return nil, err
	}
	return &dockerClientHandle{cli: cli, client: cli.Client}, nil
}

// pingContext 测试上下文连通性。
func (m *Manager) pingContext(ctx context.Context, contextID string) (bool, string, error) {
	if contextID == LocalContextID {
		cli, host, err := m.dialLocalClient(ctx)
		if err != nil {
			return false, resolveDockerEndpoint(), nil
		}
		_ = cli.Close()
		return true, host, nil
	}
	ctxDO, err := m.store.GetDockerContext(contextID)
	if err != nil {
		return false, "", err
	}
	handle, err := m.openClient(ctx, contextID)
	if err != nil {
		return false, ctxDO.Endpoint, err
	}
	handle.close()
	return true, ctxDO.Endpoint, nil
}

// ListContexts 列出 Docker 上下文。
func (m *Manager) ListContexts(ctx context.Context) ([]model.DockerContextDO, error) {
	endpoint := resolveDockerEndpoint()
	localConnected := false
	if cli, host, err := m.dialLocalClient(ctx); err == nil {
		localConnected = true
		endpoint = host
		_ = cli.Close()
	}
	out := []model.DockerContextDO{{
		ID:        LocalContextID,
		Name:      "本地 Docker",
		Kind:      "local",
		Endpoint:  endpoint,
		Connected: localConnected,
	}}
	stored, err := m.store.ListDockerContexts()
	if err != nil {
		return nil, err
	}
	for _, c := range stored {
		connected, ep, pingErr := m.pingContext(ctx, c.ID)
		if ep != "" {
			c.Endpoint = ep
		}
		c.Connected = connected && pingErr == nil
		out = append(out, c)
	}
	return out, nil
}

// TestContext 测试 Docker 上下文连通性。
func (m *Manager) TestContext(ctx context.Context, contextID string) error {
	connected, _, err := m.pingContext(ctx, contextID)
	if err != nil {
		return err
	}
	if !connected {
		return errno.New(errno.CodeConnFailed, "无法连接 Docker 引擎", contextID)
	}
	return nil
}

// SaveContext 保存 SSH Docker 上下文。
func (m *Manager) SaveContext(c model.DockerContextDO) (*model.DockerContextDO, error) {
	if c.Kind == "" {
		c.Kind = "ssh"
	}
	if err := m.store.SaveDockerContext(c); err != nil {
		return nil, err
	}
	return m.store.GetDockerContext(c.ID)
}

// DeleteContext 删除 Docker 上下文。
func (m *Manager) DeleteContext(id string) error {
	if id == LocalContextID {
		return errno.New(errno.CodeInvalidArg, "无法删除本地 Docker 上下文", id)
	}
	ctxDO, err := m.store.GetDockerContext(id)
	if err != nil {
		return err
	}
	if ctxDO.Kind == "local" {
		return errno.New(errno.CodeInvalidArg, "无法删除本地 Docker 上下文", id)
	}
	return m.store.DeleteDockerContext(id)
}

// ListContainers 列出容器。
func (m *Manager) ListContainers(ctx context.Context, contextID string) ([]model.ContainerDO, error) {
	handle, err := m.openClient(ctx, contextID)
	if err != nil {
		return nil, err
	}
	defer handle.close()

	list, err := handle.client.ContainerList(ctx, container.ListOptions{All: true})
	if err != nil {
		return nil, errno.Wrap(errno.CodeConnFailed, "获取容器列表失败", err)
	}
	out := make([]model.ContainerDO, 0, len(list))
	for _, c := range list {
		name := ""
		if len(c.Names) > 0 {
			name = strings.TrimPrefix(c.Names[0], "/")
		}
		shortID := c.ID
		if len(shortID) > 12 {
			shortID = shortID[:12]
		}
		out = append(out, model.ContainerDO{
			ID:        c.ID,
			ShortID:   shortID,
			Name:      name,
			Image:     c.Image,
			State:     c.State,
			Status:    c.Status,
			Ports:     formatPorts(c.Ports),
			CreatedAt: c.Created,
		})
	}
	return out, nil
}

// ListImages 列出镜像。
func (m *Manager) ListImages(ctx context.Context, contextID string) ([]model.DockerImageDO, error) {
	handle, err := m.openClient(ctx, contextID)
	if err != nil {
		return nil, err
	}
	defer handle.close()

	list, err := handle.client.ImageList(ctx, image.ListOptions{})
	if err != nil {
		return nil, errno.Wrap(errno.CodeConnFailed, "获取镜像列表失败", err)
	}
	out := make([]model.DockerImageDO, 0, len(list))
	for _, img := range list {
		shortID := img.ID
		if strings.HasPrefix(shortID, "sha256:") {
			shortID = shortID[7:]
		}
		if len(shortID) > 12 {
			shortID = shortID[:12]
		}
		tags := strings.Join(img.RepoTags, ", ")
		if tags == "" {
			tags = "<none>"
		}
		out = append(out, model.DockerImageDO{
			ID:        img.ID,
			ShortID:   shortID,
			Tags:      tags,
			Size:      img.Size,
			CreatedAt: img.Created,
		})
	}
	return out, nil
}

// StartContainer 启动容器。
func (m *Manager) StartContainer(ctx context.Context, contextID, containerID string) error {
	handle, err := m.openClient(ctx, contextID)
	if err != nil {
		return err
	}
	defer handle.close()
	if err := handle.client.ContainerStart(ctx, containerID, container.StartOptions{}); err != nil {
		return errno.Wrap(errno.CodeConnFailed, "启动容器失败", err)
	}
	return nil
}

// StopContainer 停止容器。
func (m *Manager) StopContainer(ctx context.Context, contextID, containerID string) error {
	handle, err := m.openClient(ctx, contextID)
	if err != nil {
		return err
	}
	defer handle.close()
	timeout := 10
	if err := handle.client.ContainerStop(ctx, containerID, container.StopOptions{Timeout: &timeout}); err != nil {
		return errno.Wrap(errno.CodeConnFailed, "停止容器失败", err)
	}
	return nil
}

// RestartContainer 重启容器。
func (m *Manager) RestartContainer(ctx context.Context, contextID, containerID string) error {
	handle, err := m.openClient(ctx, contextID)
	if err != nil {
		return err
	}
	defer handle.close()
	timeout := 10
	if err := handle.client.ContainerRestart(ctx, containerID, container.StopOptions{Timeout: &timeout}); err != nil {
		return errno.Wrap(errno.CodeConnFailed, "重启容器失败", err)
	}
	return nil
}

// RemoveContainer 删除容器。
func (m *Manager) RemoveContainer(ctx context.Context, contextID, containerID string) error {
	handle, err := m.openClient(ctx, contextID)
	if err != nil {
		return err
	}
	defer handle.close()
	if err := handle.client.ContainerRemove(ctx, containerID, container.RemoveOptions{Force: true}); err != nil {
		return errno.Wrap(errno.CodeConnFailed, "删除容器失败", err)
	}
	return nil
}

// GetContainerLogs 获取容器日志尾部。
func (m *Manager) GetContainerLogs(ctx context.Context, contextID, containerID string, tail int) (string, error) {
	handle, err := m.openClient(ctx, contextID)
	if err != nil {
		return "", err
	}
	defer handle.close()
	if tail <= 0 {
		tail = 200
	}

	reader, err := handle.client.ContainerLogs(ctx, containerID, container.LogsOptions{
		ShowStdout: true,
		ShowStderr: true,
		Tail:       fmt.Sprintf("%d", tail),
		Timestamps: true,
	})
	if err != nil {
		return "", errno.Wrap(errno.CodeConnFailed, "读取容器日志失败", err)
	}
	defer reader.Close()

	data, err := io.ReadAll(reader)
	if err != nil {
		return "", errno.Wrap(errno.CodeConnFailed, "读取容器日志失败", err)
	}
	return stripDockerLogStream(data), nil
}

// GetContainerShell 获取进入容器 Shell 的终端启动信息。
func (m *Manager) GetContainerShell(ctx context.Context, contextID, containerID string) (*model.ContainerShellDO, error) {
	handle, err := m.openClient(ctx, contextID)
	if err != nil {
		return nil, err
	}
	defer handle.close()

	inspect, err := handle.client.ContainerInspect(ctx, containerID)
	if err != nil {
		return nil, errno.Wrap(errno.CodeConnFailed, "读取容器信息失败", err)
	}
	target := strings.TrimPrefix(inspect.Name, "/")
	if target == "" {
		target = containerID
		if len(target) > 12 {
			target = target[:12]
		}
	}
	cmd := fmt.Sprintf("docker exec -it %s sh", shellQuote(target))
	if contextID == LocalContextID {
		return &model.ContainerShellDO{Mode: "local", Command: cmd}, nil
	}
	ctxDO, err := m.store.GetDockerContext(contextID)
	if err != nil {
		return nil, err
	}
	return &model.ContainerShellDO{
		Mode:    "ssh",
		HostID:  ctxDO.SSHHostID,
		Command: cmd,
	}, nil
}

// shellQuote 为 shell 命令引用容器名。
func shellQuote(name string) string {
	if name == "" {
		return "''"
	}
	if strings.ContainsAny(name, " \t\"'$`\\") {
		return "'" + strings.ReplaceAll(name, "'", `'"'"'`) + "'"
	}
	return name
}

// formatPorts 格式化端口映射展示。
func formatPorts(ports []container.Port) string {
	if len(ports) == 0 {
		return "-"
	}
	parts := make([]string, 0, len(ports))
	for _, p := range ports {
		if p.PublicPort == 0 {
			parts = append(parts, fmt.Sprintf("%d/%s", p.PrivatePort, p.Type))
			continue
		}
		parts = append(parts, fmt.Sprintf("%d→%d/%s", p.PublicPort, p.PrivatePort, p.Type))
	}
	return strings.Join(parts, ", ")
}

// stripDockerLogStream 去除 Docker 日志流式头（8 字节前缀）。
func stripDockerLogStream(raw []byte) string {
	if len(raw) == 0 {
		return ""
	}
	var b strings.Builder
	for i := 0; i+8 <= len(raw); {
		size := int(raw[i+4])<<24 | int(raw[i+5])<<16 | int(raw[i+6])<<8 | int(raw[i+7])
		i += 8
		if size <= 0 || i+size > len(raw) {
			break
		}
		b.Write(raw[i : i+size])
		i += size
	}
	out := b.String()
	if out == "" {
		return string(raw)
	}
	return out
}

// UptimeFromCreated 根据创建时间计算运行时长文案。
func UptimeFromCreated(state string, created int64) string {
	if state != "running" || created <= 0 {
		return "-"
	}
	d := time.Since(time.Unix(created, 0))
	if d < time.Minute {
		return fmt.Sprintf("%ds", int(d.Seconds()))
	}
	if d < time.Hour {
		return fmt.Sprintf("%dm", int(d.Minutes()))
	}
	if d < 24*time.Hour {
		return fmt.Sprintf("%dh", int(d.Hours()))
	}
	return fmt.Sprintf("%dd", int(d.Hours()/24))
}
