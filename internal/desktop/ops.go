package desktop

import (
	"context"
	"encoding/json"
	"fmt"
	"os"
	"path/filepath"
	"regexp"
	"strconv"
	"strings"
	"time"
)

const (
	defaultTreeChars = 12000
	maxTreeChars     = 60000
	maxTypeBytes     = 10000 // agent-desktop type --stdin 的上限
	maxWaitMs        = 60000
)

var (
	tokenRe = regexp.MustCompile(`^[A-Za-z0-9_-]{1,64}$`) // window id / surface 等标识
	comboRe = regexp.MustCompile(`^[^\s-][^\s]{0,39}$`)   // 按键组合：return、cmd+c、shift+tab …
	// 界面文本里常见的不可见方向标记，去掉后名称才能被直接引用
	invisible = strings.NewReplacer("\u200e", "", "\u200f", "")
)

// node 无障碍树节点（agent-desktop snapshot 的 tree）。
type node struct {
	Role          string      `json:"role"`
	Name          string      `json:"name"`
	Value         interface{} `json:"value"`
	Ref           string      `json:"ref_id"`
	States        []string    `json:"states"`
	Actions       []string    `json:"available_actions"`
	Children      []node      `json:"children"`
	ChildrenCount int         `json:"children_count"`
}

type rawSnapshot struct {
	App        string      `json:"app"`
	Complete   bool        `json:"complete"`
	RefCount   int         `json:"ref_count"`
	SnapshotID string      `json:"snapshot_id"`
	Tree       *node       `json:"tree"`
	Window     interface{} `json:"window"`
}

// SnapshotOpts 快照参数。
type SnapshotOpts struct {
	All      bool   // 含静态文本等非交互元素；默认只取可交互元素
	Skeleton bool   // 浅层概览：被截断的容器只给 children 数，再用 Root 下钻
	Root     string // 从该 ref 的子树开始
	WindowID string
	Surface  string // window（默认）/ menu / menubar / sheet / popover / alert …
	MaxDepth int
	MaxChars int
}

// Snapshot 一次界面快照（树已渲染成紧凑文本）。
type Snapshot struct {
	SnapshotID string      `json:"snapshotId"`
	App        string      `json:"app"`
	Window     interface{} `json:"window,omitempty"`
	RefCount   int         `json:"refCount"`
	Complete   bool        `json:"complete"`
	Tree       string      `json:"tree"`
	Truncated  bool        `json:"truncated,omitempty"`
}

// Snapshot 读取应用界面的无障碍树。
func (d *Driver) Snapshot(ctx context.Context, app App, o SnapshotOpts) (Snapshot, error) {
	args := []string{"snapshot", "--app=" + app.Key(), "--compact"}
	if !o.All {
		args = append(args, "-i")
	}
	if o.Skeleton {
		args = append(args, "--skeleton")
	}
	if o.MaxDepth > 0 {
		args = append(args, "--max-depth="+strconv.Itoa(clamp(o.MaxDepth, 1, 30)))
	}
	scope, err := scopeArgs(o.Root, o.WindowID, o.Surface)
	if err != nil {
		return Snapshot{}, err
	}
	data, err := d.run(ctx, "", append(args, scope...)...)
	if err != nil {
		return Snapshot{}, err
	}
	var raw rawSnapshot
	if err := json.Unmarshal(data, &raw); err != nil {
		return Snapshot{}, err
	}
	return d.adopt(raw, app, o.MaxChars), nil
}

// scopeArgs 快照 / 查找共用的范围参数。
func scopeArgs(root, windowID, surface string) ([]string, error) {
	var args []string
	if root != "" {
		if snapshotOf(root) == "" {
			return nil, &Error{Code: CodeInvalidArgs, Message: "root 须是快照里的完整 ref（@<快照id>:eN）"}
		}
		args = append(args, "--root="+root)
	}
	if windowID != "" {
		if !tokenRe.MatchString(windowID) {
			return nil, &Error{Code: CodeInvalidArgs, Message: "windowId 须来自 desktop_apps(app=…) 的窗口列表"}
		}
		args = append(args, "--window-id="+windowID)
	}
	if surface != "" {
		if !tokenRe.MatchString(surface) {
			return nil, &Error{Code: CodeInvalidArgs, Message: "surface 无效（window / menu / menubar / sheet / popover / alert …）"}
		}
		args = append(args, "--surface="+surface)
	}
	return args, nil
}

// adopt 登记快照里的 ref 并把树渲染成文本。
func (d *Driver) adopt(raw rawSnapshot, app App, maxChars int) Snapshot {
	if maxChars <= 0 {
		maxChars = defaultTreeChars
	}
	maxChars = clamp(maxChars, 500, maxTreeChars)
	snap := Snapshot{
		SnapshotID: raw.SnapshotID, App: raw.App, Window: raw.Window,
		RefCount: raw.RefCount, Complete: raw.Complete,
	}
	if raw.Tree == nil {
		return snap
	}
	refs := map[string]RefMeta{}
	var b strings.Builder
	renderNode(&b, *raw.Tree, 0, maxChars, refs, &snap.Truncated)
	snap.Tree = strings.TrimRight(b.String(), "\n")
	d.remember(raw.SnapshotID, app, refs)
	return snap
}

// renderNode 输出一行「- role "name" value=… [ref=…] (states) actions=… +N」；超出字数后只登记 ref、不再输出。
func renderNode(b *strings.Builder, n node, depth, maxChars int, refs map[string]RefMeta, truncated *bool) {
	name := clean(n.Name)
	if n.Ref != "" {
		refs[n.Ref] = RefMeta{Role: n.Role, Name: name}
	}
	if b.Len() < maxChars {
		role := n.Role
		if role == "" {
			role = "node"
		}
		line := strings.Repeat("  ", depth) + "- " + role
		if name != "" {
			line += " " + strconv.Quote(truncate(name, 80))
		}
		if v := clean(valueText(n.Value)); v != "" && v != name {
			line += " value=" + strconv.Quote(truncate(v, 120))
		}
		if n.Ref != "" {
			line += " [ref=" + n.Ref + "]"
		}
		if len(n.States) > 0 {
			line += " (" + strings.Join(n.States, ",") + ")"
		}
		if acts := notableActions(n.Actions); acts != "" {
			line += " actions=" + acts
		}
		if n.ChildrenCount > 0 && len(n.Children) == 0 {
			line += " +" + strconv.Itoa(n.ChildrenCount)
		}
		b.WriteString(line + "\n")
	} else {
		*truncated = true
	}
	for _, c := range n.Children {
		renderNode(b, c, depth+1, maxChars, refs, truncated)
	}
}

// notableActions 只标出「点击 / 聚焦」之外的动作（滚动、右键、设值…），其余是默认可点，不占字数。
func notableActions(actions []string) string {
	var out []string
	for _, a := range actions {
		if a != "Click" && a != "SetFocus" {
			out = append(out, a)
		}
	}
	return strings.Join(out, ",")
}

func valueText(v interface{}) string {
	switch t := v.(type) {
	case nil:
		return ""
	case string:
		return t
	default:
		return fmt.Sprint(t)
	}
}

func clean(s string) string {
	return strings.TrimSpace(invisible.Replace(s))
}

// FindOpts 查找条件（至少给一项）。
type FindOpts struct {
	Role     string
	Name     string
	Text     string // 在名称 / 值 / 标题 / 描述里匹配
	Value    string
	Exact    bool
	Limit    int
	Root     string
	WindowID string
	Surface  string
}

// Match 查找命中的元素；静态文本等非交互元素没有 ref。
type Match struct {
	Ref    string   `json:"ref,omitempty"`
	Role   string   `json:"role"`
	Name   string   `json:"name,omitempty"`
	Value  string   `json:"value,omitempty"`
	States []string `json:"states,omitempty"`
	Path   []string `json:"path,omitempty"`
}

// FindResult 查找结果。
type FindResult struct {
	SnapshotID string  `json:"snapshotId"`
	Matches    []Match `json:"matches"`
	Total      int     `json:"total"`
	Truncated  bool    `json:"truncated,omitempty"`
}

// Find 按角色 / 名称 / 文本查找元素。
func (d *Driver) Find(ctx context.Context, app App, o FindOpts) (FindResult, error) {
	args := []string{"find", "--app=" + app.Key()}
	for _, kv := range [][2]string{{"--role", o.Role}, {"--name", o.Name}, {"--text", o.Text}, {"--value", o.Value}} {
		if kv[1] != "" {
			args = append(args, kv[0]+"="+kv[1])
		}
	}
	if len(args) == 2 {
		return FindResult{}, &Error{Code: CodeInvalidArgs, Message: "请至少提供 role / name / text / value 之一"}
	}
	if o.Exact {
		args = append(args, "--exact")
	}
	limit := o.Limit
	if limit <= 0 {
		limit = 20
	}
	args = append(args, "--limit="+strconv.Itoa(clamp(limit, 1, 100)))
	scope, err := scopeArgs(o.Root, o.WindowID, o.Surface)
	if err != nil {
		return FindResult{}, err
	}
	data, err := d.run(ctx, "", append(args, scope...)...)
	if err != nil {
		return FindResult{}, err
	}
	var raw struct {
		SnapshotID string `json:"snapshot_id"`
		Total      int    `json:"total_matches"`
		Truncated  bool   `json:"truncated"`
		Matches    []struct {
			Ref    *string     `json:"ref_id"`
			Role   string      `json:"role"`
			Name   string      `json:"name"`
			Value  interface{} `json:"value"`
			States []string    `json:"states"`
			Path   []string    `json:"path"`
		} `json:"matches"`
	}
	if err := json.Unmarshal(data, &raw); err != nil {
		return FindResult{}, err
	}
	res := FindResult{SnapshotID: raw.SnapshotID, Total: raw.Total, Truncated: raw.Truncated, Matches: []Match{}}
	refs := map[string]RefMeta{}
	for _, m := range raw.Matches {
		out := Match{Role: m.Role, Name: clean(m.Name), States: m.States, Path: m.Path}
		if v := clean(valueText(m.Value)); v != out.Name {
			out.Value = truncate(v, 500)
		}
		if m.Ref != nil && *m.Ref != "" {
			out.Ref = *m.Ref
			refs[out.Ref] = RefMeta{Role: m.Role, Name: out.Name}
		}
		res.Matches = append(res.Matches, out)
	}
	d.remember(raw.SnapshotID, app, refs)
	return res, nil
}

// Read 读取一个元素的完整文本 / 值 / 状态（快照里的值会被截短）。
func (d *Driver) Read(ctx context.Context, ref string) (map[string]interface{}, error) {
	if snapshotOf(ref) == "" {
		return nil, &Error{Code: CodeInvalidArgs, Message: "ref 须是快照里的完整形式 @<快照id>:eN"}
	}
	type entry struct {
		Command string            `json:"command"`
		Args    map[string]string `json:"args"`
	}
	props := []string{"role", "text", "value", "states"}
	batch := make([]entry, 0, len(props))
	for _, p := range props {
		batch = append(batch, entry{Command: "get", Args: map[string]string{"ref_id": ref, "property": p}})
	}
	payload, _ := json.Marshal(batch) // 只含 ref 与属性名，不含界面文本
	data, err := d.run(ctx, "", "batch", string(payload))
	if err != nil {
		return nil, err
	}
	var res struct {
		Results []struct {
			OK   bool `json:"ok"`
			Data struct {
				Property string      `json:"property"`
				Value    interface{} `json:"value"`
			} `json:"data"`
			Error *struct {
				Code    string `json:"code"`
				Message string `json:"message"`
			} `json:"error"`
		} `json:"results"`
	}
	if err := json.Unmarshal(data, &res); err != nil {
		return nil, err
	}
	out := map[string]interface{}{"ref": ref}
	var firstErr error
	for _, r := range res.Results {
		if r.OK {
			if s, ok := r.Data.Value.(string); ok {
				out[r.Data.Property] = clean(s)
			} else {
				out[r.Data.Property] = r.Data.Value
			}
		} else if r.Error != nil && firstErr == nil {
			firstErr = &Error{Code: r.Error.Code, Message: r.Error.Message}
		}
	}
	if len(out) == 1 && firstErr != nil {
		return nil, firstErr
	}
	return out, nil
}

// refCommands 针对某个 ref 的动作 → agent-desktop 子命令。
// 只收语义（无障碍 API）可送达的动作；需要物理鼠标的 hover / drag / double-click 不在其列。
var refCommands = map[string]string{
	"click":       "click",
	"right_click": "right-click",
	"type":        "type",
	"set_value":   "set-value",
	"clear":       "clear",
	"select":      "select",
	"toggle":      "toggle",
	"check":       "check",
	"uncheck":     "uncheck",
	"expand":      "expand",
	"collapse":    "collapse",
	"scroll":      "scroll",
	"scroll_to":   "scroll-to",
	"focus":       "focus",
}

// ActionPress 按键动作：作用于应用而非某个 ref。
const ActionPress = "press"

// IsRefAction action 是否作用于某个 ref。
func IsRefAction(action string) bool {
	_, ok := refCommands[action]
	return ok
}

// ActOpts 一次操作。
type ActOpts struct {
	Action    string
	Ref       string // 除 press 外必填
	Text      string // type / set_value 的文本，select 的选项
	Keys      string // press 的组合键
	Direction string // scroll：up / down / left / right
	Amount    int    // scroll 的单位数
	Force     bool   // press：放行被标为危险的快捷键
	// 动作之后等待「role:text」出现 / 消失，并随结果带回新快照（省一次往返）
	WaitFor       string
	WaitGone      string
	WaitTimeoutMs int
}

// Act 执行一次操作；app 为目标应用（ref 动作取 ref 所属应用）。
// 返回 delivery（是否送达 / 是否已验证）；带等待时附 matched 与新快照。
func (d *Driver) Act(ctx context.Context, app App, o ActOpts) (map[string]interface{}, error) {
	var args []string
	stdin := ""
	timeout := defaultCallTimeout
	if o.Action == ActionPress {
		if !comboRe.MatchString(o.Keys) {
			return nil, &Error{Code: CodeInvalidArgs, Message: "请提供 keys（如 return、escape、cmd+c、shift+tab）"}
		}
		args = []string{"press", "--app=" + app.Key()}
		if o.Force {
			args = append(args, "--force")
		}
	} else {
		cmd, ok := refCommands[o.Action]
		if !ok {
			return nil, &Error{Code: CodeInvalidArgs, Message: "不支持的 action: " + o.Action}
		}
		if snapshotOf(o.Ref) == "" {
			return nil, &Error{Code: CodeInvalidArgs, Message: "ref 须是快照里的完整形式 @<快照id>:eN"}
		}
		args = []string{cmd, o.Ref}
		switch o.Action {
		case "type":
			if o.Text == "" {
				return nil, &Error{Code: CodeInvalidArgs, Message: "type 需要 text"}
			}
			if len(o.Text) > maxTypeBytes {
				return nil, &Error{Code: CodeInvalidArgs, Message: "type 单次最多 10000 字节；长文本请用 set_value 整体设值"}
			}
			args, stdin = append(args, "--stdin"), o.Text
			timeout += time.Duration(len(o.Text)) * 35 * time.Millisecond // 上游按每字符 30ms 放宽等待
		case "set_value":
			if o.Text == "" {
				return nil, &Error{Code: CodeInvalidArgs, Message: "set_value 需要 text；清空请用 action=clear"}
			}
			args, stdin = append(args, "--stdin"), o.Text
		case "select":
			if o.Text == "" {
				return nil, &Error{Code: CodeInvalidArgs, Message: "select 需要 text（选项名）"}
			}
		case "scroll":
			dir := o.Direction
			if dir == "" {
				dir = "down"
			}
			if dir != "up" && dir != "down" && dir != "left" && dir != "right" {
				return nil, &Error{Code: CodeInvalidArgs, Message: "direction 须为 up / down / left / right"}
			}
			amount := o.Amount
			if amount <= 0 {
				amount = 3
			}
			args = append(args, "--direction="+dir, "--amount="+strconv.Itoa(clamp(amount, 1, 50)))
		}
	}
	waiting := o.WaitFor != "" || o.WaitGone != ""
	if waiting {
		ms := o.WaitTimeoutMs
		if ms <= 0 {
			ms = 3000
		}
		ms = clamp(ms, 200, 15000)
		if o.WaitFor != "" {
			args = append(args, "--wait-for="+o.WaitFor)
		}
		if o.WaitGone != "" {
			args = append(args, "--wait-for-gone="+o.WaitGone)
		}
		args = append(args, "--wait-timeout="+strconv.Itoa(ms))
		timeout += time.Duration(ms) * time.Millisecond
	}
	// 位置参数里可能以「-」开头的值放在 -- 之后，避免被当成 flag
	switch o.Action {
	case ActionPress:
		args = append(args, "--", o.Keys)
	case "select":
		args = append(args, "--", o.Text)
	}

	ctx, cancel := context.WithTimeout(ctx, timeout)
	defer cancel()
	out := map[string]interface{}{"action": o.Action}
	data, err := d.run(ctx, stdin, args...)
	if err != nil {
		if e, ok := err.(*Error); ok && waiting && e.Code == CodeTimeout && e.Delivered {
			out["delivery"] = "delivered"
			out["matched"] = false
			out["note"] = "动作已送达，但等待的条件未出现；不要重复执行同一动作，先 desktop_snapshot 核对界面"
			return out, nil
		}
		return nil, err
	}
	var res struct {
		rawSnapshot
		actionResult
		After   *actionResult `json:"after_action"`
		Matched string        `json:"matched_selector"`
	}
	if err := json.Unmarshal(data, &res); err != nil {
		return nil, err
	}
	act := res.actionResult
	if res.After != nil {
		act = *res.After
	}
	out["delivery"] = act.Disposition.Delivery
	if len(act.PostState) > 0 {
		out["postState"] = act.PostState
	}
	if waiting {
		out["matched"] = true
		if res.Matched != "" {
			out["matchedSelector"] = res.Matched
		}
		if res.Tree != nil {
			out["snapshot"] = d.adopt(res.rawSnapshot, app, 0)
		}
	}
	return out, nil
}

// actionResult 动作回执：delivery 为 delivered_verified / delivered_unverified。
type actionResult struct {
	Disposition struct {
		Delivery string `json:"delivery"`
	} `json:"disposition"`
	PostState map[string]interface{} `json:"post_state"`
}

// WaitOpts 等待条件（四选一）：文本出现、元素满足谓词、窗口出现、纯延时。
type WaitOpts struct {
	Text      string
	Ref       string
	Predicate string // exists（默认）/ enabled / visible / actionable / value
	Value     string // predicate=value 时的期望值
	Window    string // 窗口标题
	Ms        int    // 纯延时
	TimeoutMs int
}

// Wait 等待界面条件；等不到返回 matched=false 而非错误。app 在纯延时时可为零值。
func (d *Driver) Wait(ctx context.Context, app App, o WaitOpts) (map[string]interface{}, error) {
	timeoutMs := o.TimeoutMs
	if timeoutMs <= 0 {
		timeoutMs = 5000
	}
	timeoutMs = clamp(timeoutMs, 100, maxWaitMs)
	args := []string{"wait"}
	budget := timeoutMs
	conditional := true
	switch {
	case o.Text != "":
		args = append(args, "--app="+app.Key(), "--text="+o.Text)
	case o.Ref != "":
		if snapshotOf(o.Ref) == "" {
			return nil, &Error{Code: CodeInvalidArgs, Message: "ref 须是快照里的完整形式 @<快照id>:eN"}
		}
		pred := o.Predicate
		if pred == "" {
			pred = "exists"
		}
		if !tokenRe.MatchString(pred) {
			return nil, &Error{Code: CodeInvalidArgs, Message: "predicate 须为 exists / enabled / visible / actionable / value"}
		}
		args = append(args, "--app="+app.Key(), "--element="+o.Ref, "--predicate="+pred)
		if pred == "value" {
			args = append(args, "--value="+o.Value)
		}
	case o.Window != "":
		args = append(args, "--app="+app.Key(), "--window="+o.Window)
	case o.Ms > 0:
		conditional = false
		budget = clamp(o.Ms, 1, 10000)
		args = append(args, strconv.Itoa(budget))
	default:
		return nil, &Error{Code: CodeInvalidArgs, Message: "请提供 text / ref / window / ms 之一"}
	}
	if conditional {
		args = append(args, "--timeout="+strconv.Itoa(timeoutMs))
	}
	ctx, cancel := context.WithTimeout(ctx, defaultCallTimeout+time.Duration(budget)*time.Millisecond)
	defer cancel()
	data, err := d.run(ctx, "", args...)
	if err != nil {
		if IsCode(err, CodeTimeout) {
			return map[string]interface{}{"matched": false, "timedOut": true, "timeoutMs": timeoutMs}, nil
		}
		return nil, err
	}
	var res struct {
		ElapsedMs int                    `json:"elapsed_ms"`
		WaitedMs  int                    `json:"waited_ms"`
		Text      string                 `json:"text"`
		Role      string                 `json:"role"`
		Observed  map[string]interface{} `json:"observed"`
	}
	_ = json.Unmarshal(data, &res)
	out := map[string]interface{}{"matched": true, "elapsedMs": res.ElapsedMs + res.WaitedMs}
	if res.Text != "" {
		out["text"] = clean(res.Text)
		out["role"] = res.Role
	}
	if len(res.Observed) > 0 {
		out["observed"] = res.Observed
	}
	return out, nil
}

// Window 应用的一个窗口。
type Window struct {
	ID        string `json:"id"`
	Title     string `json:"title"`
	Focused   bool   `json:"focused,omitempty"`
	Minimized bool   `json:"minimized,omitempty"`
	Visible   bool   `json:"visible"`
}

// Windows 应用的窗口列表（标题可能含文档名，属于界面内容）。
func (d *Driver) Windows(ctx context.Context, app App) ([]Window, error) {
	data, err := d.run(ctx, "", "list-windows", "--app="+app.Key())
	if err != nil {
		return nil, err
	}
	var raw []struct {
		ID        string `json:"id"`
		Title     string `json:"title"`
		Focused   bool   `json:"is_focused"`
		Minimized bool   `json:"minimized"`
		Visible   bool   `json:"visible"`
	}
	if err := json.Unmarshal(data, &raw); err != nil {
		return nil, err
	}
	out := make([]Window, 0, len(raw))
	for _, w := range raw {
		out = append(out, Window{ID: w.ID, Title: clean(w.Title), Focused: w.Focused, Minimized: w.Minimized, Visible: w.Visible})
	}
	return out, nil
}

// Screenshot 截取应用窗口为 PNG，落在工作台数据目录下（仅本人可读）。
func (d *Driver) Screenshot(ctx context.Context, app App, windowID string) (map[string]interface{}, error) {
	scope, err := scopeArgs("", windowID, "")
	if err != nil {
		return nil, err
	}
	dir := d.ShotDir()
	if err := os.MkdirAll(dir, 0o700); err != nil {
		return nil, err
	}
	path := filepath.Join(dir, "shot-"+time.Now().Format("20060102-150405.000")+".png")
	args := append([]string{"screenshot", path, "--app=" + app.Key()}, scope...)
	data, err := d.run(ctx, "", args...)
	if err != nil {
		return nil, err
	}
	var res struct {
		Path   string `json:"path"`
		Width  int    `json:"width"`
		Height int    `json:"height"`
	}
	_ = json.Unmarshal(data, &res)
	if res.Path == "" {
		res.Path = path
	}
	return map[string]interface{}{"path": res.Path, "width": res.Width, "height": res.Height, "format": "png"}, nil
}

// Launch 启动应用（已在运行则附着）并等它呈现窗口；会把该应用带到前台。
func (d *Driver) Launch(ctx context.Context, name string) (App, *Window, error) {
	name = strings.TrimSpace(name)
	if name == "" || strings.HasPrefix(name, "-") {
		return App{}, nil, &Error{Code: CodeInvalidArgs, Message: "请提供 app（应用名或 bundle id）"}
	}
	ctx, cancel := context.WithTimeout(ctx, 40*time.Second)
	defer cancel()
	data, err := d.run(ctx, "", "launch", "--activate", "--", name)
	if err != nil {
		return App{}, nil, err
	}
	var res struct {
		App    string `json:"app"`
		PID    int    `json:"pid"`
		Window *struct {
			ID    string `json:"id"`
			Title string `json:"title"`
		} `json:"window"`
	}
	if err := json.Unmarshal(data, &res); err != nil {
		return App{}, nil, err
	}
	app, ok := d.byPID(ctx, res.PID)
	if !ok {
		app = App{Name: res.App, PID: res.PID}
	}
	if res.Window == nil {
		return app, nil, nil
	}
	return app, &Window{ID: res.Window.ID, Title: clean(res.Window.Title), Visible: true}, nil
}

func clamp(v, lo, hi int) int {
	if v < lo {
		return lo
	}
	if v > hi {
		return hi
	}
	return v
}
