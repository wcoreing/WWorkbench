package app

import (
	"WWorkbench/internal/localproc"
	"WWorkbench/internal/model"
)

// ListLocalPortProcesses 列出占用指定本机端口的进程。
func (s *Service) ListLocalPortProcesses(port int) ApiResult[[]model.LocalPortProcessDO] {
	list, err := localproc.ListByPort(port)
	if err != nil {
		return ErrResult[[]model.LocalPortProcessDO](err)
	}
	if list == nil {
		list = []model.LocalPortProcessDO{}
	}
	return OkResult(list)
}

// ListListeningLocalPorts 列出本机 TCP LISTEN 端口占用。
func (s *Service) ListListeningLocalPorts() ApiResult[[]model.LocalPortProcessDO] {
	list, err := localproc.ListListening()
	if err != nil {
		return ErrResult[[]model.LocalPortProcessDO](err)
	}
	if list == nil {
		list = []model.LocalPortProcessDO{}
	}
	return OkResult(list)
}

// KillLocalPortProcesses 结束占用指定本机端口的进程。
func (s *Service) KillLocalPortProcesses(port int, force bool) ApiResult[model.LocalPortKillResultDO] {
	out, err := localproc.KillByPort(port, force)
	if err != nil {
		return ErrResult[model.LocalPortKillResultDO](err)
	}
	return OkResult(*out)
}
