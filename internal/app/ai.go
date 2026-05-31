package app

import (
	"strings"

	"WNavicat/internal/agent"
	"WNavicat/internal/errno"
	"WNavicat/internal/model"
	"WNavicat/internal/workbenchtools"

	"github.com/wailsapp/wails/v2/pkg/runtime"
)

// wireAgentRunner 初始化 Agent 编排器。
func (s *Service) wireAgentRunner() {
	emit := func(event string, payload map[string]interface{}) {
		runtime.EventsEmit(s.ctx, event, payload)
	}
	deps := &workbenchtools.Deps{
		Conns:     s.conns,
		SSHHosts:  s.sshHosts,
		Sessions:  s.sessions,
		Meta:      s.meta,
		Queries:   s.queries,
		Store:     s.store,
		UIActions: workbenchtools.NewUIActionBus(emit),
	}
	reg := workbenchtools.NewRegistry(deps)
	s.agentRunner = agent.NewRunner(s.store, reg, s.ctx, emit)
}

// GetAgentSettings 获取 Agent 配置。
func (s *Service) GetAgentSettings() ApiResult[model.AgentSettingsDO] {
	return OkResult(s.store.GetAgentSettings())
}

// SaveAgentAPIConfig 保存 Agent API 连接配置（模型、密钥等）。
func (s *Service) SaveAgentAPIConfig(in model.AgentAPIConfigSaveDO) ApiResult[model.AgentSettingsDO] {
	cur := s.store.GetAgentSettings()
	if strings.TrimSpace(in.APIKey) == "" && !cur.HasAPIKey {
		return ErrResult[model.AgentSettingsDO](errno.New(errno.CodeInvalidArg, "请填写 API Key", ""))
	}
	if err := s.store.SaveAgentAPIConfig(in); err != nil {
		return ErrResult[model.AgentSettingsDO](err)
	}
	return OkResult(s.store.GetAgentSettings())
}

// SaveAgentPermissions 保存 Agent 能力权限。
func (s *Service) SaveAgentPermissions(in model.AgentPermissionsSaveDO) ApiResult[model.AgentSettingsDO] {
	if in.ToolPermissionsJSON == "" {
		return ErrResult[model.AgentSettingsDO](errno.New(errno.CodeInvalidArg, "权限数据无效", ""))
	}
	if err := s.store.SaveAgentPermissions(in); err != nil {
		return ErrResult[model.AgentSettingsDO](err)
	}
	return OkResult(s.store.GetAgentSettings())
}

// SaveAgentSettings 保存 Agent 全部配置（兼容）。
func (s *Service) SaveAgentSettings(in model.AgentSettingsSaveDO) ApiResult[model.AgentSettingsDO] {
	if err := s.store.SaveAgentAPIConfig(model.AgentAPIConfigSaveDO{
		APIBase: in.APIBase, APIKey: in.APIKey, Model: in.Model, Provider: in.Provider,
	}); err != nil {
		return ErrResult[model.AgentSettingsDO](err)
	}
	if in.ToolPermissionsJSON != "" {
		if err := s.store.SaveAgentPermissions(model.AgentPermissionsSaveDO{
			AllowWrite: in.AllowWrite, ToolPermissionsJSON: in.ToolPermissionsJSON,
		}); err != nil {
			return ErrResult[model.AgentSettingsDO](err)
		}
	}
	cur := s.store.GetAgentSettings()
	if strings.TrimSpace(in.APIKey) == "" && !cur.HasAPIKey {
		return ErrResult[model.AgentSettingsDO](errno.New(errno.CodeInvalidArg, "请填写 API Key", ""))
	}
	return OkResult(cur)
}

// TestAgentConnection 测试 AI API 连接是否正常。
func (s *Service) TestAgentConnection() ApiResult[string] {
	if s.agentRunner == nil {
		return ErrResult[string](errAgentNotReady())
	}
	msg, err := s.agentRunner.TestConnection()
	if err != nil {
		return ErrResult[string](err)
	}
	return OkResult(msg)
}

// AgentChat 发送对话消息（异步，通过事件推送结果）。
func (s *Service) AgentChat(req model.AgentChatRequestDO) ApiResult[model.AgentChatResultDO] {
	if s.agentRunner == nil {
		return ErrResult[model.AgentChatResultDO](errAgentNotReady())
	}
	threadID, err := s.agentRunner.Chat(req)
	if err != nil {
		return ErrResult[model.AgentChatResultDO](err)
	}
	return OkResult(model.AgentChatResultDO{ThreadID: threadID})
}

// AgentStop 停止当前线程的 AI 生成。
func (s *Service) AgentStop(threadID string) ApiResult[bool] {
	if s.agentRunner == nil {
		return ErrResult[bool](errAgentNotReady())
	}
	if threadID == "" {
		return ErrResult[bool](errno.New(errno.CodeInvalidArg, "threadId 不能为空", ""))
	}
	return OkResult(s.agentRunner.Stop(threadID))
}

// AgentConfirm 确认或拒绝待执行操作。
func (s *Service) AgentConfirm(pendingID string, approved bool) ApiResult[bool] {
	if s.agentRunner == nil {
		return ErrResult[bool](errAgentNotReady())
	}
	if err := s.agentRunner.Confirm(pendingID, approved); err != nil {
		return ErrResult[bool](err)
	}
	return OkResult(true)
}

// ListAgentCapabilities 列出 AI 能力目录与当前权限开关。
func (s *Service) ListAgentCapabilities() ApiResult[[]model.AgentCapabilityDO] {
	return OkResult(s.store.BuildAgentCapabilities())
}

// ApplyAgentBailianPreset 应用阿里云百炼（千问）OpenAI 兼容端点预设。
func (s *Service) ApplyAgentBailianPreset() ApiResult[model.AgentSettingsDO] {
	if err := s.store.ApplyBailianPreset(); err != nil {
		return ErrResult[model.AgentSettingsDO](err)
	}
	return OkResult(s.store.GetAgentSettings())
}

// ListAgentThreads 列出已保存的对话线程。
func (s *Service) ListAgentThreads() ApiResult[[]model.AgentThreadDO] {
	list, err := s.store.ListAgentThreads(50)
	if err != nil {
		return ErrResult[[]model.AgentThreadDO](err)
	}
	if list == nil {
		list = []model.AgentThreadDO{}
	}
	return OkResult(list)
}

// ListAgentMessages 列出线程消息（优先 SQLite，供 UI 恢复对话）。
func (s *Service) ListAgentMessages(threadID string) ApiResult[[]model.AgentMessageDO] {
	if threadID == "" {
		return ErrResult[[]model.AgentMessageDO](errno.New(errno.CodeInvalidArg, "threadId 不能为空", ""))
	}
	list, err := s.store.ListAgentMessagesUI(threadID)
	if err != nil {
		return ErrResult[[]model.AgentMessageDO](err)
	}
	if len(list) > 0 {
		return OkResult(list)
	}
	if s.agentRunner == nil {
		return OkResult([]model.AgentMessageDO{})
	}
	mem := s.agentRunner.ListMessages(threadID)
	if mem == nil {
		mem = []model.AgentMessageDO{}
	}
	return OkResult(mem)
}
