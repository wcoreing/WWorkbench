package app

import (
	"encoding/json"
	"strings"

	"WWorkbench/internal/errno"
	"WWorkbench/internal/httpclient"
	"WWorkbench/internal/model"
	"WWorkbench/internal/store"
)

// ListHTTPEnvironments 列出 HTTP 环境变量预设。
func (s *Service) ListHTTPEnvironments() ApiResult[[]model.HTTPEnvironmentDO] {
	list, err := s.store.ListHTTPEnvironments()
	if err != nil {
		return ErrResult[[]model.HTTPEnvironmentDO](err)
	}
	if list == nil {
		list = []model.HTTPEnvironmentDO{}
	}
	return OkResult(list)
}

// SaveHTTPEnvironment 保存 HTTP 环境预设。
func (s *Service) SaveHTTPEnvironment(e model.HTTPEnvironmentDO) ApiResult[model.HTTPEnvironmentDO] {
	if strings.TrimSpace(e.Name) == "" {
		return ErrResult[model.HTTPEnvironmentDO](errno.New(errno.CodeInvalidArg, "请填写环境名称", ""))
	}
	if e.VarsJSON == "" {
		e.VarsJSON = "{}"
	}
	if !json.Valid([]byte(e.VarsJSON)) {
		return ErrResult[model.HTTPEnvironmentDO](errno.New(errno.CodeInvalidArg, "环境变量 JSON 格式无效", ""))
	}
	if err := s.store.SaveHTTPEnvironment(&e); err != nil {
		return ErrResult[model.HTTPEnvironmentDO](err)
	}
	saved, err := s.store.GetHTTPEnvironment(e.ID)
	if err != nil {
		return ErrResult[model.HTTPEnvironmentDO](err)
	}
	return OkResult(*saved)
}

// DeleteHTTPEnvironment 删除 HTTP 环境预设。
func (s *Service) DeleteHTTPEnvironment(id string) ApiResult[bool] {
	if err := s.store.DeleteHTTPEnvironment(id); err != nil {
		return ErrResult[bool](err)
	}
	return OkResult(true)
}

// resolveHTTPRequestEnv 解析请求所用环境变量。
func (s *Service) resolveHTTPRequestEnv(envID string) map[string]string {
	if envID == "" {
		return nil
	}
	e, err := s.store.GetHTTPEnvironment(envID)
	if err != nil {
		return nil
	}
	return store.ParseHTTPEnvironmentVars(e.VarsJSON)
}

// applyEnvToHTTPRequest 应用环境变量到请求。
func (s *Service) applyEnvToHTTPRequest(req model.HTTPExecuteRequestDO) model.HTTPExecuteRequestDO {
	vars := s.resolveHTTPRequestEnv(req.EnvID)
	return httpclient.ApplyEnvToRequest(req, vars)
}
