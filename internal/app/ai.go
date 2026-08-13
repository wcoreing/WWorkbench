package app

import (
	"log"
	"strings"

	"WWorkbench/internal/agent"
	"WWorkbench/internal/errno"
	"WWorkbench/internal/harness"
	"WWorkbench/internal/model"
	"WWorkbench/internal/store"
	"WWorkbench/internal/workbenchtools"

	"github.com/wailsapp/wails/v2/pkg/runtime"
	"github.com/wcoreing/ningharness/toolgateway"
)

// wireAgentRunner 初始化 ningharness + Agent 编排器。
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
		Notebook:  s.notebook,
		Docker:    s.docker,
		UIActions: workbenchtools.NewUIActionBus(emit),
	}
	reg := workbenchtools.NewRegistry(deps)

	var host *harness.Host
	dataDir, err := store.DataDir()
	if err != nil {
		log.Printf("harness: data dir: %v", err)
	} else {
		host, err = harness.Open(dataDir, func(gw *toolgateway.Gateway) {
			harness.RegisterWorkbenchTools(gw, reg, func() map[string]bool {
				return s.store.GetToolPermissions()
			})
		})
		if err != nil {
			log.Printf("harness: open failed: %v", err)
			host = nil
		} else {
			s.harnessHost = host
			log.Printf("harness: opened at %s", host.Root)
		}
	}
	s.agentRunner = agent.NewRunner(s.store, reg, host, s.ctx, emit)
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

// ApplyAgentProviderPreset 应用 AI 服务商预设（bailian / deepseek / minimax）。
func (s *Service) ApplyAgentProviderPreset(provider string) ApiResult[model.AgentSettingsDO] {
	if err := s.store.ApplyProviderPreset(provider); err != nil {
		return ErrResult[model.AgentSettingsDO](err)
	}
	return OkResult(s.store.GetAgentSettings())
}

// GetAgentThread 读取对话线程及上下文（供恢复 @ 资源）。
func (s *Service) GetAgentThread(threadID string) ApiResult[model.AgentThreadDetailDO] {
	if threadID == "" {
		return ErrResult[model.AgentThreadDetailDO](errno.New(errno.CodeInvalidArg, "threadId 不能为空", ""))
	}
	if s.harnessHost == nil {
		return ErrResult[model.AgentThreadDetailDO](errAgentNotReady())
	}
	info, mentions, _, err := s.harnessHost.GetSession(threadID)
	if err != nil {
		return ErrResult[model.AgentThreadDetailDO](errno.New(errno.CodeNotFound, err.Error(), threadID))
	}
	return OkResult(model.AgentThreadDetailDO{
		ID: info.ID, Title: info.Title, UpdatedAt: info.UpdatedAt,
		Context: model.AgentContextDO{Mentions: mentions},
	})
}

// ListAgentThreads 列出已保存的对话线程。
func (s *Service) ListAgentThreads() ApiResult[[]model.AgentThreadDO] {
	if s.harnessHost == nil {
		return OkResult([]model.AgentThreadDO{})
	}
	list, err := s.harnessHost.ListSessions(50)
	if err != nil {
		return ErrResult[[]model.AgentThreadDO](err)
	}
	out := make([]model.AgentThreadDO, 0, len(list))
	for _, sess := range list {
		out = append(out, model.AgentThreadDO{ID: sess.ID, Title: sess.Title, UpdatedAt: sess.UpdatedAt})
	}
	return OkResult(out)
}

// ListAgentMessages 列出线程消息（ningharness history）。
func (s *Service) ListAgentMessages(threadID string) ApiResult[[]model.AgentMessageDO] {
	if threadID == "" {
		return ErrResult[[]model.AgentMessageDO](errno.New(errno.CodeInvalidArg, "threadId 不能为空", ""))
	}
	if s.agentRunner != nil {
		mem := s.agentRunner.ListMessages(threadID)
		if mem == nil {
			mem = []model.AgentMessageDO{}
		}
		return OkResult(mem)
	}
	return OkResult([]model.AgentMessageDO{})
}

// AgentRewind 截断会话工作记忆（保留 keepSeq 及之前的消息）。
func (s *Service) AgentRewind(threadID string, keepSeq int) ApiResult[bool] {
	if threadID == "" {
		return ErrResult[bool](errno.New(errno.CodeInvalidArg, "threadId 不能为空", ""))
	}
	if keepSeq < 0 {
		return ErrResult[bool](errno.New(errno.CodeInvalidArg, "keepSeq 无效", ""))
	}
	if s.agentRunner == nil {
		if s.harnessHost != nil {
			if err := s.harnessHost.RewindHistory(threadID, keepSeq); err != nil {
				return ErrResult[bool](err)
			}
			return OkResult(true)
		}
		return ErrResult[bool](errAgentNotReady())
	}
	if err := s.agentRunner.Rewind(threadID, keepSeq); err != nil {
		return ErrResult[bool](err)
	}
	return OkResult(true)
}
