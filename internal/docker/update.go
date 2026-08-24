package docker

import (
	"context"
	"fmt"
	"strings"
	"time"

	"WWorkbench/internal/errno"
	"WWorkbench/internal/model"

	"github.com/docker/docker/api/types/container"
	"github.com/docker/docker/api/types/mount"
	"github.com/docker/docker/api/types/network"
	"github.com/docker/go-connections/nat"
)

// UpdateContainerSpec 通过重建容器更新端口映射与挂载。
func (m *Manager) UpdateContainerSpec(ctx context.Context, contextID, containerID string, update model.ContainerUpdateDO) (*model.ContainerDO, error) {
	handle, err := m.openClient(ctx, contextID)
	if err != nil {
		return nil, err
	}
	defer handle.close()

	inspect, err := handle.client.ContainerInspect(ctx, containerID)
	if err != nil {
		return nil, errno.Wrap(errno.CodeConnFailed, "读取容器信息失败", err)
	}
	if inspect.Config == nil {
		return nil, errno.New(errno.CodeInvalidArg, "容器配置无效", containerID)
	}

	name := strings.TrimPrefix(inspect.Name, "/")
	if name == "" {
		name = containerID
		if len(name) > 12 {
			name = name[:12]
		}
	}
	wasRunning := inspect.State != nil && inspect.State.Running

	exposed, bindings, err := buildPortMappings(update.Ports)
	if err != nil {
		return nil, err
	}
	mounts, err := buildMountSpecs(update.Mounts)
	if err != nil {
		return nil, err
	}

	config := cloneContainerConfig(inspect.Config)
	config.ExposedPorts = mergeExposedPorts(config.ExposedPorts, exposed)

	hostConfig := cloneHostConfig(inspect.HostConfig)
	hostConfig.PortBindings = bindings
	hostConfig.Binds = nil
	hostConfig.Mounts = mounts

	networking := cloneNetworkingConfig(inspect.NetworkSettings)

	tmpName := fmt.Sprintf("%s-ww-old-%d", name, time.Now().Unix()%100000)
	if wasRunning {
		timeout := 10
		_ = handle.client.ContainerStop(ctx, containerID, container.StopOptions{Timeout: &timeout})
	}
	if err := handle.client.ContainerRename(ctx, containerID, tmpName); err != nil {
		if wasRunning {
			_ = handle.client.ContainerStart(ctx, containerID, container.StartOptions{})
		}
		return nil, errno.Wrap(errno.CodeConnFailed, "重命名旧容器失败", err)
	}

	resp, err := handle.client.ContainerCreate(ctx, config, hostConfig, networking, nil, name)
	if err != nil {
		_ = handle.client.ContainerRename(ctx, containerID, name)
		if wasRunning {
			_ = handle.client.ContainerStart(ctx, containerID, container.StartOptions{})
		}
		return nil, errno.Wrap(errno.CodeConnFailed, "按新配置创建容器失败", err)
	}

	if wasRunning {
		if err := handle.client.ContainerStart(ctx, resp.ID, container.StartOptions{}); err != nil {
			_ = handle.client.ContainerRemove(ctx, resp.ID, container.RemoveOptions{Force: true})
			_ = handle.client.ContainerRename(ctx, containerID, name)
			_ = handle.client.ContainerStart(ctx, containerID, container.StartOptions{})
			return nil, errno.Wrap(errno.CodeConnFailed, "启动新容器失败，已回滚", err)
		}
	}

	_ = handle.client.ContainerRemove(ctx, containerID, container.RemoveOptions{Force: true})
	return m.containerDOByID(ctx, handle, resp.ID)
}

// buildMountSpecs 将编辑后的挂载转为 Docker Mount 规格。
func buildMountSpecs(items []model.ContainerMountDO) ([]mount.Mount, error) {
	if len(items) == 0 {
		return nil, nil
	}
	out := make([]mount.Mount, 0, len(items))
	for _, item := range items {
		dest := strings.TrimSpace(item.Destination)
		if dest == "" {
			return nil, errno.New(errno.CodeInvalidArg, "挂载目标路径不能为空", item.Source)
		}
		mt := mount.Type(strings.TrimSpace(item.Type))
		if mt == "" {
			mt = mount.TypeBind
		}
		src := strings.TrimSpace(item.Source)
		if mt == mount.TypeVolume {
			if name := strings.TrimSpace(item.Name); name != "" {
				src = name
			}
		}
		if mt != mount.TypeTmpfs && src == "" {
			return nil, errno.New(errno.CodeInvalidArg, "挂载源不能为空", dest)
		}
		out = append(out, mount.Mount{
			Type:     mt,
			Source:   src,
			Target:   dest,
			ReadOnly: !item.RW,
		})
	}
	return out, nil
}

// cloneContainerConfig 复制容器 Config，避免改动 inspect 原始对象。
func cloneContainerConfig(src *container.Config) *container.Config {
	if src == nil {
		return &container.Config{}
	}
	cp := *src
	if src.Env != nil {
		cp.Env = append([]string{}, src.Env...)
	}
	if src.Cmd != nil {
		cp.Cmd = append([]string{}, src.Cmd...)
	}
	if src.Entrypoint != nil {
		cp.Entrypoint = append([]string{}, src.Entrypoint...)
	}
	if src.Labels != nil {
		cp.Labels = map[string]string{}
		for k, v := range src.Labels {
			cp.Labels[k] = v
		}
	}
	if src.ExposedPorts != nil {
		cp.ExposedPorts = nat.PortSet{}
		for k, v := range src.ExposedPorts {
			cp.ExposedPorts[k] = v
		}
	}
	if src.Volumes != nil {
		cp.Volumes = map[string]struct{}{}
		for k, v := range src.Volumes {
			cp.Volumes[k] = v
		}
	}
	return &cp
}

// cloneHostConfig 复制 HostConfig（随后覆盖端口与挂载）。
func cloneHostConfig(src *container.HostConfig) *container.HostConfig {
	if src == nil {
		return &container.HostConfig{}
	}
	cp := *src
	cp.PortBindings = nil
	cp.Binds = nil
	cp.Mounts = nil
	if src.ExtraHosts != nil {
		cp.ExtraHosts = append([]string{}, src.ExtraHosts...)
	}
	if src.DNS != nil {
		cp.DNS = append([]string{}, src.DNS...)
	}
	if src.DNSSearch != nil {
		cp.DNSSearch = append([]string{}, src.DNSSearch...)
	}
	if src.CapAdd != nil {
		cp.CapAdd = append([]string{}, src.CapAdd...)
	}
	if src.CapDrop != nil {
		cp.CapDrop = append([]string{}, src.CapDrop...)
	}
	if src.Devices != nil {
		cp.Devices = append([]container.DeviceMapping{}, src.Devices...)
	}
	return &cp
}

// cloneNetworkingConfig 保留原网络连接。
func cloneNetworkingConfig(settings *container.NetworkSettings) *network.NetworkingConfig {
	if settings == nil || len(settings.Networks) == 0 {
		return nil
	}
	endpoints := map[string]*network.EndpointSettings{}
	for name, ep := range settings.Networks {
		if ep == nil {
			continue
		}
		cp := *ep
		endpoints[name] = &cp
	}
	if len(endpoints) == 0 {
		return nil
	}
	return &network.NetworkingConfig{EndpointsConfig: endpoints}
}

// mergeExposedPorts 合并暴露端口集合。
func mergeExposedPorts(base nat.PortSet, extra nat.PortSet) nat.PortSet {
	out := nat.PortSet{}
	for k, v := range base {
		out[k] = v
	}
	for k, v := range extra {
		out[k] = v
	}
	return out
}
