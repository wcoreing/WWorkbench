package store

import (
	"strings"

	"WWorkbench/internal/agentcap"
	"WWorkbench/internal/errno"
	"WWorkbench/internal/model"
)

const (
	AgentKeyAPIBase    = "agent_api_base"
	AgentKeyAPIKey     = "agent_api_key"
	AgentKeyModel      = "agent_model"
	AgentKeyAllowWrite = "agent_allow_write"
)

// GetAgentSettings 读取 Agent 配置。
func (s *Store) GetAgentSettings() model.AgentSettingsDO {
	base, _ := s.GetAppSetting(AgentKeyAPIBase)
	key, _ := s.GetAppSetting(AgentKeyAPIKey)
	modelName, _ := s.GetAppSetting(AgentKeyModel)
	allow, _ := s.GetAppSetting(AgentKeyAllowWrite)
	provider, _ := s.GetAppSetting(AgentKeyProvider)
	if base == "" {
		base = BailianAPIBase
		modelName = BailianDefaultModel
		provider = AgentProviderBailian
	}
	if modelName == "" {
		modelName = BailianDefaultModel
	}
	provider = detectProvider(base, provider)
	if provider == AgentProviderDeepSeek {
		modelName = NormalizeDeepSeekModel(modelName)
	}
	masked := ""
	if key != "" {
		if len(key) <= 4 {
			masked = "****"
		} else {
			masked = key[:4] + "****"
		}
	}
	caps := s.BuildAgentCapabilities()
	if caps == nil {
		caps = []model.AgentCapabilityDO{}
	}
	return model.AgentSettingsDO{
		APIBase:         base,
		APIKeyMask:      masked,
		HasAPIKey:       key != "",
		Model:           modelName,
		Provider:        provider,
		AllowWrite:      allow == "1" || allow == "true",
		Capabilities:    caps,
		UnavailableNote: agentcap.UnavailableNote,
	}
}

// SaveAgentSettings 保存 Agent 配置（apiKey 为空则保留原密钥）。
func (s *Store) SaveAgentSettings(in model.AgentSettingsSaveDO) error {
	base := normalizeAgentAPIBase(in.APIBase)
	if base != "" {
		if err := s.SetAppSetting(AgentKeyAPIBase, base); err != nil {
			return err
		}
	}
	if in.APIKey != "" {
		if err := s.SetAppSetting(AgentKeyAPIKey, in.APIKey); err != nil {
			return err
		}
	}
	if in.Model != "" {
		if err := s.SetAppSetting(AgentKeyModel, strings.TrimSpace(in.Model)); err != nil {
			return err
		}
	}
	if in.Provider != "" {
		if err := s.SetAppSetting(AgentKeyProvider, in.Provider); err != nil {
			return err
		}
	}
	if in.ToolPermissionsJSON != "" {
		if err := s.SaveToolPermissionsJSON(in.ToolPermissionsJSON); err != nil {
			return err
		}
	}
	allow := "0"
	if in.AllowWrite {
		allow = "1"
	}
	return s.SetAppSetting(AgentKeyAllowWrite, allow)
}

// SaveAgentAPIConfig 仅保存 API 连接配置。
func (s *Store) SaveAgentAPIConfig(in model.AgentAPIConfigSaveDO) error {
	base := normalizeAgentAPIBase(in.APIBase)
	if base == "" {
		return errno.New(errno.CodeInvalidArg, "请填写 API 地址", "")
	}
	if strings.TrimSpace(in.Model) == "" {
		return errno.New(errno.CodeInvalidArg, "请填写模型名称", "")
	}
	provider := strings.TrimSpace(in.Provider)
	if provider == "" {
		provider = detectProvider(base, "")
	}
	modelName := strings.TrimSpace(in.Model)
	if provider == AgentProviderDeepSeek {
		modelName = NormalizeDeepSeekModel(modelName)
	}
	if err := s.SetAppSetting(AgentKeyAPIBase, base); err != nil {
		return err
	}
	if in.APIKey != "" {
		if err := s.SetAppSetting(AgentKeyAPIKey, in.APIKey); err != nil {
			return err
		}
	}
	if err := s.SetAppSetting(AgentKeyModel, modelName); err != nil {
		return err
	}
	if provider != "" {
		if err := s.SetAppSetting(AgentKeyProvider, provider); err != nil {
			return err
		}
	}
	return nil
}

// SaveAgentPermissions 仅保存能力权限配置。
func (s *Store) SaveAgentPermissions(in model.AgentPermissionsSaveDO) error {
	if in.ToolPermissionsJSON != "" {
		if err := s.SaveToolPermissionsJSON(in.ToolPermissionsJSON); err != nil {
			return err
		}
	}
	allow := "0"
	if in.AllowWrite {
		allow = "1"
	}
	return s.SetAppSetting(AgentKeyAllowWrite, allow)
}

// ApplyProviderPreset 应用服务商预设（端点与默认模型；不改动 API Key）。
func (s *Store) ApplyProviderPreset(provider string) error {
	p, ok := LookupAgentProviderPreset(provider)
	if !ok {
		return errno.New(errno.CodeInvalidArg, "不支持的服务商预设: "+provider, "")
	}
	if err := s.SetAppSetting(AgentKeyAPIBase, p.APIBase); err != nil {
		return err
	}
	if err := s.SetAppSetting(AgentKeyModel, p.Model); err != nil {
		return err
	}
	return s.SetAppSetting(AgentKeyProvider, p.Provider)
}

// AgentAPIKey 读取 API 密钥（内部使用）。
func (s *Store) AgentAPIKey() string {
	k, _ := s.GetAppSetting(AgentKeyAPIKey)
	return k
}
