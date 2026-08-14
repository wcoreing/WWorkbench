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
const AgentKeyProvider = "agent_provider"

const (
	AgentProviderOpenAI   = "openai"
	AgentProviderBailian  = "bailian"
	AgentProviderDeepSeek = "deepseek"
	AgentProviderMiniMax  = "minimax"
)

// BailianAPIBase 阿里云百炼 OpenAI 兼容地址。
const BailianAPIBase = "https://dashscope.aliyuncs.com/compatible-mode/v1"

// BailianDefaultModel 百炼默认模型。
const BailianDefaultModel = "qwen-plus"

// DeepSeekAPIBase DeepSeek OpenAI 兼容地址。
const DeepSeekAPIBase = "https://api.deepseek.com/v1"

// DeepSeekDefaultModel DeepSeek 默认模型。
const DeepSeekDefaultModel = "deepseek-v4-pro"

// DeepSeekModels DeepSeek 可选模型。
var DeepSeekModels = []string{"deepseek-v4-pro", "deepseek-v4-flash"}

// NormalizeDeepSeekModel 将 DeepSeek 模型规范为可选列表中的值。
func NormalizeDeepSeekModel(model string) string {
	m := strings.TrimSpace(model)
	for _, id := range DeepSeekModels {
		if m == id {
			return m
		}
	}
	return DeepSeekDefaultModel
}

// MiniMaxAPIBase MiniMax 国内站 OpenAI 兼容地址。
const MiniMaxAPIBase = "https://api.minimaxi.com/v1"

// MiniMaxDefaultModel MiniMax 默认模型。
const MiniMaxDefaultModel = "MiniMax-M2.5"

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
	default:
		return AgentProviderPreset{}, false
	}
}

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
	legacy := map[string]string{
		"open_terminal":           workbench.CapOpenTerminal,
		"terminal.open":           workbench.CapOpenTerminal,
		"terminal.exec":           workbench.CapTerminalExec,
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
	b := strings.ToLower(base)
	switch {
	case strings.Contains(b, "dashscope.aliyuncs.com"):
		return AgentProviderBailian
	case strings.Contains(b, "deepseek.com"):
		return AgentProviderDeepSeek
	case strings.Contains(b, "minimax"):
		return AgentProviderMiniMax
	default:
		return AgentProviderOpenAI
	}
}
