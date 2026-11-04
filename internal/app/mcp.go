package app

import (
	"context"
	"fmt"
	"log"
	"time"

	"WWorkbench/internal/mcpserver"
	"WWorkbench/internal/model"
	"WWorkbench/internal/store"
)

// applyMCPFromSettings 按设置启停 / 热重启 MCP HTTP。
func (s *Service) applyMCPFromSettings() error {
	wantOn := s.store.MCPEnabled()
	wantAddr := store.ResolveMCPListenAddr(s.store.MCPAddr())

	s.mcpMu.Lock()
	defer s.mcpMu.Unlock()

	if !wantOn {
		s.mcpLastErr = ""
		return s.stopMCPLocked()
	}
	if s.harnessHost == nil || s.toolsRegistry == nil {
		s.mcpLastErr = "harness 未就绪，无法启动 MCP"
		return fmt.Errorf("%s", s.mcpLastErr)
	}
	gw := s.harnessHost.Gateway()
	if gw == nil {
		s.mcpLastErr = "tool gateway 未就绪"
		return fmt.Errorf("%s", s.mcpLastErr)
	}
	h, err := mcpserver.NewHandler(gw, s.toolsRegistry)
	if err != nil {
		s.mcpLastErr = err.Error()
		return err
	}
	if s.mcpHTTP != nil && s.mcpHTTP.ListenAddr() == wantAddr {
		s.mcpHTTP.SetHandler(h)
		s.mcpLastErr = ""
		log.Printf("mcp: workbench %s", s.mcpHTTP.WorkbenchEndpointURL())
		return nil
	}
	if err := s.stopMCPLocked(); err != nil {
		log.Printf("mcp: stop before restart: %v", err)
	}
	ep, err := mcpserver.Listen(wantAddr)
	if err != nil {
		s.mcpLastErr = err.Error()
		return err
	}
	ep.SetHandler(h)
	s.mcpHTTP = ep
	s.mcpLastErr = ""
	log.Printf("mcp: workbench %s", ep.WorkbenchEndpointURL())
	return nil
}

// AttachMCP 接入进程启动时已占用的监听，避免 Cursor 在工作台就绪前连接被拒绝。
func (s *Service) AttachMCP(ep *mcpserver.Endpoint) {
	if s == nil || ep == nil {
		return
	}
	s.mcpMu.Lock()
	s.mcpHTTP = ep
	s.mcpMu.Unlock()
}

func (s *Service) stopMCPLocked() error {
	if s.mcpHTTP == nil {
		return nil
	}
	ctx, cancel := context.WithTimeout(context.Background(), 3*time.Second)
	defer cancel()
	err := s.mcpHTTP.Stop(ctx)
	s.mcpHTTP = nil
	return err
}

// GetMCPStatus 返回 MCP HTTP 状态。
func (s *Service) GetMCPStatus() ApiResult[model.MCPStatusDO] {
	configured := s.store.MCPEnabled()
	addr := s.store.MCPAddr()
	st := model.MCPStatusDO{
		Configured: configured,
		Addr:       addr,
	}
	s.mcpMu.Lock()
	defer s.mcpMu.Unlock()
	st.Error = s.mcpLastErr
	if s.mcpHTTP != nil {
		st.Enabled = true
		st.ListenAddr = s.mcpHTTP.ListenAddr()
		st.MCPURL = s.mcpHTTP.EndpointURL()
		st.WorkbenchURL = s.mcpHTTP.WorkbenchEndpointURL()
		st.HealthURL = s.mcpHTTP.HealthURL()
	} else {
		st.Enabled = false
		st.ListenAddr = store.ResolveMCPListenAddr(addr)
	}
	return OkResult(st)
}

// SaveMCPConfig 保存并热启停 MCP HTTP。
func (s *Service) SaveMCPConfig(in model.MCPConfigSaveDO) ApiResult[model.MCPStatusDO] {
	if err := s.store.SaveMCPConfig(in.Enabled, in.Addr); err != nil {
		return ErrResult[model.MCPStatusDO](err)
	}
	if err := s.applyMCPFromSettings(); err != nil {
		st := s.GetMCPStatus().Data
		if st.Error == "" {
			st.Error = err.Error()
		}
		return OkResult(st)
	}
	return s.GetMCPStatus()
}
