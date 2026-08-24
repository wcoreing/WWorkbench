package docker

import (
	"context"
	"fmt"
	"regexp"
	"strconv"
	"strings"

	"WWorkbench/internal/errno"
	"WWorkbench/internal/model"

	"github.com/docker/docker/api/types/container"
	"github.com/docker/go-connections/nat"
)

var containerNameRe = regexp.MustCompile(`^[a-zA-Z0-9][a-zA-Z0-9_.-]*$`)

// RunContainer 从镜像创建并可选启动容器。
func (m *Manager) RunContainer(ctx context.Context, contextID string, spec model.ContainerRunDO) (*model.ContainerDO, error) {
	if err := validateRunSpec(spec); err != nil {
		return nil, err
	}
	handle, err := m.openClient(ctx, contextID)
	if err != nil {
		return nil, err
	}
	defer handle.close()

	exposed, bindings, err := buildPortMappings(spec.Ports)
	if err != nil {
		return nil, err
	}
	config := &container.Config{
		Image:        strings.TrimSpace(spec.Image),
		Env:          formatRunEnv(spec.Env),
		ExposedPorts: exposed,
	}
	hostConfig := &container.HostConfig{
		PortBindings: bindings,
	}
	if strings.TrimSpace(spec.Restart) != "" {
		hostConfig.RestartPolicy = container.RestartPolicy{Name: normalizeRestartPolicy(spec.Restart)}
	}

	name := strings.TrimSpace(spec.Name)
	resp, err := handle.client.ContainerCreate(ctx, config, hostConfig, nil, nil, name)
	if err != nil {
		return nil, errno.Wrap(errno.CodeConnFailed, "创建容器失败", err)
	}
	if spec.AutoStart {
		if err := handle.client.ContainerStart(ctx, resp.ID, container.StartOptions{}); err != nil {
			_ = handle.client.ContainerRemove(ctx, resp.ID, container.RemoveOptions{Force: true})
			return nil, errno.Wrap(errno.CodeConnFailed, "启动容器失败", err)
		}
	}
	return m.containerDOByID(ctx, handle, resp.ID)
}

// validateRunSpec 校验运行参数。
func validateRunSpec(spec model.ContainerRunDO) error {
	if strings.TrimSpace(spec.Image) == "" {
		return errno.New(errno.CodeInvalidArg, "镜像不能为空", "")
	}
	name := strings.TrimSpace(spec.Name)
	if name == "" {
		return errno.New(errno.CodeInvalidArg, "容器名称不能为空", "")
	}
	if !containerNameRe.MatchString(name) {
		return errno.New(errno.CodeInvalidArg, "容器名称仅支持字母、数字、._-", name)
	}
	preset := GetContainerRunPreset(spec.Image)
	for _, field := range preset.EnvFields {
		if !field.Required {
			continue
		}
		if envValue(spec.Env, field.Key) == "" {
			return errno.New(errno.CodeInvalidArg, "缺少必填环境变量: "+field.Key, field.Key)
		}
	}
	return nil
}

// envValue 从环境变量列表读取值。
func envValue(env []model.ContainerEnvKVDO, key string) string {
	for _, item := range env {
		if item.Key == key {
			return strings.TrimSpace(item.Value)
		}
	}
	return ""
}

// formatRunEnv 格式化环境变量为 Docker API 格式。
func formatRunEnv(env []model.ContainerEnvKVDO) []string {
	var out []string
	for _, item := range env {
		key := strings.TrimSpace(item.Key)
		if key == "" {
			continue
		}
		out = append(out, key+"="+item.Value)
	}
	return out
}

// buildPortMappings 构建暴露端口与绑定映射；hostPort=0 表示仅暴露不映射。
func buildPortMappings(ports []model.ContainerPortMappingDO) (nat.PortSet, nat.PortMap, error) {
	exposed := nat.PortSet{}
	bindings := nat.PortMap{}
	for _, p := range ports {
		if p.ContainerPort <= 0 {
			continue
		}
		proto := strings.TrimSpace(p.Protocol)
		if proto == "" {
			proto = "tcp"
		}
		if p.ContainerPort > 65535 || p.HostPort < 0 || p.HostPort > 65535 {
			return nil, nil, errno.New(errno.CodeInvalidArg, "端口范围应为 1-65535", fmt.Sprintf("%d:%d", p.HostPort, p.ContainerPort))
		}
		port, err := nat.NewPort(proto, strconv.Itoa(p.ContainerPort))
		if err != nil {
			return nil, nil, errno.Wrap(errno.CodeInvalidArg, "端口格式无效", err)
		}
		exposed[port] = struct{}{}
		if p.HostPort <= 0 {
			continue
		}
		bindings[port] = append(bindings[port], nat.PortBinding{
			HostIP:   "0.0.0.0",
			HostPort: strconv.Itoa(p.HostPort),
		})
	}
	return exposed, bindings, nil
}

// normalizeRestartPolicy 规范化重启策略。
func normalizeRestartPolicy(policy string) container.RestartPolicyMode {
	switch strings.ToLower(strings.TrimSpace(policy)) {
	case "unless-stopped":
		return container.RestartPolicyUnlessStopped
	case "always":
		return container.RestartPolicyAlways
	case "on-failure":
		return container.RestartPolicyOnFailure
	default:
		return container.RestartPolicyDisabled
	}
}

// containerDOByID 根据 ID 获取容器摘要。
func (m *Manager) containerDOByID(ctx context.Context, handle *dockerClientHandle, id string) (*model.ContainerDO, error) {
	list, err := handle.client.ContainerList(ctx, container.ListOptions{All: true})
	if err != nil {
		return nil, errno.Wrap(errno.CodeConnFailed, "读取容器信息失败", err)
	}
	for _, c := range list {
		if c.ID != id && !strings.HasPrefix(c.ID, id) {
			continue
		}
		out := toContainerDO(c)
		return &out, nil
	}
	return nil, errno.New(errno.CodeConnFailed, "容器已创建但未在列表中找到", id)
}
