package store

import (
	"encoding/json"
	"strings"

	"WWorkbench/internal/agentcap"
	"WWorkbench/internal/errno"
	"WWorkbench/internal/model"
	"WWorkbench/internal/workbench"
)

// normalizeAgentAPIBase 规范化 LLM API 根地址。
func normalizeAgentAPIBase(base string) string {
	base = strings.TrimSpace(base)
	base = strings.TrimSuffix(base, "/")
	base = strings.TrimSuffix(base, "/chat/completions")
	return strings.TrimSuffix(base, "/")
}

const AgentKeyToolPermissions = "agent_tool_permissions"
const AgentKeyToolPermsProfile = "agent_tool_permissions_profile"
const AgentKeyProvider = "agent_provider"

// ToolPermsProfileSlim 精简默认：浏览器/桌面/插件等默认关，打开 MCP 工具面更短。
const ToolPermsProfileSlim = "2"

const (
	AgentProviderOpenAI   = "openai"
	AgentProviderBailian  = "bailian"
	AgentProviderDeepSeek = "deepseek"
	AgentProviderMiniMax  = "minimax"
	AgentProviderCursor   = "cursor"
)

// BailianAPIBase 阿里云百炼 OpenAI 兼容地址。
const BailianAPIBase = "https://dashscope.aliyuncs.com/compatible-mode/v1"

// BailianDefaultModel 百炼默认模型。
const BailianDefaultModel = "qwen-plus"

// DeepSeekAPIBase DeepSeek OpenAI 兼容地址。
const DeepSeekAPIBase = "https://api.deepseek.com/v1"

// DeepSeekDefaultModel DeepSeek 默认模型。
const DeepSeekDefaultModel = "deepseek-flash"

// MiniMaxAPIBase MiniMax 国内站 OpenAI 兼容地址。
const MiniMaxAPIBase = "https://api.minimaxi.com/v1"

// MiniMaxDefaultModel MiniMax 默认模型。
const MiniMaxDefaultModel = "MiniMax-M2.5"

// CursorAPIBase Cursor SDK Bridge 哨兵地址（真实连接由 Host 拉起 cursor-sdk-bridge）。
const CursorAPIBase = "cursor-sdk-bridge://local"

// CursorDefaultModel Cursor 默认模型。
const CursorDefaultModel = "composer-2.5"

func defaultModelFor(provider string) string {
	switch provider {
	case AgentProviderDeepSeek:
		return DeepSeekDefaultModel
	case AgentProviderMiniMax:
		return MiniMaxDefaultModel
	case AgentProviderCursor:
		return CursorDefaultModel
	default:
		return BailianDefaultModel
	}
}

// AgentProviderPreset 服务商预设（端点 + 默认模型）。
type AgentProviderPreset struct {
	Provider string
	APIBase  string
	Model    string
}

// LookupAgentProviderPreset 按 provider 返回预设；未知则 ok=false。
func LookupAgentProviderPreset(provider string) (AgentProviderPreset, bool) {
	switch strings.TrimSpace(strings.ToLower(provider)) {
	case AgentProviderBailian:
		return AgentProviderPreset{Provider: AgentProviderBailian, APIBase: BailianAPIBase, Model: BailianDefaultModel}, true
	case AgentProviderDeepSeek:
		return AgentProviderPreset{Provider: AgentProviderDeepSeek, APIBase: DeepSeekAPIBase, Model: DeepSeekDefaultModel}, true
	case AgentProviderMiniMax:
		return AgentProviderPreset{Provider: AgentProviderMiniMax, APIBase: MiniMaxAPIBase, Model: MiniMaxDefaultModel}, true
	case AgentProviderCursor:
		return AgentProviderPreset{Provider: AgentProviderCursor, APIBase: CursorAPIBase, Model: CursorDefaultModel}, true
	default:
		return AgentProviderPreset{}, false
	}
}

// GetToolPermissions 读取工具权限映射（缺省为 RecommendedDefault 精简集）。
func (s *Store) GetToolPermissions() map[string]bool {
	def := agentcap.DefaultPermissions()
	profile, _ := s.GetAppSetting(AgentKeyToolPermsProfile)
	raw, _ := s.GetAppSetting(AgentKeyToolPermissions)

	// 一次性迁到精简推荐：旧「全开」配置会冲掉 MCP 注意力收敛。
	if profile != ToolPermsProfileSlim {
		_ = s.SetAppSetting(AgentKeyToolPermsProfile, ToolPermsProfileSlim)
		if raw == "" {
			return def
		}
		var old map[string]bool
		if err := json.Unmarshal([]byte(raw), &old); err != nil || permissionsEffectivelyAllOn(old) {
			_ = s.SaveToolPermissions(def)
			return def
		}
		// 用户曾关掉部分：以精简默认为底，仅保留其显式关闭
		for name, on := range old {
			if !on {
				if _, ok := def[name]; ok {
					def[name] = false
				}
			}
		}
		_ = s.SaveToolPermissions(def)
		return def
	}

	if raw == "" {
		return def
	}
	var m map[string]bool
	if err := json.Unmarshal([]byte(raw), &m); err != nil {
		return def
	}
	legacy := map[string]string{
		"open_terminal":           workbench.CapShellRun,
		"terminal.open":           workbench.CapShellRun,
		"terminal_open":           workbench.CapShellRun,
		"terminal.exec":           workbench.CapShellProbe,
		"terminal_exec":           workbench.CapShellProbe,
		"terminal.reconnect":      workbench.CapTerminalReconnect,
		"reconnect_terminal":      workbench.CapTerminalReconnect,
		"database.open":           workbench.CapDatabaseOpen,
		"notebook.append_content": workbench.CapNotebookAppend,
	}
	for name, on := range m {
		if mapped, ok := legacy[name]; ok {
			if _, exists := m[mapped]; !exists {
				def[mapped] = on
			}
			continue
		}
		def[name] = on
	}
	return def
}

// permissionsEffectivelyAllOn 旧配置是否等于「目录内几乎全开」。
func permissionsEffectivelyAllOn(m map[string]bool) bool {
	if len(m) == 0 {
		return true
	}
	off := 0
	for _, on := range m {
		if !on {
			off++
		}
	}
	// 关掉不超过 2 个仍视为「全开残留」
	return off <= 2
}

// ResetToolPermissionsToRecommended 恢复精简推荐并标记 profile。
func (s *Store) ResetToolPermissionsToRecommended() error {
	if err := s.SetAppSetting(AgentKeyToolPermsProfile, ToolPermsProfileSlim); err != nil {
		return err
	}
	return s.SaveToolPermissions(agentcap.DefaultPermissions())
}

// SaveToolPermissionsJSON 从 JSON 字符串保存工具权限。
func (s *Store) SaveToolPermissionsJSON(jsonText string) error {
	var m map[string]bool
	if err := json.Unmarshal([]byte(jsonText), &m); err != nil {
		return errno.Wrap(errno.CodeInvalidArg, "工具权限 JSON 无效", err)
	}
	return s.SaveToolPermissions(m)
}

// SaveToolPermissions 保存工具权限映射。
func (s *Store) SaveToolPermissions(m map[string]bool) error {
	if m == nil {
		m = agentcap.DefaultPermissions()
	}
	b, err := json.Marshal(m)
	if err != nil {
		return err
	}
	return s.SetAppSetting(AgentKeyToolPermissions, string(b))
}

// BuildAgentCapabilities 合并目录与权限开关。
func (s *Store) BuildAgentCapabilities() []model.AgentCapabilityDO {
	return s.BuildAgentCapabilitiesWith(s.GetToolPermissions())
}

// BuildAgentCapabilitiesWith 用给定有效权限合并目录（可含 pack 门控后的结果）。
func (s *Store) BuildAgentCapabilitiesWith(perms map[string]bool) []model.AgentCapabilityDO {
	if perms == nil {
		perms = agentcap.DefaultPermissions()
	}
	out := make([]model.AgentCapabilityDO, 0, len(agentcap.Catalog()))
	for _, c := range agentcap.Catalog() {
		d := agentcap.DomainOf(c.Name)
		out = append(out, model.AgentCapabilityDO{
			Name:        c.Name,
			Label:       c.Label,
			Domain:      string(d),
			Risk:        string(c.Risk),
			Description: c.Description,
			Enabled:     perms[c.Name],
			// NeedsConfirm 已废弃：写工具自动执行；风险看 Risk=write
		})
	}
	return out
}

// detectProvider 根据 API 地址推断服务商。
func detectProvider(base, saved string) string {
	if saved != "" {
		return saved
	}
	b := strings.ToLower(base)
	switch {
	case strings.Contains(b, "dashscope.aliyuncs.com"):
		return AgentProviderBailian
	case strings.Contains(b, "deepseek.com"):
		return AgentProviderDeepSeek
	case strings.Contains(b, "minimax"):
		return AgentProviderMiniMax
	case strings.HasPrefix(b, "cursor-sdk-bridge://") || strings.Contains(b, "cursor-sdk-bridge"):
		return AgentProviderCursor
	default:
		return AgentProviderOpenAI
	}
}
