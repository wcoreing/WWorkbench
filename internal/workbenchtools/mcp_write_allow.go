package workbenchtools

import (
	"encoding/json"
	"path"
	"regexp"
	"strings"
	"sync"
	"time"

	"WWorkbench/internal/store"
)

var reRedirectTarget = regexp.MustCompile(`(?:^|[\s;|&])>{1,2}\s*([^\s;|&><]+)`)

const mcpWriteAllowSettingKey = "mcp_write_allows"

// MCPWriteAllow 终端右键授权：该主机/本机某绝对路径下，软文件写免确认。
type MCPWriteAllow struct {
	HostKey string `json:"hostKey"` // "local" 或 ssh/docker hostId
	Path    string `json:"path"`
	At      int64  `json:"at"`
}

// MCPWriteAllowBook 内存 + app_settings 持久化。
type MCPWriteAllowBook struct {
	mu    sync.RWMutex
	items []MCPWriteAllow
	store *store.Store
}

// NewMCPWriteAllowBook 从设置加载授权簿。
func NewMCPWriteAllowBook(st *store.Store) *MCPWriteAllowBook {
	b := &MCPWriteAllowBook{store: st, items: nil}
	b.load()
	return b
}

func (b *MCPWriteAllowBook) load() {
	if b == nil || b.store == nil {
		return
	}
	raw, err := b.store.GetAppSetting(mcpWriteAllowSettingKey)
	if err != nil || strings.TrimSpace(raw) == "" {
		return
	}
	var items []MCPWriteAllow
	if json.Unmarshal([]byte(raw), &items) != nil {
		return
	}
	b.mu.Lock()
	b.items = normalizeAllows(items)
	b.mu.Unlock()
}

func (b *MCPWriteAllowBook) persistLocked() {
	if b == nil || b.store == nil {
		return
	}
	raw, _ := json.Marshal(b.items)
	_ = b.store.SetAppSetting(mcpWriteAllowSettingKey, string(raw))
}

// List 当前授权。
func (b *MCPWriteAllowBook) List() []MCPWriteAllow {
	if b == nil {
		return nil
	}
	b.mu.RLock()
	defer b.mu.RUnlock()
	out := make([]MCPWriteAllow, len(b.items))
	copy(out, b.items)
	return out
}

// Grant 授权某主机下的绝对路径（同 hostKey+path 去重更新）。
func (b *MCPWriteAllowBook) Grant(hostKey, absPath string) MCPWriteAllow {
	hostKey = hostKeyOrLocal(hostKey)
	absPath = cleanAbsPath(absPath)
	item := MCPWriteAllow{HostKey: hostKey, Path: absPath, At: time.Now().Unix()}
	if b == nil {
		return item
	}
	b.mu.Lock()
	defer b.mu.Unlock()
	for i, it := range b.items {
		if it.HostKey == hostKey && it.Path == absPath {
			b.items[i] = item
			b.persistLocked()
			return item
		}
	}
	b.items = append(b.items, item)
	b.persistLocked()
	return item
}

// Revoke 取消授权；path 空则取消该 hostKey 全部。
func (b *MCPWriteAllowBook) Revoke(hostKey, absPath string) int {
	if b == nil {
		return 0
	}
	hostKey = hostKeyOrLocal(hostKey)
	absPath = strings.TrimSpace(absPath)
	b.mu.Lock()
	defer b.mu.Unlock()
	n := 0
	next := b.items[:0]
	for _, it := range b.items {
		if it.HostKey != hostKey {
			next = append(next, it)
			continue
		}
		if absPath != "" && it.Path != cleanAbsPath(absPath) {
			next = append(next, it)
			continue
		}
		n++
	}
	b.items = next
	b.persistLocked()
	return n
}

// WaiveSoftFileRisk 软文件写（重定向/tee/rm）若目标落在授权目录下则免确认。
// 硬风险（rsync/数据文件/库导入等）与受保护路径（*.db/data/.env）永不免除。
func (b *MCPWriteAllowBook) WaiveSoftFileRisk(hostKey, cmd, reason string) bool {
	if b == nil || !isSoftFileRiskReason(reason) || isHardShellRiskReason(reason) {
		return false
	}
	if mentionsProtectedData(cmd) || len(extractProtectedWriteTargets(cmd)) > 0 {
		return false
	}
	hostKey = hostKeyOrLocal(hostKey)
	b.mu.RLock()
	allows := make([]MCPWriteAllow, 0, len(b.items))
	for _, it := range b.items {
		if it.HostKey == hostKey {
			allows = append(allows, it)
		}
	}
	b.mu.RUnlock()
	if len(allows) == 0 {
		return false
	}
	targets := extractShellWriteTargets(cmd)
	if len(targets) == 0 {
		// 纯相对路径写：视为落在已授权目录内（用户已声明「当前目录可写」）
		return true
	}
	for _, t := range targets {
		if isProtectedDataPath(t) || !pathUnderAnyAllow(t, allows) {
			return false
		}
	}
	return true
}

func hostKeyOrLocal(hostKey string) string {
	if strings.TrimSpace(hostKey) == "" {
		return "local"
	}
	return strings.TrimSpace(hostKey)
}

func cleanAbsPath(p string) string {
	p = strings.TrimSpace(p)
	if p == "" {
		return ""
	}
	return path.Clean(p)
}

func normalizeAllows(in []MCPWriteAllow) []MCPWriteAllow {
	out := make([]MCPWriteAllow, 0, len(in))
	seen := map[string]bool{}
	for _, it := range in {
		hk := hostKeyOrLocal(it.HostKey)
		p := cleanAbsPath(it.Path)
		if p == "" || !strings.HasPrefix(p, "/") {
			continue
		}
		k := hk + "\x00" + p
		if seen[k] {
			continue
		}
		seen[k] = true
		out = append(out, MCPWriteAllow{HostKey: hk, Path: p, At: it.At})
	}
	return out
}

func pathUnderAnyAllow(target string, allows []MCPWriteAllow) bool {
	t := cleanAbsPath(target)
	if t == "" {
		return false
	}
	for _, a := range allows {
		ap := a.Path
		if t == ap || strings.HasPrefix(t, strings.TrimRight(ap, "/")+"/") {
			return true
		}
	}
	return false
}

func isSoftFileRiskReason(reason string) bool {
	switch reason {
	case "写入文件（含重定向 > / >>）", "tee 写入文件", "删除文件/目录（rm）":
		return true
	default:
		return false
	}
}

// extractShellWriteTargets 抽出命令中的绝对路径写目标；相对路径忽略（由授权目录兜底）。
func extractShellWriteTargets(cmd string) []string {
	s := strings.TrimSpace(cmd)
	if s == "" {
		return nil
	}
	// 先去掉 2>&1 这类 fd 重定向，避免误伤
	s = reFdRedirect.ReplaceAllString(s, " ")
	var out []string
	add := func(p string) {
		p = strings.Trim(p, `"'`)
		p = strings.TrimSpace(p)
		if p == "" || !strings.HasPrefix(p, "/") {
			return
		}
		out = append(out, cleanAbsPath(p))
	}
	for _, m := range reRedirectTarget.FindAllStringSubmatch(s, -1) {
		if len(m) > 1 {
			add(m[1])
		}
	}
	fields := strings.Fields(s)
	for i, f := range fields {
		low := strings.ToLower(strings.TrimSpace(f))
		if low != "rm" && low != "tee" {
			continue
		}
		for _, a := range fields[i+1:] {
			if strings.HasPrefix(a, "-") {
				continue
			}
			add(a)
		}
	}
	return uniqueStrings(out)
}

func uniqueStrings(in []string) []string {
	seen := map[string]bool{}
	out := make([]string, 0, len(in))
	for _, s := range in {
		if s == "" || seen[s] {
			continue
		}
		seen[s] = true
		out = append(out, s)
	}
	return out
}
