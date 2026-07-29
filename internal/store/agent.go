package store

import (
	"database/sql"
	"strings"
	"time"

	"WWorkbench/internal/agentcap"
	"WWorkbench/internal/errno"
	"WWorkbench/internal/model"

	"github.com/google/uuid"
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
	if err := s.SetAppSetting(AgentKeyAPIBase, base); err != nil {
		return err
	}
	if in.APIKey != "" {
		if err := s.SetAppSetting(AgentKeyAPIKey, in.APIKey); err != nil {
			return err
		}
	}
	if err := s.SetAppSetting(AgentKeyModel, strings.TrimSpace(in.Model)); err != nil {
		return err
	}
	if in.Provider != "" {
		if err := s.SetAppSetting(AgentKeyProvider, in.Provider); err != nil {
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

// ApplyBailianPreset 应用百炼千问默认端点与模型名。
func (s *Store) ApplyBailianPreset() error {
	if err := s.SetAppSetting(AgentKeyAPIBase, BailianAPIBase); err != nil {
		return err
	}
	if err := s.SetAppSetting(AgentKeyModel, BailianDefaultModel); err != nil {
		return err
	}
	return s.SetAppSetting(AgentKeyProvider, AgentProviderBailian)
}

// AgentAPIKey 读取 API 密钥（内部使用）。
func (s *Store) AgentAPIKey() string {
	k, _ := s.GetAppSetting(AgentKeyAPIKey)
	return k
}

// SaveAgentPending 保存待确认工具调用。
func (s *Store) SaveAgentPending(p model.AgentPendingDO) error {
	if p.ID == "" {
		p.ID = uuid.NewString()
	}
	p.CreatedAt = time.Now().Unix()
	_, err := s.db.Exec(`INSERT INTO agent_pending (id, thread_id, tool_name, args_json, summary, created_at)
		VALUES (?, ?, ?, ?, ?, ?)`,
		p.ID, p.ThreadID, p.ToolName, p.ArgsJSON, p.Summary, p.CreatedAt)
	if err != nil {
		return errno.Wrap(errno.CodeStoreFailed, "保存待确认操作失败", err)
	}
	return nil
}

// GetAgentPending 获取待确认项。
func (s *Store) GetAgentPending(id string) (*model.AgentPendingDO, error) {
	var p model.AgentPendingDO
	err := s.db.QueryRow(`SELECT id, thread_id, tool_name, args_json, summary, created_at FROM agent_pending WHERE id = ?`, id).
		Scan(&p.ID, &p.ThreadID, &p.ToolName, &p.ArgsJSON, &p.Summary, &p.CreatedAt)
	if err == sql.ErrNoRows {
		return nil, errno.New(errno.CodeNotFound, "待确认操作不存在", id)
	}
	if err != nil {
		return nil, errno.Wrap(errno.CodeStoreFailed, "读取待确认操作失败", err)
	}
	return &p, nil
}

// DeleteAgentPending 删除待确认项。
func (s *Store) DeleteAgentPending(id string) error {
	_, err := s.db.Exec(`DELETE FROM agent_pending WHERE id = ?`, id)
	return err
}
