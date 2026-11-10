package app

import (
	"context"
	"strings"
	"time"

	"WWorkbench/internal/errno"
	"WWorkbench/internal/model"
	"WWorkbench/internal/workbenchtools"
)

// ProbeTerminalCwd 探测可见终端当前工作目录（会向 PTY 注入一行 printf）。
func (s *Service) ProbeTerminalCwd(sessionID string) ApiResult[model.TerminalCwdDO] {
	if s.terminals == nil {
		return ErrResult[model.TerminalCwdDO](errno.New(errno.CodeNotFound, "终端服务不可用", ""))
	}
	ctx, cancel := context.WithTimeout(context.Background(), 6*time.Second)
	defer cancel()
	path, err := s.terminals.ProbeCwd(ctx, sessionID)
	if err != nil {
		return ErrResult[model.TerminalCwdDO](err)
	}
	hostKey, kind, err := s.terminals.SessionHostKey(sessionID)
	if err != nil {
		return ErrResult[model.TerminalCwdDO](err)
	}
	return OkResult(model.TerminalCwdDO{
		SessionID: sessionID,
		HostKey:   hostKey,
		Kind:      kind,
		Path:      path,
	})
}

// GrantMCPWriteDir 终端右键：授权 MCP 在当前目录软文件写免确认。
func (s *Service) GrantMCPWriteDir(sessionID string) ApiResult[model.MCPWriteAllowDO] {
	book := s.writeAllowBook()
	if book == nil {
		return ErrResult[model.MCPWriteAllowDO](errno.New(errno.CodeUnknown, "授权簿未就绪", ""))
	}
	cwd := s.ProbeTerminalCwd(sessionID)
	if !cwd.Ok {
		if cwd.Error != nil {
			return ErrResult[model.MCPWriteAllowDO](cwd.Error)
		}
		return ErrResult[model.MCPWriteAllowDO](errno.New(errno.CodeUnknown, "未能读取当前目录", ""))
	}
	item := book.Grant(cwd.Data.HostKey, cwd.Data.Path)
	return OkResult(model.MCPWriteAllowDO{
		HostKey: item.HostKey,
		Path:    item.Path,
		At:      item.At,
		Kind:    cwd.Data.Kind,
	})
}

// RevokeMCPWriteDir 取消 MCP 写目录授权；path 空则取消该会话主机全部。
func (s *Service) RevokeMCPWriteDir(sessionID, path string) ApiResult[int] {
	book := s.writeAllowBook()
	if book == nil {
		return ErrResult[int](errno.New(errno.CodeUnknown, "授权簿未就绪", ""))
	}
	hostKey, _, err := s.terminals.SessionHostKey(sessionID)
	if err != nil {
		return ErrResult[int](err)
	}
	n := book.Revoke(hostKey, strings.TrimSpace(path))
	return OkResult(n)
}

// ListMCPWriteDirs 列出 MCP 写目录授权。
func (s *Service) ListMCPWriteDirs() ApiResult[[]model.MCPWriteAllowDO] {
	book := s.writeAllowBook()
	if book == nil {
		return OkResult([]model.MCPWriteAllowDO{})
	}
	items := book.List()
	out := make([]model.MCPWriteAllowDO, 0, len(items))
	for _, it := range items {
		out = append(out, model.MCPWriteAllowDO{
			HostKey: it.HostKey,
			Path:    it.Path,
			At:      it.At,
		})
	}
	return OkResult(out)
}

func (s *Service) writeAllowBook() *workbenchtools.MCPWriteAllowBook {
	if s.toolsRegistry == nil || s.toolsRegistry.Deps() == nil {
		return nil
	}
	return s.toolsRegistry.Deps().WriteAllows
}
