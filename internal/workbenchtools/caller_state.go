package workbenchtools

import (
	"context"
	"strings"
	"sync"
	"time"
)

// 调用方标识：MCP / 侧栏 Agent thread / UI 默认互不串「当前任务」与 intent 环。
const (
	CallerDefault = "default"
	CallerMCP     = "mcp"
)

type callerCtxKey struct{}

// WithCaller 把工具调用方写入 ctx（入口：MCP handler / Agent runTurn）。
func WithCaller(ctx context.Context, id string) context.Context {
	if ctx == nil {
		ctx = context.Background()
	}
	id = normalizeCallerID(id)
	return context.WithValue(ctx, callerCtxKey{}, id)
}

// CallerAgent 侧栏/内置 Agent 按 thread 隔离。
func CallerAgent(threadID string) string {
	threadID = strings.TrimSpace(threadID)
	if threadID == "" {
		return "agent"
	}
	return "agent:" + threadID
}

// CallerID 从 ctx 取调用方；缺省为 CallerDefault（UI / 未标注）。
func CallerID(ctx context.Context) string {
	if ctx == nil {
		return CallerDefault
	}
	if v, ok := ctx.Value(callerCtxKey{}).(string); ok {
		return normalizeCallerID(v)
	}
	return CallerDefault
}

func normalizeCallerID(id string) string {
	id = strings.TrimSpace(id)
	if id == "" {
		return CallerDefault
	}
	return id
}

// callerState 单调用方进程内会话态（非任务名；任务名仍是浏览器 session / TaskRun.Session）。
type callerState struct {
	mu              sync.Mutex
	currentTaskSess string
	intentLog       []IntentCard
	rulesAckUntil   int64
}

var callerStates sync.Map // string -> *callerState

func stateOf(ctx context.Context) *callerState {
	return stateOfID(CallerID(ctx))
}

func stateOfID(id string) *callerState {
	id = normalizeCallerID(id)
	if v, ok := callerStates.Load(id); ok {
		return v.(*callerState)
	}
	st := &callerState{currentTaskSess: adhocTaskSession}
	actual, _ := callerStates.LoadOrStore(id, st)
	return actual.(*callerState)
}

func (st *callerState) setCurrentTask(session string) {
	st.mu.Lock()
	st.currentTaskSess = normalizeTaskSession(session)
	st.mu.Unlock()
}

func (st *callerState) currentTask() string {
	st.mu.Lock()
	defer st.mu.Unlock()
	if st.currentTaskSess == "" {
		return adhocTaskSession
	}
	return st.currentTaskSess
}

func (st *callerState) hasActiveTask() bool {
	st.mu.Lock()
	defer st.mu.Unlock()
	return st.currentTaskSess != "" && st.currentTaskSess != adhocTaskSession
}

func (st *callerState) clearCurrentIf(session string) {
	session = normalizeTaskSession(session)
	st.mu.Lock()
	if st.currentTaskSess == session {
		st.currentTaskSess = adhocTaskSession
	}
	st.mu.Unlock()
}

func clearCurrentTaskEverywhere(session string) {
	session = normalizeTaskSession(session)
	callerStates.Range(func(_, v any) bool {
		if st, ok := v.(*callerState); ok {
			st.clearCurrentIf(session)
		}
		return true
	})
}

func (st *callerState) recordIntent(c IntentCard) {
	c.Intent = strings.TrimSpace(c.Intent)
	if c.Intent == "" {
		return
	}
	if c.At == 0 {
		c.At = time.Now().Unix()
	}
	st.mu.Lock()
	defer st.mu.Unlock()
	st.intentLog = append([]IntentCard{c}, st.intentLog...)
	if len(st.intentLog) > intentMaxStore {
		st.intentLog = st.intentLog[:intentMaxStore]
	}
}

func (st *callerState) markIntentApproved(toolName, intent string, approved bool) {
	toolName = strings.TrimSpace(toolName)
	intent = strings.TrimSpace(intent)
	if intent == "" {
		return
	}
	st.mu.Lock()
	defer st.mu.Unlock()
	for i := range st.intentLog {
		if st.intentLog[i].Approved != nil {
			continue
		}
		if st.intentLog[i].Intent == intent && (toolName == "" || st.intentLog[i].Tool == toolName) {
			v := approved
			st.intentLog[i].Approved = &v
			return
		}
	}
}

func (st *callerState) listIntents(limit int) []IntentCard {
	if limit <= 0 {
		limit = 20
	}
	st.mu.Lock()
	defer st.mu.Unlock()
	if limit > len(st.intentLog) {
		limit = len(st.intentLog)
	}
	out := make([]IntentCard, limit)
	copy(out, st.intentLog[:limit])
	return out
}

func (st *callerState) markRulesAck() {
	st.mu.Lock()
	st.rulesAckUntil = time.Now().Add(agentRulesAckTTL).Unix()
	st.mu.Unlock()
}

func (st *callerState) rulesAcked() bool {
	st.mu.Lock()
	until := st.rulesAckUntil
	st.mu.Unlock()
	return until > 0 && time.Now().Unix() <= until
}

// resetCallerStateForTest 单测重置某调用方态。
func resetCallerStateForTest(id string) {
	callerStates.Delete(normalizeCallerID(id))
}
