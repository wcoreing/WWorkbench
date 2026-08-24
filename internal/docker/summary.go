package docker

import (
	"strings"

	"WWorkbench/internal/model"

	"github.com/docker/docker/api/types/container"
)

// toContainerDO 将 Docker 列表项转为摘要。
func toContainerDO(c container.Summary) model.ContainerDO {
	name := ""
	if len(c.Names) > 0 {
		name = strings.TrimPrefix(c.Names[0], "/")
	}
	shortID := c.ID
	if len(shortID) > 12 {
		shortID = shortID[:12]
	}
	return model.ContainerDO{
		ID:        c.ID,
		ShortID:   shortID,
		Name:      name,
		Image:     c.Image,
		State:     c.State,
		Status:    c.Status,
		Ports:     formatPorts(c.Ports),
		PortMaps:  toPortMappings(c.Ports),
		Mounts:    toMounts(c.Mounts),
		CreatedAt: c.Created,
	}
}

// toMounts 将 Docker 挂载点转为结构化数据。
func toMounts(mounts []container.MountPoint) []model.ContainerMountDO {
	if len(mounts) == 0 {
		return nil
	}
	out := make([]model.ContainerMountDO, 0, len(mounts))
	for _, m := range mounts {
		out = append(out, model.ContainerMountDO{
			Type:        string(m.Type),
			Name:        m.Name,
			Source:      m.Source,
			Destination: m.Destination,
			Mode:        m.Mode,
			RW:          m.RW,
		})
	}
	return out
}
