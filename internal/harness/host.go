package harness

import (
	"context"
	"fmt"
	"path/filepath"
	"strings"

	"github.com/wcoreing/ningharness"
	"github.com/wcoreing/ningharness/defaults"
	"github.com/wcoreing/ningharness/guest"
	guestmodel "github.com/wcoreing/ningharness/guest/model"
	"github.com/wcoreing/ningharness/lifecycle"
	"github.com/wcoreing/ningharness/memory"
	"github.com/wcoreing/ningharness/resource"
	"github.com/wcoreing/ningharness/toolgateway"

	einomodel "github.com/cloudwego/eino/components/model"
	"github.com/cloudwego/eino/schema"
)

// Host WWorkbench 侧 harness 句柄。
type Host struct {
	RT     *defaults.Runtime
	Root   string
	Stream bool // 与 Open 时 Stream 配置一致；模型完成走 guest.Complete
}

// Open 在应用数据目录下打开 ningharness（内嵌、无 MCP HTTP；流式由框架 Stream 开关）。
func Open(appDataDir string, prepare func(*toolgateway.Gateway)) (*Host, error) {
	dir := filepath.Join(appDataDir, "ningharness")
	rt, err := defaults.Open(defaults.Opts{
		Opts: ningharness.Opts{
			DataDir:    dir,
			Root:       dir,
			ProjectKey: "wworkbench",
		},
		MCPAddr:        "off",
		WithoutEino:    true, // Guest 由 Runner 按轮 Set（工作台工具环）；流式走 guest.Complete
		WithoutMemory:  false,
		WithoutSkill:   false,
		Stream:         true,
		PrepareGateway: prepare,
	})
	if err != nil {
		return nil, fmt.Errorf("ningharness: %w", err)
	}
	// Lesson 前馈 + 回合 JSONL 沉淀（默认 NewLesson 的 Ingest 是 no-op）
	rt.SetMemory(memory.NewLessonWithFileIngest())
	lc := lifecycle.NewDefault(rt)
	// Guest 已写 assistant；此处 Ingest + 工具失败晋升 project lesson
	_ = lc.Replace(lifecycle.StepPersistTurn, func(ctx context.Context, st *lifecycle.RunState) error {
		if st == nil {
			return nil
		}
		reply := strings.TrimSpace(st.Reply)
		toolErrs := memory.ToolErrorsFromValues(st.Values)
		notes := memory.NotesFromToolErrors(toolErrs)
		if reply == "" && notes == "" {
			return nil
		}
		root := st.Root
		if root == "" {
			root = rt.Root()
		}
		if ing, ok := rt.Memory.(memory.Ingester); ok && ing != nil {
			if err := ing.Ingest(ctx, memory.IngestInput{
				Root:        root,
				SessionKey:  st.SessionKey,
				TaskID:      st.TaskID,
				Prompt:      st.Prompt,
				Reply:       reply,
				Feedforward: st.Feedforward,
				SkillIDs:    memory.SkillIDsFromValues(st.Values),
				Notes:       notes,
			}); err != nil {
				return err
			}
		}
		promoteToolErrorsToLessons(root, st.SessionKey, st.TaskID, toolErrs)
		return nil
	})
	rt.SetLifecycle(lc)
	return &Host{RT: rt, Root: dir, Stream: true}, nil
}

// Close 关闭宿主。
func (h *Host) Close() error {
	if h == nil || h.RT == nil {
		return nil
	}
	return h.RT.Close()
}

// NewChatModel 经 ningharness guest/model 工厂构造（产品勿自建 HTTP Provider）。
func (h *Host) NewChatModel(ctx context.Context, provider, apiKey, baseURL, modelName string) (einomodel.ToolCallingChatModel, error) {
	if h == nil {
		return nil, fmt.Errorf("harness: not open")
	}
	cm, _, err := guestmodel.NewChatModel(ctx, guestmodel.Config{
		Provider: guestmodel.ParseProvider(provider),
		APIKey:   apiKey,
		BaseURL:  baseURL,
		Model:    modelName,
	})
	return cm, err
}

// Complete 一轮进模：Stream 由 Host.Stream 或 ctx DeltaHandler 决定。
func (h *Host) Complete(ctx context.Context, cm einomodel.ToolCallingChatModel, msgs []*schema.Message, tools []*schema.ToolInfo) (*schema.Message, error) {
	if h == nil {
		return nil, fmt.Errorf("harness: not open")
	}
	return guest.Complete(ctx, guest.CompleteInput{
		Model:    cm,
		Messages: msgs,
		Tools:    tools,
		Stream:   h.Stream,
	})
}

// PutToolResult 工具结果落盘。
func (h *Host) PutToolResult(sessionKey, taskID, callID, toolName, body string) (id int64, summary string, err error) {
	if h == nil || h.Root == "" {
		return 0, "", fmt.Errorf("harness: not open")
	}
	return resource.Put(h.Root, resource.PutInput{
		SessionKey: sessionKey,
		TaskID:     taskID,
		ToolCallID: callID,
		ToolName:   toolName,
		Kind:       resource.KindToolResult,
		Phase:      "result",
		Body:       body,
	})
}

// PutToolCall 工具入参落盘。
func (h *Host) PutToolCall(sessionKey, taskID, callID, toolName, body string) (id int64, summary string, err error) {
	if h == nil || h.Root == "" {
		return 0, "", fmt.Errorf("harness: not open")
	}
	return resource.Put(h.Root, resource.PutInput{
		SessionKey: sessionKey,
		TaskID:     taskID,
		ToolCallID: callID,
		ToolName:   toolName,
		Kind:       resource.KindToolCall,
		Phase:      "call",
		Body:       body,
	})
}

// Gateway 返回工具网关（可空）。
func (h *Host) Gateway() *toolgateway.Gateway {
	if h == nil || h.RT == nil {
		return nil
	}
	return h.RT.ToolGateway
}
