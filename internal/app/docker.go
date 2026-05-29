package app

import (
	"WNavicat/internal/docker"
	"WNavicat/internal/model"
	"WNavicat/internal/session"
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
	out, err := s.docker.SaveContext(c)
	if err != nil {
		return ErrResult[model.DockerContextDO](err)
	}
	return OkResult(*out)
}

// DeleteDockerContext 删除 Docker 上下文。
func (s *Service) DeleteDockerContext(id string) ApiResult[bool] {
	if err := s.docker.DeleteContext(id); err != nil {
		return ErrResult[bool](err)
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
	return OkResult(true)
}

// StopContainer 停止容器。
func (s *Service) StopContainer(contextID, containerID string) ApiResult[bool] {
	ctx, cancel := session.WithTimeout(s.ctx, 30)
	defer cancel()
	if err := s.docker.StopContainer(ctx, contextID, containerID); err != nil {
		return ErrResult[bool](err)
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
	return OkResult(true)
}

// RemoveContainer 删除容器。
func (s *Service) RemoveContainer(contextID, containerID string) ApiResult[bool] {
	ctx, cancel := session.WithTimeout(s.ctx, 30)
	defer cancel()
	if err := s.docker.RemoveContainer(ctx, contextID, containerID); err != nil {
		return ErrResult[bool](err)
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
