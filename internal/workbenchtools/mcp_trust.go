package workbenchtools

import (
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"fmt"
	"strings"
	"sync"
	"time"

	"WWorkbench/internal/store"
)

const mcpTrustOpsSettingKey = "mcp_trust_ops"

// MCPTrustOp 运行时信任条目：同类非硬风险操作可免确认。
type MCPTrustOp struct {
	Tool        string `json:"tool"`
	HostKey     string `json:"hostKey"`
	Fingerprint string `json:"fingerprint"`
	Intent      string `json:"intent,omitempty"`
	Command     string `json:"command,omitempty"`
	Risk        string `json:"risk,omitempty"`
	ProjectID   string `json:"projectId,omitempty"`
	SkillPath   string `json:"skillPath,omitempty"`
	Summary     string `json:"summary,omitempty"`
	At          int64  `json:"at"`
}

// MCPTrustBook 内存 + app_settings 持久化。
type MCPTrustBook struct {
	mu    sync.RWMutex
	items []MCPTrustOp
	store *store.Store
}

// NewMCPTrustBook 从设置加载信任账本。
func NewMCPTrustBook(st *store.Store) *MCPTrustBook {
	b := &MCPTrustBook{store: st}
	b.load()
	return b
}

func (b *MCPTrustBook) load() {
	if b == nil || b.store == nil {
		return
	}
	raw, err := b.store.GetAppSetting(mcpTrustOpsSettingKey)
	if err != nil || strings.TrimSpace(raw) == "" {
		return
	}
	var items []MCPTrustOp
	if json.Unmarshal([]byte(raw), &items) != nil {
		return
	}
	b.mu.Lock()
	b.items = normalizeTrustOps(items)
	b.mu.Unlock()
}

func (b *MCPTrustBook) persistLocked() {
	if b == nil || b.store == nil {
		return
	}
	raw, _ := json.Marshal(b.items)
	_ = b.store.SetAppSetting(mcpTrustOpsSettingKey, string(raw))
}

// List 当前信任条目（新→旧）。
func (b *MCPTrustBook) List() []MCPTrustOp {
	if b == nil {
		return nil
	}
	b.mu.RLock()
	defer b.mu.RUnlock()
	out := make([]MCPTrustOp, len(b.items))
	copy(out, b.items)
	return out
}

// Match 命中同工具+主机+指纹且非硬风险时可免确认。
func (b *MCPTrustBook) Match(tool, hostKey, command, intent, risk string) bool {
	if b == nil {
		return false
	}
	if isHardShellRiskReason(strings.TrimSpace(risk)) {
		return false
	}
	fp := TrustFingerprint(tool, hostKey, command, intent)
	if fp == "" {
		return false
	}
	b.mu.RLock()
	defer b.mu.RUnlock()
	for _, it := range b.items {
		if it.Fingerprint == fp && strings.EqualFold(it.Tool, strings.TrimSpace(tool)) {
			return true
		}
	}
	return false
}

// Grant 写入/更新信任条目（硬风险拒绝）。
func (b *MCPTrustBook) Grant(op MCPTrustOp) (MCPTrustOp, error) {
	if isHardShellRiskReason(strings.TrimSpace(op.Risk)) {
		return MCPTrustOp{}, fmt.Errorf("硬风险不可信任")
	}
	op.Tool = strings.TrimSpace(op.Tool)
	op.HostKey = hostKeyOrLocal(op.HostKey)
	op.Command = strings.TrimSpace(op.Command)
	op.Intent = strings.TrimSpace(op.Intent)
	op.Risk = strings.TrimSpace(op.Risk)
	op.ProjectID = strings.TrimSpace(op.ProjectID)
	op.SkillPath = strings.TrimSpace(op.SkillPath)
	op.Summary = strings.TrimSpace(op.Summary)
	op.Fingerprint = TrustFingerprint(op.Tool, op.HostKey, op.Command, op.Intent)
	if op.Tool == "" || op.Fingerprint == "" {
		return MCPTrustOp{}, fmt.Errorf("信任指纹无效")
	}
	op.At = time.Now().Unix()
	if b == nil {
		return op, nil
	}
	b.mu.Lock()
	defer b.mu.Unlock()
	for i, it := range b.items {
		if it.Fingerprint == op.Fingerprint {
			b.items[i] = op
			b.persistLocked()
			return op, nil
		}
	}
	b.items = append([]MCPTrustOp{op}, b.items...)
	b.persistLocked()
	return op, nil
}

// Revoke 按指纹撤销；返回是否找到。
func (b *MCPTrustBook) Revoke(fingerprint string) bool {
	if b == nil {
		return false
	}
	fingerprint = strings.TrimSpace(fingerprint)
	if fingerprint == "" {
		return false
	}
	b.mu.Lock()
	defer b.mu.Unlock()
	n := 0
	next := b.items[:0]
	for _, it := range b.items {
		if it.Fingerprint == fingerprint {
			n++
			continue
		}
		next = append(next, it)
	}
	b.items = next
	if n > 0 {
		b.persistLocked()
	}
	return n > 0
}

// TrustFingerprint sha256(tool|hostKey|norm(command或intent))。
func TrustFingerprint(tool, hostKey, command, intent string) string {
	tool = strings.TrimSpace(tool)
	hostKey = hostKeyOrLocal(hostKey)
	key := normalizeTrustKey(command)
	if key == "" {
		key = normalizeTrustKey(intent)
	}
	if tool == "" || key == "" {
		return ""
	}
	sum := sha256.Sum256([]byte(tool + "|" + hostKey + "|" + key))
	return hex.EncodeToString(sum[:])
}

// ShortTrustFingerprint 展示用短哈希。
func ShortTrustFingerprint(fp string) string {
	fp = strings.TrimSpace(fp)
	if len(fp) <= 12 {
		return fp
	}
	return fp[:12]
}

func normalizeTrustKey(s string) string {
	s = strings.TrimSpace(s)
	if s == "" {
		return ""
	}
	fields := strings.Fields(s)
	return strings.Join(fields, " ")
}

func normalizeTrustOps(in []MCPTrustOp) []MCPTrustOp {
	out := make([]MCPTrustOp, 0, len(in))
	seen := map[string]bool{}
	for _, it := range in {
		fp := strings.TrimSpace(it.Fingerprint)
		if fp == "" {
			fp = TrustFingerprint(it.Tool, it.HostKey, it.Command, it.Intent)
		}
		if fp == "" || seen[fp] {
			continue
		}
		seen[fp] = true
		it.Fingerprint = fp
		it.HostKey = hostKeyOrLocal(it.HostKey)
		out = append(out, it)
	}
	return out
}
