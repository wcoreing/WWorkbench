package store

import (
	"crypto/rand"
	"encoding/hex"
	"strings"
)

const (
	// AgentKeyMCPAuthToken MCP HTTP Bearer token（持久化，重启不变）。
	AgentKeyMCPAuthToken = "agent_mcp_auth_token"
	// AgentKeyBrowserBridgeToken 浏览器桥 WS/HTTP 鉴权 token。
	AgentKeyBrowserBridgeToken = "browser_bridge_auth_token"
)

// EnsureLocalAuthToken 读取或生成本机鉴权 token（32 字节 hex）。
func (s *Store) EnsureLocalAuthToken(key string) (string, error) {
	key = strings.TrimSpace(key)
	if key == "" {
		key = AgentKeyMCPAuthToken
	}
	raw, err := s.GetAppSetting(key)
	if err != nil {
		return "", err
	}
	tok := strings.TrimSpace(raw)
	if len(tok) >= 32 {
		return tok, nil
	}
	buf := make([]byte, 24)
	if _, err := rand.Read(buf); err != nil {
		return "", err
	}
	tok = hex.EncodeToString(buf)
	if err := s.SetAppSetting(key, tok); err != nil {
		return "", err
	}
	return tok, nil
}

// MCPAuthToken 返回 MCP Bearer token（必要时生成）。
func (s *Store) MCPAuthToken() (string, error) {
	return s.EnsureLocalAuthToken(AgentKeyMCPAuthToken)
}

// BrowserBridgeToken 返回浏览器桥鉴权 token（必要时生成）。
func (s *Store) BrowserBridgeToken() (string, error) {
	return s.EnsureLocalAuthToken(AgentKeyBrowserBridgeToken)
}

// RotateLocalAuthToken 强制换发 token（设置页「重新生成」用）。
func (s *Store) RotateLocalAuthToken(key string) (string, error) {
	key = strings.TrimSpace(key)
	if key == "" {
		key = AgentKeyMCPAuthToken
	}
	buf := make([]byte, 24)
	if _, err := rand.Read(buf); err != nil {
		return "", err
	}
	tok := hex.EncodeToString(buf)
	if err := s.SetAppSetting(key, tok); err != nil {
		return "", err
	}
	return tok, nil
}
