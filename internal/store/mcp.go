package store

import (
	"net"
	"os"
	"strings"
)

const (
	AgentKeyMCPEnabled = "agent_mcp_enabled"
	AgentKeyMCPAddr    = "agent_mcp_addr"
	// DefaultMCPHTTPAddr 与 mcpserver.DefaultHTTPAddr 保持一致。
	DefaultMCPHTTPAddr = "127.0.0.1:51021"
)

// MCPEnabled 是否启动 MCP HTTP（缺省 true）。
func (s *Store) MCPEnabled() bool {
	raw, _ := s.GetAppSetting(AgentKeyMCPEnabled)
	raw = strings.TrimSpace(strings.ToLower(raw))
	if raw == "" {
		return true
	}
	return raw == "1" || raw == "true" || raw == "yes" || raw == "on"
}

// MCPAddr 配置的监听地址（可空，启动时走默认口）。
func (s *Store) MCPAddr() string {
	raw, _ := s.GetAppSetting(AgentKeyMCPAddr)
	return normalizeMCPAddr(raw)
}

// SaveMCPConfig 保存 MCP 开关与地址。
func (s *Store) SaveMCPConfig(enabled bool, addr string) error {
	val := "0"
	if enabled {
		val = "1"
	}
	if err := s.SetAppSetting(AgentKeyMCPEnabled, val); err != nil {
		return err
	}
	return s.SetAppSetting(AgentKeyMCPAddr, normalizeMCPAddr(addr))
}

// normalizeMCPAddr 仅保留 host:port；非法则空。
func normalizeMCPAddr(raw string) string {
	raw = strings.TrimSpace(raw)
	if raw == "" {
		return ""
	}
	host, port, err := net.SplitHostPort(raw)
	if err != nil || host == "" || port == "" {
		return ""
	}
	if _, err := net.LookupPort("tcp", port); err != nil {
		return ""
	}
	return net.JoinHostPort(host, port)
}

// ResolveMCPListenAddr 解析实际监听地址。
func ResolveMCPListenAddr(configured string) string {
	addr := normalizeMCPAddr(configured)
	if addr == "" {
		addr = strings.TrimSpace(os.Getenv("WWORKBENCH_MCP_ADDR"))
	}
	if addr == "" {
		addr = DefaultMCPHTTPAddr
	}
	return addr
}
