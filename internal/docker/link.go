package docker

import (
	"context"
	"strconv"
	"strings"

	"WNavicat/internal/errno"
	"WNavicat/internal/model"

	"github.com/docker/docker/api/types"
	"github.com/docker/go-connections/nat"
)

type dbPortSpec struct {
	dbType      string
	privatePort nat.Port
	user        string
}

var databasePrivatePorts = []dbPortSpec{
	{dbType: "mysql", privatePort: nat.Port("3306/tcp"), user: "root"},
	{dbType: "mysql", privatePort: nat.Port("3307/tcp"), user: "root"},
	{dbType: "postgresql", privatePort: nat.Port("5432/tcp"), user: "postgres"},
}

// ResolveContainerDatabaseLink 根据容器端口映射生成数据库连接建议。
func (m *Manager) ResolveContainerDatabaseLink(ctx context.Context, contextID, containerID string) (*model.ContainerDatabaseLinkDO, error) {
	handle, err := m.openClient(ctx, contextID)
	if err != nil {
		return nil, err
	}
	defer handle.close()

	inspect, err := handle.client.ContainerInspect(ctx, containerID)
	if err != nil {
		return nil, errno.Wrap(errno.CodeConnFailed, "读取容器信息失败", err)
	}

	spec, publicPort, ok := detectDatabasePort(inspect)
	if !ok {
		return nil, errno.New(errno.CodeInvalidArg, "未检测到 MySQL / PostgreSQL 映射端口", containerID)
	}

	name := strings.TrimPrefix(inspect.Name, "/")
	if name == "" {
		name = containerID
		if len(name) > 12 {
			name = name[:12]
		}
	}

	link := &model.ContainerDatabaseLinkDO{
		DbType: spec.dbType,
		Name:   name + " · " + spec.dbType,
		Host:   "127.0.0.1",
		Port:   publicPort,
		User:   spec.user,
	}
	if contextID != LocalContextID {
		ctxDO, err := m.store.GetDockerContext(contextID)
		if err != nil {
			return nil, err
		}
		link.SSHEnabled = true
		link.SSHHostID = ctxDO.SSHHostID
	}
	return link, nil
}

// detectDatabasePort 从容器镜像与端口映射识别数据库服务。
func detectDatabasePort(inspect types.ContainerJSON) (dbPortSpec, int, bool) {
	image := strings.ToLower(inspect.Image)
	candidates := databasePrivatePorts
	if strings.Contains(image, "postgres") {
		candidates = []dbPortSpec{{dbType: "postgresql", privatePort: nat.Port("5432/tcp"), user: "postgres"}}
	} else if strings.Contains(image, "mysql") || strings.Contains(image, "mariadb") {
		candidates = []dbPortSpec{{dbType: "mysql", privatePort: nat.Port("3306/tcp"), user: "root"}}
	}

	ports := inspect.NetworkSettings.Ports
	for _, spec := range candidates {
		if public, ok := publicHostPort(ports, spec.privatePort); ok {
			return spec, public, true
		}
	}
	for p := range inspect.Config.ExposedPorts {
		for _, spec := range candidates {
			if p.Port() == spec.privatePort.Port() && p.Proto() == spec.privatePort.Proto() {
				if public, ok := publicHostPort(ports, spec.privatePort); ok {
					return spec, public, true
				}
			}
		}
	}
	return dbPortSpec{}, 0, false
}

// publicHostPort 读取容器私有端口对应的主机映射端口。
func publicHostPort(ports nat.PortMap, private nat.Port) (int, bool) {
	bindings, ok := ports[private]
	if !ok || len(bindings) == 0 {
		return 0, false
	}
	for _, b := range bindings {
		if b.HostPort == "" {
			continue
		}
		p, err := strconv.Atoi(b.HostPort)
		if err == nil && p > 0 {
			return p, true
		}
	}
	return 0, false
}
