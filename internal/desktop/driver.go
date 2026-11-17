// Package desktop 桌面应用驱动：以子进程调用 vercel-labs/agent-desktop，经系统无障碍树读取与操作原生应用界面。
// 本包只负责「怎么驱动」；哪些应用允许 AI 读取 / 操作由 workbenchtools 的授权簿决定。
package desktop

import (
	"bytes"
	"context"
	"encoding/json"
	"os"
	"os/exec"
	"path/filepath"
	"regexp"
	"runtime"
	"strings"
	"sync"
	"time"

	"WWorkbench/internal/errno"
)

// ProviderName 任务账本里的执行器名。
const ProviderName = "agent-desktop"

// InstallHint 未安装时的前馈提示。
const InstallHint = "从 github.com/vercel-labs/agent-desktop/releases 下载本机平台的压缩包，解压到 ~/.wworkbench/toolchains/agent-desktop/（agent-desktop 与随包的 helper 须在同一目录）"

const (
	defaultCallTimeout = 20 * time.Second
	maxSnapshots       = 200 // 登记表保留的快照数；更早的 ref 需重新快照
)

// 错误码（agent-desktop 的 error.code）。
const (
	CodeAppNotFound = "APP_NOT_FOUND"
	CodeTimeout     = "TIMEOUT"
	CodeAmbiguous   = "AMBIGUOUS_TARGET"
	CodeInvalidArgs = "INVALID_ARGS"
	CodePolicy      = "POLICY_DENIED"
)

// Error agent-desktop 返回的结构化失败。
type Error struct {
	Code       string
	Message    string
	Suggestion string
	// Delivered 失败前动作已送达应用（例如动作成功、但随后等待的条件没出现）；此时不可重复执行。
	Delivered bool
}

func (e *Error) Error() string {
	msg := e.Code + ": " + e.Message
	if hint := errorHints[e.Code]; hint != "" {
		return msg + "（" + hint + "）"
	}
	if e.Suggestion != "" {
		return msg + "（" + e.Suggestion + "）"
	}
	return msg
}

// errorHints 把常见错误码翻成下一步该调哪个工具。
var errorHints = map[string]string{
	"STALE_REF":            "界面已变化或应用已重启，请重新 desktop_snapshot / desktop_find 取新的 ref",
	"SNAPSHOT_NOT_FOUND":   "该 ref 所属快照已失效，请重新 desktop_snapshot",
	CodeAppNotFound:        "应用未运行：先 desktop_apps 核对名称，或 desktop_launch 启动",
	"WINDOW_NOT_FOUND":     "应用没有可用窗口：desktop_apps(app=…) 看窗口列表，或 desktop_launch 让它呈现窗口",
	"PERM_DENIED":          "系统未授予辅助功能 / 屏幕录制权限：请用户在「系统设置 → 隐私与安全性」里允许 WWorkbench，desktop_status 可复查",
	"ACTION_NOT_SUPPORTED": "该元素不支持这个动作：看快照里它的 actions，换目标或换动作（下拉可先 click 展开再点选项）",
	CodePolicy:             "该操作被安全策略拦下；危险快捷键需 desktop_act(force=true)，由用户逐次确认",
	"APP_UNRESPONSIVE":     "应用无响应，稍后重试或请用户查看该应用",
}

// IsCode err 是否为指定错误码的 agent-desktop 失败。
func IsCode(err error, code string) bool {
	e, ok := err.(*Error)
	return ok && e.Code == code
}

// App 一个正在运行的桌面应用。
type App struct {
	Name     string `json:"name"`
	BundleID string `json:"bundleId,omitempty"`
	PID      int    `json:"pid,omitempty"`
	// Foreground 有常规界面的应用（出现在程序坞 / 可切换）；其余是后台代理与辅助进程。
	Foreground bool `json:"-"`
}

// Key 授权与审计用的稳定标识：bundle id 优先（显示名随系统语言变化）。
func (a App) Key() string {
	if a.BundleID != "" {
		return a.BundleID
	}
	return a.Name
}

// RefMeta 快照里一个 ref 的语义信息；ref 本身每次快照都变，账本靠 role + name 复现定位。
type RefMeta struct {
	Role string `json:"role,omitempty"`
	Name string `json:"name,omitempty"`
}

type snapEntry struct {
	app  App
	refs map[string]RefMeta
}

// Driver agent-desktop 驱动；进程级单例，由 app 层创建后注入。
type Driver struct {
	dataDir string

	mu     sync.Mutex
	snaps  map[string]*snapEntry // snapshot_id → 来源应用与各 ref 的语义
	order  []string              // 登记顺序，超限时淘汰最早的
	frames map[string]shotFrame  // windowId → 最近一次窗口图的像素尺寸
}

// New dataDir 为工作台数据目录（agent-desktop 的状态、截图落在其下）。
func New(dataDir string) *Driver {
	return &Driver{dataDir: dataDir, snaps: map[string]*snapEntry{}}
}

// Available 是否已安装 agent-desktop。
func (d *Driver) Available() bool {
	return d != nil && d.Bin() != ""
}

// Bin 定位 agent-desktop：工作台工具链目录优先，其次 PATH，再回退常见全局安装目录（GUI 进程的 PATH 往往不含它们）。
func (d *Driver) Bin() string {
	if d == nil {
		return ""
	}
	name := "agent-desktop"
	if runtime.GOOS == "windows" {
		name += ".exe"
	}
	dirs := []string{filepath.Join(d.dataDir, "toolchains", "agent-desktop")}
	if p := firstFile(name, dirs...); p != "" {
		return p
	}
	if p, err := exec.LookPath("agent-desktop"); err == nil {
		return p
	}
	if runtime.GOOS == "windows" {
		return ""
	}
	dirs = []string{"/opt/homebrew/bin", "/usr/local/bin"}
	if home, err := os.UserHomeDir(); err == nil {
		dirs = append(dirs, filepath.Join(home, ".npm-global", "bin"), filepath.Join(home, ".local", "bin"), filepath.Join(home, ".cargo", "bin"))
	}
	return firstFile(name, dirs...)
}

func firstFile(name string, dirs ...string) string {
	for _, dir := range dirs {
		p := filepath.Join(dir, name)
		if st, err := os.Stat(p); err == nil && !st.IsDir() {
			return p
		}
	}
	return ""
}

// stateDir agent-desktop 的状态根（快照与 ref 存储，含界面内容，仅本机）。
func (d *Driver) stateDir() string {
	return filepath.Join(d.dataDir, "agent-desktop")
}

// ShotDir 截图落盘目录。
func (d *Driver) ShotDir() string {
	return filepath.Join(d.dataDir, "desktop-shots")
}

// run 执行一条 agent-desktop 命令并解开 JSON 信封，返回 data。
// stdin 非空时作为文本输入（type / set-value 走 --stdin，避免文本进进程参数或被当成 flag）。
func (d *Driver) run(ctx context.Context, stdin string, args ...string) (json.RawMessage, error) {
	bin := d.Bin()
	if bin == "" {
		return nil, errno.New(errno.CodeConnFailed, "未找到 agent-desktop", InstallHint)
	}
	if _, has := ctx.Deadline(); !has {
		var cancel context.CancelFunc
		ctx, cancel = context.WithTimeout(ctx, defaultCallTimeout)
		defer cancel()
	}
	cmd := exec.CommandContext(ctx, bin, args...)
	cmd.Env = append(os.Environ(), "AGENT_DESKTOP_HOME="+d.stateDir())
	cmd.Stdin = strings.NewReader(stdin)
	var stdout, stderr bytes.Buffer
	cmd.Stdout, cmd.Stderr = &stdout, &stderr
	runErr := cmd.Run()

	var env struct {
		OK    bool            `json:"ok"`
		Data  json.RawMessage `json:"data"`
		Error *struct {
			Code        string `json:"code"`
			Message     string `json:"message"`
			Suggestion  string `json:"suggestion"`
			Disposition struct {
				Delivery string `json:"delivery"`
			} `json:"disposition"`
		} `json:"error"`
	}
	// 失败时退出码非 0，但 stdout 仍是带 error 的信封
	if stdout.Len() > 0 && json.Unmarshal(stdout.Bytes(), &env) == nil {
		if env.OK {
			return env.Data, nil
		}
		if e := env.Error; e != nil {
			return nil, &Error{
				Code: e.Code, Message: e.Message, Suggestion: e.Suggestion,
				Delivered: strings.HasPrefix(e.Disposition.Delivery, "delivered"),
			}
		}
	}
	if ctx.Err() != nil {
		return nil, errno.Wrap(errno.CodeConnFailed, "agent-desktop 调用超时", ctx.Err())
	}
	detail := strings.TrimSpace(stderr.String())
	if detail == "" && runErr != nil {
		detail = runErr.Error()
	}
	return nil, errno.New(errno.CodeConnFailed, "agent-desktop 调用失败", truncate(detail, 400))
}

// Status 安装与系统权限状态（不触碰任何应用内容）。
func (d *Driver) Status(ctx context.Context) map[string]interface{} {
	out := map[string]interface{}{"provider": ProviderName, "available": d.Available()}
	if !d.Available() {
		out["install"] = InstallHint
		return out
	}
	out["bin"] = d.Bin()
	data, err := d.run(ctx, "", "status")
	if err != nil {
		out["error"] = err.Error()
		return out
	}
	var st struct {
		Version     string                 `json:"version"`
		Platform    string                 `json:"platform"`
		Permissions map[string]interface{} `json:"permissions"`
		Surfaces    []string               `json:"supported_surfaces"`
	}
	_ = json.Unmarshal(data, &st)
	out["version"] = st.Version
	out["platform"] = st.Platform
	out["permissions"] = st.Permissions
	out["surfaces"] = st.Surfaces
	return out
}

// Apps 正在运行的图形应用；filter 非空时交给 agent-desktop 按名称 / bundle id 过滤。
func (d *Driver) Apps(ctx context.Context, filter string) ([]App, error) {
	args := []string{"list-apps"}
	if filter != "" {
		args = append(args, "--app="+filter)
	}
	data, err := d.run(ctx, "", args...)
	if err != nil {
		return nil, err
	}
	var res struct {
		Apps []struct {
			Name         string `json:"name"`
			BundleID     string `json:"bundle_id"`
			PID          int    `json:"pid"`
			Presentation string `json:"presentation"`
		} `json:"apps"`
	}
	if err := json.Unmarshal(data, &res); err != nil {
		return nil, err
	}
	out := make([]App, 0, len(res.Apps))
	for _, a := range res.Apps {
		out = append(out, App{Name: a.Name, BundleID: a.BundleID, PID: a.PID, Foreground: a.Presentation == "foreground"})
	}
	return out, nil
}

// Resolve 把调用方给的应用名 / bundle id 归一成唯一的运行中应用。
// 之后的命令一律用归一后的标识定位，保证「授权的应用」与「实际操作的应用」是同一个。
func (d *Driver) Resolve(ctx context.Context, name string) (App, error) {
	name = strings.TrimSpace(name)
	if name == "" || strings.HasPrefix(name, "-") {
		return App{}, &Error{Code: CodeInvalidArgs, Message: "请提供 app（应用名或 bundle id，来自 desktop_apps）"}
	}
	apps, err := d.Apps(ctx, name)
	if err != nil {
		return App{}, err
	}
	var exact []App
	for _, a := range apps {
		if strings.EqualFold(a.BundleID, name) || strings.EqualFold(a.Name, name) {
			exact = append(exact, a)
		}
	}
	if len(exact) > 0 {
		apps = exact
	}
	switch len(apps) {
	case 0:
		return App{}, &Error{Code: CodeAppNotFound, Message: "没有名为「" + name + "」的运行中应用"}
	case 1:
		return apps[0], nil
	}
	if sameApp(apps) {
		return apps[0], nil // 同一应用的多个进程实例，授权与定位都按 bundle id
	}
	names := make([]string, 0, len(apps))
	for _, a := range apps {
		names = append(names, a.Name+"("+a.Key()+")")
	}
	return App{}, &Error{Code: CodeAmbiguous, Message: "「" + name + "」匹配到多个应用：" + strings.Join(names, "、") + "；请改用 bundle id"}
}

func sameApp(apps []App) bool {
	for _, a := range apps[1:] {
		if a.BundleID == "" || a.BundleID != apps[0].BundleID {
			return false
		}
	}
	return apps[0].BundleID != ""
}

// byPID 按进程号找应用（launch 之后取回 bundle id）。
func (d *Driver) byPID(ctx context.Context, pid int) (App, bool) {
	apps, err := d.Apps(ctx, "")
	if err != nil {
		return App{}, false
	}
	for _, a := range apps {
		if a.PID == pid {
			return a, true
		}
	}
	return App{}, false
}

var refRe = regexp.MustCompile(`^@([a-z0-9]+):e\d+$`)

// snapshotOf 取出 ref 所属的快照 id；格式不对返回空。
func snapshotOf(ref string) string {
	m := refRe.FindStringSubmatch(ref)
	if m == nil {
		return ""
	}
	return m[1]
}

// remember 登记一次快照 / 查找产生的 ref；同一快照 id 的下钻结果并入已有登记。
func (d *Driver) remember(snapshotID string, app App, refs map[string]RefMeta) {
	if snapshotID == "" {
		return
	}
	d.mu.Lock()
	defer d.mu.Unlock()
	entry, ok := d.snaps[snapshotID]
	if !ok {
		entry = &snapEntry{app: app, refs: map[string]RefMeta{}}
		d.snaps[snapshotID] = entry
		d.order = append(d.order, snapshotID)
		if len(d.order) > maxSnapshots {
			delete(d.snaps, d.order[0])
			d.order = d.order[1:]
		}
	}
	for ref, meta := range refs {
		entry.refs[ref] = meta
	}
}

// RefInfo ref 属于哪个应用、指向什么元素。
// 只认本进程登记过的 ref：未登记说明它不是经工作台（即经授权检查）拿到的。
func (d *Driver) RefInfo(ref string) (App, RefMeta, error) {
	ref = strings.TrimSpace(ref)
	sid := snapshotOf(ref)
	if sid == "" {
		return App{}, RefMeta{}, &Error{Code: CodeInvalidArgs, Message: "ref 须是快照里的完整形式 @<快照id>:eN"}
	}
	d.mu.Lock()
	defer d.mu.Unlock()
	entry, ok := d.snaps[sid]
	if !ok {
		return App{}, RefMeta{}, &Error{Code: "SNAPSHOT_NOT_FOUND", Message: "ref " + ref + " 不在当前登记的快照里"}
	}
	return entry.app, entry.refs[ref], nil
}

func truncate(s string, max int) string {
	r := []rune(s)
	if len(r) <= max {
		return s
	}
	return string(r[:max]) + "…"
}
