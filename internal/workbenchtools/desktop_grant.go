package workbenchtools

import (
	"context"
	"encoding/json"
	"os"
	"strings"
	"sync"
	"time"

	"WWorkbench/internal/desktop"
	"WWorkbench/internal/store"
)

const desktopGrantSettingKey = "desktop_app_grants"

// 桌面应用授权级别；act 含 read。
const (
	DesktopLevelRead = "read"
	DesktopLevelAct  = "act"
)

// DesktopGrant 用户允许 AI 读取 / 操作的一个桌面应用。
type DesktopGrant struct {
	Key   string `json:"key"`   // bundle id（缺失时为应用名）
	Name  string `json:"name"`  // 显示名
	Level string `json:"level"` // read | act
	At    int64  `json:"at"`
}

// DesktopGrantBook 桌面应用授权簿：默认为空，AI 一个应用都读不了；内存 + app_settings 持久化。
type DesktopGrantBook struct {
	mu    sync.RWMutex
	items []DesktopGrant
	store *store.Store

	askMu sync.Mutex // 授权弹窗串行：并发请求同一应用时只问一次
}

// NewDesktopGrantBook 从设置加载授权簿。
func NewDesktopGrantBook(st *store.Store) *DesktopGrantBook {
	b := &DesktopGrantBook{store: st}
	if st == nil {
		return b
	}
	raw, err := st.GetAppSetting(desktopGrantSettingKey)
	if err != nil || strings.TrimSpace(raw) == "" {
		return b
	}
	var items []DesktopGrant
	if json.Unmarshal([]byte(raw), &items) == nil {
		b.items = items
	}
	return b
}

func (b *DesktopGrantBook) persistLocked() {
	if b.store == nil {
		return
	}
	raw, _ := json.Marshal(b.items)
	_ = b.store.SetAppSetting(desktopGrantSettingKey, string(raw))
}

// List 当前授权。
func (b *DesktopGrantBook) List() []DesktopGrant {
	if b == nil {
		return nil
	}
	b.mu.RLock()
	defer b.mu.RUnlock()
	out := make([]DesktopGrant, len(b.items))
	copy(out, b.items)
	return out
}

// Level 应用当前的授权级别；未授权返回空。
func (b *DesktopGrantBook) Level(key string) string {
	if b == nil {
		return ""
	}
	b.mu.RLock()
	defer b.mu.RUnlock()
	for _, it := range b.items {
		if strings.EqualFold(it.Key, key) {
			return it.Level
		}
	}
	return ""
}

// Allows 应用是否已有不低于 need 的授权。
func (b *DesktopGrantBook) Allows(key, need string) bool {
	return desktopLevelCovers(b.Level(key), need)
}

// allowsName 应用未运行、拿不到 bundle id 时，按调用方给的名字匹配已有授权（key 或显示名）。
func (b *DesktopGrantBook) allowsName(name, need string) bool {
	if b == nil {
		return false
	}
	b.mu.RLock()
	defer b.mu.RUnlock()
	for _, it := range b.items {
		if (strings.EqualFold(it.Key, name) || strings.EqualFold(it.Name, name)) && desktopLevelCovers(it.Level, need) {
			return true
		}
	}
	return false
}

func desktopLevelCovers(have, need string) bool {
	return have == DesktopLevelAct || (have == DesktopLevelRead && need == DesktopLevelRead)
}

// Grant 授权（同一应用只升不降；降级走 Revoke 后重新授权）。
func (b *DesktopGrantBook) Grant(key, name, level string) DesktopGrant {
	item := DesktopGrant{Key: key, Name: name, Level: level, At: time.Now().Unix()}
	if b == nil {
		return item
	}
	b.mu.Lock()
	defer b.mu.Unlock()
	for i, it := range b.items {
		if strings.EqualFold(it.Key, key) {
			if it.Level == DesktopLevelAct {
				item.Level = DesktopLevelAct
			}
			b.items[i] = item
			b.persistLocked()
			return item
		}
	}
	b.items = append(b.items, item)
	b.persistLocked()
	return item
}

// Revoke 撤销某应用的授权；返回撤销条数。
func (b *DesktopGrantBook) Revoke(key string) int {
	if b == nil {
		return 0
	}
	b.mu.Lock()
	defer b.mu.Unlock()
	n := 0
	next := b.items[:0]
	for _, it := range b.items {
		if strings.EqualFold(it.Key, key) {
			n++
			continue
		}
		next = append(next, it)
	}
	b.items = next
	b.persistLocked()
	return n
}

// workbenchBundleID 工作台自身的 bundle id（build/darwin/Info.plist）。
const workbenchBundleID = "com.wails.WWorkbench"

// isWorkbenchSelf 是否工作台自身（含另一个实例）：授权与确认弹窗都在工作台里，AI 能点到它就等于能替用户拍板。
func isWorkbenchSelf(app desktop.App) bool {
	return app.PID == os.Getpid() || strings.EqualFold(app.BundleID, workbenchBundleID)
}

// desktopAccess 应用对 AI 的可见级别（desktop_apps 前馈用）。
func desktopAccess(d *Deps, app desktop.App) string {
	if isWorkbenchSelf(app) {
		return "self"
	}
	if lv := d.DesktopGrants.Level(app.Key()); lv != "" {
		return lv
	}
	return "none"
}

// ensureDesktopAccess 检查应用授权；不足时在工作台弹窗请用户拍板，通过即落授权簿。
// 在 handler 内直接阻塞：授权不是「待确认的写操作」，对内置侧栏 Agent 与外置 MCP 必须是同一道门。
func ensureDesktopAccess(ctx context.Context, d *Deps, app desktop.App, need, tool, intent string) error {
	if d == nil || d.DesktopGrants == nil {
		return errStr("桌面授权簿未就绪")
	}
	if isWorkbenchSelf(app) {
		return errStr("不能让 AI 读取或操作工作台自身：授权与确认弹窗都在这里，必须由用户本人点")
	}
	book := d.DesktopGrants
	if book.Allows(app.Key(), need) {
		return nil
	}
	book.askMu.Lock()
	defer book.askMu.Unlock()
	if book.Allows(app.Key(), need) {
		return nil
	}
	if err := askDesktopGrant(ctx, d, app, need, tool, intent); err != nil {
		return err
	}
	book.Grant(app.Key(), app.Name, need)
	return nil
}

// askDesktopGrant 弹出应用授权确认；用户拒绝或超时返回错误。
func askDesktopGrant(ctx context.Context, d *Deps, app desktop.App, need, tool, intent string) error {
	if d.MCPConfirm == nil {
		return errStr("工作台确认门未就绪，请在 App 内打开 WWorkbench 后重试")
	}
	summary := "允许 AI 读取「" + app.Name + "」的界面？"
	scope := "读取界面内容（元素、文本、窗口标题、截图）"
	if need == DesktopLevelAct {
		summary = "允许 AI 操作「" + app.Name + "」？"
		scope = "点击、输入、按键（含读取界面内容）"
	}
	preview := map[string]interface{}{
		"app":   app.Name,
		"scope": scope,
		"note":  "只对这一个应用生效，长期有效；可在「AI 权限」里随时撤销。",
	}
	if app.BundleID != "" {
		preview["bundleId"] = app.BundleID
	}
	if intent != "" {
		preview["intent"] = intent
	}
	if risk := desktopRisk(app); risk != "" {
		preview["risk"] = risk
	}
	raw, _ := json.Marshal(preview)
	approved, err := d.MCPConfirm.Await(ctx, MCPConfirmRequest{
		ToolName:     tool,
		Summary:      summary,
		Preview:      raw,
		ConfirmLabel: "允许",
	})
	if err != nil {
		return err
	}
	if !approved {
		return errStr("用户未允许 AI " + desktopLevelLabel(need) + "应用「" + app.Name + "」。不要重复请求；先向用户说明为什么需要它，由用户决定")
	}
	return nil
}

func desktopLevelLabel(level string) string {
	if level == DesktopLevelAct {
		return "操作"
	}
	return "读取"
}

// desktopRisk 高风险应用：在授权弹窗里把后果说在前面（提示，不是拦截）。
func desktopRisk(app desktop.App) string {
	switch strings.ToLower(app.BundleID) {
	case "com.apple.systempreferences", "com.apple.systemsettings":
		return "系统设置：可改动系统与隐私权限"
	case "com.apple.keychainaccess", "com.apple.passwords", "com.1password.1password",
		"com.agilebits.onepassword7", "com.bitwarden.desktop":
		return "密码管理：界面里有账号与密码"
	case "com.apple.terminal", "com.googlecode.iterm2", "dev.warp.warp-stable",
		"com.mitchellh.ghostty", "net.kovidgoyal.kitty":
		return "终端：等同可执行任意命令，且不经过工作台的命令确认"
	default:
		return ""
	}
}
