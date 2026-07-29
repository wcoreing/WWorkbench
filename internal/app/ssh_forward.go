package app

import (
	"WWorkbench/internal/model"
	"WWorkbench/internal/session"
)

// ListSSHForwardPresets 列出端口转发预设。
func (s *Service) ListSSHForwardPresets() ApiResult[[]model.SSHForwardPresetDO] {
	list, err := s.forwards.ListPresets()
	if err != nil {
		return ErrResult[[]model.SSHForwardPresetDO](err)
	}
	return OkResult(list)
}

// SaveSSHForwardPreset 保存端口转发预设。
func (s *Service) SaveSSHForwardPreset(p model.SSHForwardPresetDO) ApiResult[model.SSHForwardPresetDO] {
	out, err := s.forwards.SavePreset(p)
	if err != nil {
		return ErrResult[model.SSHForwardPresetDO](err)
	}
	return OkResult(*out)
}

// DeleteSSHForwardPreset 删除端口转发预设。
func (s *Service) DeleteSSHForwardPreset(id string) ApiResult[bool] {
	if err := s.forwards.DeletePreset(id); err != nil {
		return ErrResult[bool](err)
	}
	return OkResult(true)
}

// ListActiveSSHForwards 列出活动端口转发。
func (s *Service) ListActiveSSHForwards() ApiResult[[]model.SSHForwardActiveDO] {
	list := s.forwards.ListActive()
	if list == nil {
		list = []model.SSHForwardActiveDO{}
	}
	return OkResult(list)
}

// StartSSHForward 启动端口转发。
func (s *Service) StartSSHForward(req model.SSHForwardStartDO) ApiResult[model.SSHForwardActiveDO] {
	ctx, cancel := session.WithTimeout(s.ctx, 30)
	defer cancel()
	out, err := s.forwards.Start(ctx, req)
	if err != nil {
		return ErrResult[model.SSHForwardActiveDO](err)
	}
	return OkResult(*out)
}

// StopSSHForward 停止端口转发。
func (s *Service) StopSSHForward(id string) ApiResult[bool] {
	if err := s.forwards.Stop(id); err != nil {
		return ErrResult[bool](err)
	}
	return OkResult(true)
}
