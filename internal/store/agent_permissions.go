package store

import (
	"encoding/json"
	"strings"

	"WNavicat/internal/agentcap"
	"WNavicat/internal/errno"
	"WNavicat/internal/model"
)

// normalizeAgentAPIBase 规范化 LLM API 根地址。
func normalizeAgentAPIBase(base string) string {
	base = strings.TrimSpace(base)
	base = strings.TrimSuffix(base, "/")
	base = strings.TrimSuffix(base, "/chat/completions")
	return strings.TrimSuffix(base, "/")
}

const AgentKeyToolPermissions = "agent_tool_permissions"
const AgentKeyProvider = "agent_provider"

const (
	AgentProviderOpenAI  = "openai"
	AgentProviderBailian = "bailian"
)

// BailianAPIBase 阿里云百炼 OpenAI 兼容地址。
const BailianAPIBase = "https://dashscope.aliyuncs.com/compatible-mode/v1"

// BailianDefaultModel 百炼默认模型。
const BailianDefaultModel = "qwen-plus"

// GetToolPermissions 读取工具权限映射（缺省为全部启用）。
func (s *Store) GetToolPermissions() map[string]bool {
	raw, _ := s.GetAppSetting(AgentKeyToolPermissions)
	if raw == "" {
		return agentcap.DefaultPermissions()
	}
	var m map[string]bool
	if err := json.Unmarshal([]byte(raw), &m); err != nil {
		return agentcap.DefaultPermissions()
	}
	def := agentcap.DefaultPermissions()
	for name, on := range m {
		if name == "open_terminal" {
			if _, ok := m["terminal.open"]; !ok {
				def["terminal.open"] = on
			}
			continue
		}
		def[name] = on
	}
	return def
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
	perms := s.GetToolPermissions()
	out := make([]model.AgentCapabilityDO, 0, len(agentcap.Catalog()))
	for _, c := range agentcap.Catalog() {
		out = append(out, model.AgentCapabilityDO{
			Name:         c.Name,
			Label:        c.Label,
			Risk:         string(c.Risk),
			Description:  c.Description,
			Enabled:      perms[c.Name],
			NeedsConfirm: c.NeedsConfirm,
		})
	}
	return out
}

// detectProvider 根据 API 地址推断服务商。
func detectProvider(base, saved string) string {
	if saved != "" {
		return saved
	}
	if strings.Contains(strings.ToLower(base), "dashscope.aliyuncs.com") {
		return AgentProviderBailian
	}
	return AgentProviderOpenAI
}
