package app

import (
	"fmt"

	"WWorkbench/internal/docker"
	"WWorkbench/internal/model"
	"WWorkbench/internal/session"
	"WWorkbench/internal/store"
	"WWorkbench/internal/workbench"

	"github.com/wailsapp/wails/v2/pkg/runtime"
)

// ListDockerContexts 列出 Docker 上下文。
func (s *Service) ListDockerContexts() ApiResult[[]model.DockerContextDO] {
	ctx, cancel := session.WithTimeout(s.ctx, 15)
	defer cancel()
	list, err := s.docker.ListContexts(ctx)
	if err != nil {
		return ErrResult[[]model.DockerContextDO](err)
	}
	if list == nil {
		list = []model.DockerContextDO{}
	}
	return OkResult(list)
}

// SaveDockerContext 保存 SSH Docker 上下文。
func (s *Service) SaveDockerContext(c model.DockerContextDO) ApiResult[model.DockerContextDO] {
	op := workbench.RadarOpUpdate
	if c.ID == "" {
		op = workbench.RadarOpCreate
	}
	out, err := s.docker.SaveContext(c)
	if err != nil {
		return ErrResult[model.DockerContextDO](err)
	}
	if s.radar != nil {
		s.radar.EmitDockerContext(op, out.ID, "ui-docker-ctx-save", out.Name, false)
	}
	return OkResult(*out)
}

// DeleteDockerContext 删除 Docker 上下文。
func (s *Service) DeleteDockerContext(id string) ApiResult[bool] {
	if err := s.docker.DeleteContext(id); err != nil {
		return ErrResult[bool](err)
	}
	if s.radar != nil {
		s.radar.EmitDockerContext(workbench.RadarOpDelete, id, "ui-docker-ctx-delete", "", false)
	}
	return OkResult(true)
}

// TestDockerContext 测试 Docker 上下文连通性。
func (s *Service) TestDockerContext(contextID string) ApiResult[bool] {
	ctx, cancel := session.WithTimeout(s.ctx, 25)
	defer cancel()
	if err := s.docker.TestContext(ctx, contextID); err != nil {
		return ErrResult[bool](err)
	}
	return OkResult(true)
}

// ListContainers 列出容器。
func (s *Service) ListContainers(contextID string) ApiResult[[]model.ContainerDO] {
	ctx, cancel := session.WithTimeout(s.ctx, 30)
	defer cancel()
	list, err := s.docker.ListContainers(ctx, contextID)
	if err != nil {
		return ErrResult[[]model.ContainerDO](err)
	}
	if list == nil {
		list = []model.ContainerDO{}
	}
	return OkResult(list)
}

// ListImages 列出镜像。
func (s *Service) ListImages(contextID string) ApiResult[[]model.DockerImageDO] {
	ctx, cancel := session.WithTimeout(s.ctx, 30)
	defer cancel()
	list, err := s.docker.ListImages(ctx, contextID)
	if err != nil {
		return ErrResult[[]model.DockerImageDO](err)
	}
	if list == nil {
		list = []model.DockerImageDO{}
	}
	return OkResult(list)
}

// StartContainer 启动容器。
func (s *Service) StartContainer(contextID, containerID string) ApiResult[bool] {
	ctx, cancel := session.WithTimeout(s.ctx, 30)
	defer cancel()
	if err := s.docker.StartContainer(ctx, contextID, containerID); err != nil {
		return ErrResult[bool](err)
	}
	if s.radar != nil {
		s.radar.EmitDockerContainer(workbench.RadarOpUpdate, contextID, containerID, "ui-docker-start", "start "+containerID, false)
	}
	return OkResult(true)
}

// StopContainer 停止容器。
func (s *Service) StopContainer(contextID, containerID string) ApiResult[bool] {
	ctx, cancel := session.WithTimeout(s.ctx, 30)
	defer cancel()
	if err := s.docker.StopContainer(ctx, contextID, containerID); err != nil {
		return ErrResult[bool](err)
	}
	if s.radar != nil {
		s.radar.EmitDockerContainer(workbench.RadarOpUpdate, contextID, containerID, "ui-docker-stop", "stop "+containerID, false)
	}
	return OkResult(true)
}

// RestartContainer 重启容器。
func (s *Service) RestartContainer(contextID, containerID string) ApiResult[bool] {
	ctx, cancel := session.WithTimeout(s.ctx, 30)
	defer cancel()
	if err := s.docker.RestartContainer(ctx, contextID, containerID); err != nil {
		return ErrResult[bool](err)
	}
	if s.radar != nil {
		s.radar.EmitDockerContainer(workbench.RadarOpUpdate, contextID, containerID, "ui-docker-restart", "restart "+containerID, false)
	}
	return OkResult(true)
}

// RemoveContainer 删除容器。
func (s *Service) RemoveContainer(contextID, containerID string) ApiResult[bool] {
	ctx, cancel := session.WithTimeout(s.ctx, 30)
	defer cancel()
	if err := s.docker.RemoveContainer(ctx, contextID, containerID); err != nil {
		return ErrResult[bool](err)
	}
	if s.radar != nil {
		s.radar.EmitDockerContainer(workbench.RadarOpDelete, contextID, containerID, "ui-docker-remove", "remove "+containerID, false)
	}
	return OkResult(true)
}

// GetContainerLogs 获取容器日志。
func (s *Service) GetContainerLogs(contextID, containerID string, tail int) ApiResult[model.ContainerLogsDO] {
	ctx, cancel := session.WithTimeout(s.ctx, 30)
	defer cancel()
	content, err := s.docker.GetContainerLogs(ctx, contextID, containerID, tail)
	if err != nil {
		return ErrResult[model.ContainerLogsDO](err)
	}
	return OkResult(model.ContainerLogsDO{Content: content})
}

// GetContainerShell 获取容器 Shell 终端启动信息。
func (s *Service) GetContainerShell(contextID, containerID string) ApiResult[model.ContainerShellDO] {
	ctx, cancel := session.WithTimeout(s.ctx, 15)
	defer cancel()
	info, err := s.docker.GetContainerShell(ctx, contextID, containerID)
	if err != nil {
		return ErrResult[model.ContainerShellDO](err)
	}
	return OkResult(*info)
}

// ResolveContainerDatabaseLink 根据容器生成数据库连接建议。
func (s *Service) ResolveContainerDatabaseLink(contextID, containerID string) ApiResult[model.ContainerDatabaseLinkDO] {
	ctx, cancel := session.WithTimeout(s.ctx, 15)
	defer cancel()
	link, err := s.docker.ResolveContainerDatabaseLink(ctx, contextID, containerID)
	if err != nil {
		return ErrResult[model.ContainerDatabaseLinkDO](err)
	}
	return OkResult(*link)
}

// GetContainerEnv 获取容器启动环境变量。
func (s *Service) GetContainerEnv(contextID, containerID string) ApiResult[model.ContainerEnvDO] {
	ctx, cancel := session.WithTimeout(s.ctx, 15)
	defer cancel()
	env, err := s.docker.GetContainerEnv(ctx, contextID, containerID)
	if err != nil {
		return ErrResult[model.ContainerEnvDO](err)
	}
	return OkResult(*env)
}

// GetContainerRunPreset 获取镜像运行预设。
func (s *Service) GetContainerRunPreset(image string) ApiResult[model.ContainerRunPresetDO] {
	preset := docker.GetContainerRunPreset(image)
	return OkResult(preset)
}

// RunContainer 从镜像创建并运行容器。
func (s *Service) RunContainer(contextID string, spec model.ContainerRunDO) ApiResult[model.ContainerDO] {
	ctx, cancel := session.WithTimeout(s.ctx, 120)
	defer cancel()
	out, err := s.docker.RunContainer(ctx, contextID, spec)
	if err != nil {
		return ErrResult[model.ContainerDO](err)
	}
	return OkResult(*out)
}

// composeDirKey 按上下文存储 Compose 项目目录。
func composeDirKey(contextID string) string {
	return fmt.Sprintf("%s:%s", store.SettingDockerComposeDir, contextID)
}

// PickDockerComposeDirectory 选择 Compose 项目目录。
func (s *Service) PickDockerComposeDirectory(contextID string) ApiResult[string] {
	path, err := runtime.OpenDirectoryDialog(s.ctx, runtime.OpenDialogOptions{
		Title: "选择 Compose 项目目录",
	})
	if err != nil {
		return ErrResult[string](err)
	}
	if path != "" {
		if err := s.docker.TestComposeProject(path); err != nil {
			return ErrResult[string](err)
		}
		_ = s.store.SetAppSetting(composeDirKey(contextID), path)
	}
	return OkResult(path)
}

// GetDockerComposeDirectory 获取已保存的 Compose 项目目录。
func (s *Service) GetDockerComposeDirectory(contextID string) ApiResult[string] {
	path, err := s.store.GetAppSetting(composeDirKey(contextID))
	if err != nil {
		return ErrResult[string](err)
	}
	return OkResult(path)
}

// ListComposeServices 列出 Compose 项目服务。
func (s *Service) ListComposeServices(contextID, projectDir string) ApiResult[[]model.ComposeServiceDO] {
	ctx, cancel := session.WithTimeout(s.ctx, 60)
	defer cancel()
	list, err := s.docker.ListComposeServices(ctx, contextID, projectDir)
	if err != nil {
		return ErrResult[[]model.ComposeServiceDO](err)
	}
	if list == nil {
		list = []model.ComposeServiceDO{}
	}
	return OkResult(list)
}

// ComposeUp 启动 Compose 项目。
func (s *Service) ComposeUp(contextID, projectDir string) ApiResult[string] {
	ctx, cancel := session.WithTimeout(s.ctx, 300)
	defer cancel()
	out, err := s.docker.ComposeUp(ctx, contextID, projectDir)
	if err != nil {
		return ErrResult[string](err)
	}
	return OkResult(out)
}

// ComposeDown 停止 Compose 项目。
func (s *Service) ComposeDown(contextID, projectDir string) ApiResult[string] {
	ctx, cancel := session.WithTimeout(s.ctx, 120)
	defer cancel()
	out, err := s.docker.ComposeDown(ctx, contextID, projectDir)
	if err != nil {
		return ErrResult[string](err)
	}
	return OkResult(out)
}

// ComposePull 拉取 Compose 镜像。
func (s *Service) ComposePull(contextID, projectDir string) ApiResult[string] {
	ctx, cancel := session.WithTimeout(s.ctx, 600)
	defer cancel()
	out, err := s.docker.ComposePull(ctx, contextID, projectDir)
	if err != nil {
		return ErrResult[string](err)
	}
	return OkResult(out)
}

// GetComposeLogs 获取 Compose 日志。
func (s *Service) GetComposeLogs(contextID, projectDir, service string, tail int) ApiResult[model.ComposeLogsDO] {
	ctx, cancel := session.WithTimeout(s.ctx, 60)
	defer cancel()
	content, err := s.docker.GetComposeLogs(ctx, contextID, projectDir, service, tail)
	if err != nil {
		return ErrResult[model.ComposeLogsDO](err)
	}
	return OkResult(model.ComposeLogsDO{Content: content})
}

// ComposeRestart 重启 Compose 服务。
func (s *Service) ComposeRestart(contextID, projectDir, service string) ApiResult[string] {
	ctx, cancel := session.WithTimeout(s.ctx, 120)
	defer cancel()
	out, err := s.docker.ComposeRestart(ctx, contextID, projectDir, service)
	if err != nil {
		return ErrResult[string](err)
	}
	return OkResult(out)
}
