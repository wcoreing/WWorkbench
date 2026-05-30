package app

import (
	"context"
	"strings"
	"time"

	"WNavicat/internal/errno"
	"WNavicat/internal/logs"
	"WNavicat/internal/model"
)

// ListLogSources 列出已保存日志源。
func (s *Service) ListLogSources() ApiResult[[]model.LogSourceDO] {
	list, err := s.store.ListLogSources()
	if err != nil {
		return ErrResult[[]model.LogSourceDO](err)
	}
	if list == nil {
		list = []model.LogSourceDO{}
	}
	return OkResult(list)
}

// SaveLogSource 保存日志源。
func (s *Service) SaveLogSource(src model.LogSourceDO) ApiResult[model.LogSourceDO] {
	if err := validateLogSource(src); err != nil {
		return ErrResult[model.LogSourceDO](err)
	}
	if err := s.store.SaveLogSource(src); err != nil {
		return ErrResult[model.LogSourceDO](err)
	}
	saved, err := s.store.GetLogSource(src.ID)
	if err != nil {
		return ErrResult[model.LogSourceDO](err)
	}
	return OkResult(*saved)
}

// DeleteLogSource 删除日志源。
func (s *Service) DeleteLogSource(id string) ApiResult[bool] {
	if err := s.store.DeleteLogSource(id); err != nil {
		return ErrResult[bool](err)
	}
	return OkResult(true)
}

// FetchLogSource 拉取指定日志源内容。
func (s *Service) FetchLogSource(id string, tail int) ApiResult[model.LogFetchResultDO] {
	src, err := s.store.GetLogSource(id)
	if err != nil {
		return ErrResult[model.LogFetchResultDO](err)
	}
	return s.fetchLogContent(*src, tail)
}

// FetchLogSourceConfig 按当前配置拉取日志（无需已保存 ID，用于预览）。
func (s *Service) FetchLogSourceConfig(src model.LogSourceDO, tail int) ApiResult[model.LogFetchResultDO] {
	if err := validateLogSourceConfig(src); err != nil {
		return ErrResult[model.LogFetchResultDO](err)
	}
	return s.fetchLogContent(src, tail)
}

// fetchLogContent 执行日志拉取。
func (s *Service) fetchLogContent(src model.LogSourceDO, tail int) ApiResult[model.LogFetchResultDO] {
	ctx, cancel := context.WithTimeout(context.Background(), 45*time.Second)
	defer cancel()
	content, err := logs.Fetch(ctx, src, s.sshHosts, s.docker, tail)
	if err != nil {
		return ErrResult[model.LogFetchResultDO](err)
	}
	return OkResult(model.LogFetchResultDO{Content: content})
}

// validateLogSource 校验日志源配置（含名称，用于保存）。
func validateLogSource(src model.LogSourceDO) error {
	if strings.TrimSpace(src.Name) == "" {
		return errno.New(errno.CodeInvalidArg, "请填写日志源名称", "")
	}
	return validateLogSourceConfig(src)
}

// validateLogSourceConfig 校验拉取日志所需字段。
func validateLogSourceConfig(src model.LogSourceDO) error {
	switch src.SourceType {
	case model.LogSourceLocalFile:
		if strings.TrimSpace(src.Path) == "" {
			return errno.New(errno.CodeInvalidArg, "请填写日志文件路径", "")
		}
	case model.LogSourceSSHFile:
		if strings.TrimSpace(src.SSHHostID) == "" {
			return errno.New(errno.CodeInvalidArg, "请选择 SSH 主机", "")
		}
		if strings.TrimSpace(src.Path) == "" {
			return errno.New(errno.CodeInvalidArg, "请填写远端日志路径", "")
		}
	case model.LogSourceDocker:
		if strings.TrimSpace(src.DockerContextID) == "" {
			return errno.New(errno.CodeInvalidArg, "请选择 Docker 上下文", "")
		}
		if strings.TrimSpace(src.ContainerID) == "" {
			return errno.New(errno.CodeInvalidArg, "请选择容器", "")
		}
	case model.LogSourceCompose:
		if strings.TrimSpace(src.DockerContextID) == "" {
			return errno.New(errno.CodeInvalidArg, "请选择 Docker 上下文", "")
		}
		if strings.TrimSpace(src.ComposeDir) == "" {
			return errno.New(errno.CodeInvalidArg, "请填写 Compose 项目目录", "")
		}
	default:
		return errno.New(errno.CodeInvalidArg, "未知日志源类型", src.SourceType)
	}
	return nil
}
