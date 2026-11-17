package workbenchtools

import (
	"context"
	"encoding/json"
	"fmt"
	"strings"
	"unicode/utf8"

	"WWorkbench/internal/desktop"
	"WWorkbench/internal/model"
	"WWorkbench/internal/workbench"

	"github.com/google/uuid"
)

// isDesktopTool 是否桌面应用域的工具。
func isDesktopTool(name string) bool {
	return strings.HasPrefix(name, "desktop_")
}

func registerDesktopTools(r *Registry) {
	str := func(desc string) map[string]interface{} {
		return map[string]interface{}{"type": "string", "description": desc}
	}
	boolean := func(desc string) map[string]interface{} {
		return map[string]interface{}{"type": "boolean", "description": desc}
	}
	integer := func(desc string) map[string]interface{} {
		return map[string]interface{}{"type": "integer", "description": desc}
	}
	object := func(required []string, props map[string]interface{}) map[string]interface{} {
		out := map[string]interface{}{"type": "object", "properties": props}
		if len(required) > 0 {
			out["required"] = required
		}
		return out
	}
	appProp := str("应用名或 bundle id（来自 desktop_apps；bundle id 最稳）")
	windowProp := str("窗口 id（来自 desktop_apps(app=…)），多窗口时指定")
	surfaceProp := str("界面层：window（默认）| menubar | menu | sheet | popover | alert")

	r.add(ToolDef{
		Name: workbench.CapDesktopStatus,
		Description: "桌面应用能力状态：agent-desktop 是否就绪、系统辅助功能 / 屏幕录制权限、已授权的应用。操作桌面应用前先调。" +
			"默认 AI 一个应用都读不了：首次读取或操作某个应用时，工作台会弹窗请用户授权。",
		Parameters: object(nil, map[string]interface{}{}),
		Handler:    toolDesktopStatus,
	})
	r.add(ToolDef{
		Name: workbench.CapDesktopApps,
		Description: "列出正在运行的应用及其对 AI 的授权（access=none|read|act）。" +
			"带 app 时返回该应用的窗口列表（需读取授权）。",
		Parameters: object(nil, map[string]interface{}{
			"app": appProp,
			"all": boolean("含后台代理与辅助进程，默认只列有界面的应用"),
		}),
		Handler: toolDesktopApps,
	})
	r.add(ToolDef{
		Name: workbench.CapDesktopSnapshot,
		Description: "读取应用界面的无障碍树：tree 每行「role \"name\" [ref=@快照id:eN] (状态) actions=…」，ref 原样传给 desktop_act；行尾 +N 表示还有 N 个子节点未展开。" +
			"默认只含可交互元素，读正文 / 结果用 all=true；大界面先 skeleton=true 看概览，再把容器的 ref 传给 root 下钻；菜单用 surface=menubar / menu。" +
			"ref 只对当前界面有效，界面变了要重新取；禁止编造 ref。",
		Parameters: object(nil, map[string]interface{}{
			"app":      appProp,
			"all":      boolean("含静态文本等非交互元素，默认 false"),
			"skeleton": boolean("浅层概览：容器只给子节点数（+N）"),
			"root":     str("只取该 ref 的子树（可不传 app）"),
			"windowId": windowProp,
			"surface":  surfaceProp,
			"maxDepth": integer("树深度上限，默认 10"),
			"maxChars": integer("tree 文本上限，默认 12000"),
		}),
		Handler: toolDesktopSnapshot,
	})
	r.add(ToolDef{
		Name: workbench.CapDesktopFind,
		Description: "按 role / name / text / value 查找元素并返回 ref（比整树快照省）。" +
			"只传 ref 时改为读取该元素的完整文本、值与状态（快照里的长值会被截短）。",
		Parameters: object(nil, map[string]interface{}{
			"app":      appProp,
			"ref":      str("读取这个元素的完整文本 / 值 / 状态"),
			"role":     str("角色：button / textfield / checkbox / menuitem / statictext …"),
			"name":     str("名称或标签（包含匹配）"),
			"text":     str("在名称 / 值 / 标题 / 描述里匹配"),
			"value":    str("当前值"),
			"exact":    boolean("name / value 精确匹配（不分大小写）"),
			"limit":    integer("最多返回几条，默认 20"),
			"root":     str("只在该 ref 的子树里找"),
			"windowId": windowProp,
			"surface":  surfaceProp,
		}),
		Handler: toolDesktopFind,
	})
	r.add(ToolDef{
		Name: workbench.CapDesktopWait,
		Description: "等待界面条件（四选一）：text 出现；ref 满足 predicate；window 标题出现；或 ms 纯延时。" +
			"等不到返回 matched=false。动作后的等待优先用 desktop_act 的 waitFor，省一次往返。",
		Parameters: object(nil, map[string]interface{}{
			"app":       appProp,
			"text":      str("等这段文本出现在应用界面里（需 app）"),
			"ref":       str("等这个元素满足 predicate"),
			"predicate": str("exists（默认）| enabled | visible | actionable | value"),
			"value":     str("predicate=value 时的期望值"),
			"window":    str("等标题含该文本的窗口出现（需 app）"),
			"ms":        integer("纯延时毫秒数，最多 10000"),
			"timeoutMs": integer("条件等待上限，默认 5000，最多 60000"),
		}),
		Handler: toolDesktopWait,
	})
	r.add(ToolDef{
		Name: workbench.CapDesktopScreenshot,
		Description: "截取应用窗口为 PNG，返回本机 path；侧栏会自动压缩附图进多模态供视觉定位。" +
			"无障碍树读不到的自绘界面才需要；能用 desktop_snapshot 就不要截图。",
		Parameters: object([]string{"app"}, map[string]interface{}{"app": appProp, "windowId": windowProp}),
		Handler:    toolDesktopScreenshot,
	})
	r.add(ToolDef{
		Name: workbench.CapDesktopAct,
		Description: "操作桌面应用（agent-desktop 全量）。" +
			"语义（不抢焦点）：click | right_click | type | set_value | clear | select | toggle | check | uncheck | expand | collapse | scroll | scroll_to | focus（须 ref）；press（须 app+keys）。" +
			"物理 headed（抢焦点/移鼠标，自绘 App 如微信用这个）：headed=true 可加在 press/click 上；或 action=mouse_click|mouse_move|mouse_wheel（须 x,y）| hover（ref 或 x,y）| drag（ref/toRef 或 x,y→x2,y2）| double_click|triple_click（须 ref）| focus_window。" +
			"剪贴板：clipboard_set（text / imagePath / fileUrl）| clipboard_get。" +
			"type=光标插入，set_value=整体替换。waitFor=\"role:text\" 可带回新快照。须「操作」授权；每步入账本。",
		Parameters: object([]string{"action"}, map[string]interface{}{
			"action":        str("见描述"),
			"ref":           str("目标元素 ref；drag 时为起点"),
			"toRef":         str("drag 终点 ref"),
			"app":           appProp,
			"text":          str("type / set_value / clipboard_set 文本；select 选项名"),
			"keys":          str("press：return、escape、tab、cmd+c、cmd+v、cmd+f …"),
			"direction":     str("scroll：up|down|left|right，默认 down"),
			"amount":        integer("scroll 单位数默认 3；mouse_click 的连点次数"),
			"force":         boolean("危险快捷键须 true，且每次单独确认"),
			"headed":        boolean("物理送达：抢焦点、允许移光标；mouse_* / hover / drag / double_click 自动开启"),
			"x":             map[string]interface{}{"type": "number", "description": "屏幕绝对 X（逻辑点）"},
			"y":             map[string]interface{}{"type": "number", "description": "屏幕绝对 Y"},
			"x2":            map[string]interface{}{"type": "number", "description": "drag 终点 X"},
			"y2":            map[string]interface{}{"type": "number", "description": "drag 终点 Y"},
			"button":        str("mouse_click：left|right|middle，默认 left"),
			"dx":            integer("mouse_wheel 水平增量"),
			"dy":            integer("mouse_wheel 垂直增量（负=向下）"),
			"modifiers":     map[string]interface{}{"type": "array", "items": map[string]interface{}{"type": "string"}, "description": "shift|meta|ctrl|alt"},
			"imagePath":     str("clipboard_set：本机 PNG 路径"),
			"fileUrl":       str("clipboard_set：文件引用路径"),
			"format":        str("clipboard_get：text|auto|image|file-urls"),
			"windowId":      windowProp,
			"windowTitle":   str("focus_window 按标题（可部分匹配）"),
			"waitFor":       str("动作后等 role:text"),
			"waitGone":      str("动作后等 role:text 消失"),
			"waitTimeoutMs": integer("等待上限，默认 3000，最多 15000"),
			"session":       str("任务名，默认当前任务"),
			"intent":        intentProp(),
		}),
		Handler: toolDesktopAct,
	})
	r.add(ToolDef{
		Name:        workbench.CapDesktopLaunch,
		Description: "启动应用并等它呈现窗口（已在运行则带到前台）。需要该应用的「操作」授权；应用会出现在用户面前。",
		Parameters: object([]string{"app"}, map[string]interface{}{
			"app":     str("应用名或 bundle id，如 TextEdit / com.apple.TextEdit"),
			"session": str("任务名，默认当前任务"),
			"intent":  intentProp(),
		}),
		Handler: toolDesktopLaunch,
	})
}

func requireDesktop(d *Deps) (*desktop.Driver, error) {
	if d == nil || d.Desktop == nil || !d.Desktop.Available() {
		return nil, errStr("桌面执行器未就绪（未安装 agent-desktop）：" + desktop.InstallHint)
	}
	return d.Desktop, nil
}

// desktopTarget 归一出本次调用的目标应用：app 参数优先；只给 ref 时取 ref 所属应用；都给时必须是同一个。
// 授权检查针对这里返回的应用，后续命令也只用它定位。
func desktopTarget(ctx context.Context, drv *desktop.Driver, appName string, refs ...string) (desktop.App, error) {
	var app desktop.App
	has := false
	if strings.TrimSpace(appName) != "" {
		resolved, err := drv.Resolve(ctx, appName)
		if err != nil {
			return app, err
		}
		app, has = resolved, true
	}
	for _, ref := range refs {
		if ref == "" {
			continue
		}
		owner, _, err := drv.RefInfo(ref)
		if err != nil {
			return app, err
		}
		if has && !strings.EqualFold(owner.Key(), app.Key()) {
			return app, errStr("ref " + ref + " 属于「" + owner.Name + "」，与 app「" + app.Name + "」不是同一个应用")
		}
		if !has {
			app, has = owner, true
		}
	}
	if !has {
		return app, errStr("请提供 app（应用名或 bundle id）或 ref")
	}
	return app, nil
}

func toolDesktopStatus(ctx context.Context, d *Deps, _ json.RawMessage) ToolResult {
	out := map[string]interface{}{"provider": desktop.ProviderName, "available": false, "install": desktop.InstallHint}
	if d != nil && d.Desktop != nil {
		out = d.Desktop.Status(ctx)
	}
	grants := []DesktopGrant{}
	if d != nil && d.DesktopGrants != nil {
		grants = append(grants, d.DesktopGrants.List()...)
	}
	out["grants"] = grants
	out["note"] = "未授权的应用读不了：首次 desktop_snapshot / desktop_act 时工作台弹窗请用户授权（读取 / 操作两级），用户可在「AI 权限」里撤销。"
	return OKData(out)
}

func toolDesktopApps(ctx context.Context, d *Deps, raw json.RawMessage) ToolResult {
	drv, err := requireDesktop(d)
	if err != nil {
		return Fail(err.Error())
	}
	var in struct {
		App string `json:"app"`
		All bool   `json:"all"`
	}
	_ = json.Unmarshal(raw, &in)
	if strings.TrimSpace(in.App) != "" {
		app, err := drv.Resolve(ctx, in.App)
		if err != nil {
			return Fail(err.Error())
		}
		if err := ensureDesktopAccess(ctx, d, app, DesktopLevelRead, workbench.CapDesktopApps, ""); err != nil {
			return Fail(err.Error())
		}
		windows, err := drv.Windows(ctx, app)
		if err != nil {
			return Fail(err.Error())
		}
		return OKData(map[string]interface{}{"app": app, "access": desktopAccess(d, app), "windows": windows})
	}
	apps, err := drv.Apps(ctx, "")
	if err != nil {
		return Fail(err.Error())
	}
	list := make([]map[string]interface{}, 0, len(apps))
	background := 0
	for _, a := range apps {
		if isWorkbenchSelf(a) {
			continue // 工作台自身不可被 AI 操作
		}
		access := desktopAccess(d, a)
		if !in.All && !a.Foreground && access == "none" {
			background++
			continue
		}
		list = append(list, map[string]interface{}{"name": a.Name, "bundleId": a.BundleID, "access": access})
	}
	out := map[string]interface{}{"apps": list, "total": len(list)}
	if background > 0 {
		out["hiddenBackground"] = background
		out["hint"] = "已略去后台代理与辅助进程；确实要找它们时传 all=true"
	}
	return OKData(out)
}

func toolDesktopSnapshot(ctx context.Context, d *Deps, raw json.RawMessage) ToolResult {
	drv, err := requireDesktop(d)
	if err != nil {
		return Fail(err.Error())
	}
	var in struct {
		App      string `json:"app"`
		All      bool   `json:"all"`
		Skeleton bool   `json:"skeleton"`
		Root     string `json:"root"`
		WindowID string `json:"windowId"`
		Surface  string `json:"surface"`
		MaxDepth int    `json:"maxDepth"`
		MaxChars int    `json:"maxChars"`
	}
	_ = json.Unmarshal(raw, &in)
	app, err := desktopTarget(ctx, drv, in.App, in.Root)
	if err != nil {
		return Fail(err.Error())
	}
	if err := ensureDesktopAccess(ctx, d, app, DesktopLevelRead, workbench.CapDesktopSnapshot, ""); err != nil {
		return Fail(err.Error())
	}
	snap, err := drv.Snapshot(ctx, app, desktop.SnapshotOpts{
		All: in.All, Skeleton: in.Skeleton, Root: in.Root, WindowID: in.WindowID,
		Surface: in.Surface, MaxDepth: in.MaxDepth, MaxChars: in.MaxChars,
	})
	if err != nil {
		return Fail(err.Error())
	}
	out := map[string]interface{}{"snapshot": snap}
	if snap.Truncated {
		out["hint"] = "tree 已截断：用 skeleton=true 看概览，再把容器的 ref 传给 root 下钻，或直接 desktop_find"
	}
	return OKData(out)
}

func toolDesktopFind(ctx context.Context, d *Deps, raw json.RawMessage) ToolResult {
	drv, err := requireDesktop(d)
	if err != nil {
		return Fail(err.Error())
	}
	var in struct {
		App      string `json:"app"`
		Ref      string `json:"ref"`
		Role     string `json:"role"`
		Name     string `json:"name"`
		Text     string `json:"text"`
		Value    string `json:"value"`
		Exact    bool   `json:"exact"`
		Limit    int    `json:"limit"`
		Root     string `json:"root"`
		WindowID string `json:"windowId"`
		Surface  string `json:"surface"`
	}
	_ = json.Unmarshal(raw, &in)
	app, err := desktopTarget(ctx, drv, in.App, in.Ref, in.Root)
	if err != nil {
		return Fail(err.Error())
	}
	if err := ensureDesktopAccess(ctx, d, app, DesktopLevelRead, workbench.CapDesktopFind, ""); err != nil {
		return Fail(err.Error())
	}
	if in.Ref != "" {
		el, err := drv.Read(ctx, in.Ref)
		if err != nil {
			return Fail(err.Error())
		}
		return OKData(map[string]interface{}{"app": app.Name, "element": el})
	}
	res, err := drv.Find(ctx, app, desktop.FindOpts{
		Role: in.Role, Name: in.Name, Text: in.Text, Value: in.Value, Exact: in.Exact,
		Limit: in.Limit, Root: in.Root, WindowID: in.WindowID, Surface: in.Surface,
	})
	if err != nil {
		return Fail(err.Error())
	}
	return OKData(map[string]interface{}{"app": app.Name, "result": res})
}

func toolDesktopWait(ctx context.Context, d *Deps, raw json.RawMessage) ToolResult {
	drv, err := requireDesktop(d)
	if err != nil {
		return Fail(err.Error())
	}
	var in struct {
		App       string `json:"app"`
		Text      string `json:"text"`
		Ref       string `json:"ref"`
		Predicate string `json:"predicate"`
		Value     string `json:"value"`
		Window    string `json:"window"`
		Ms        int    `json:"ms"`
		TimeoutMs int    `json:"timeoutMs"`
	}
	_ = json.Unmarshal(raw, &in)
	opts := desktop.WaitOpts{
		Text: in.Text, Ref: in.Ref, Predicate: in.Predicate, Value: in.Value,
		Window: in.Window, Ms: in.Ms, TimeoutMs: in.TimeoutMs,
	}
	var app desktop.App
	if in.Text != "" || in.Ref != "" || in.Window != "" { // 纯延时不碰任何应用
		app, err = desktopTarget(ctx, drv, in.App, in.Ref)
		if err != nil {
			return Fail(err.Error())
		}
		if err := ensureDesktopAccess(ctx, d, app, DesktopLevelRead, workbench.CapDesktopWait, ""); err != nil {
			return Fail(err.Error())
		}
	}
	res, err := drv.Wait(ctx, app, opts)
	if err != nil {
		return Fail(err.Error())
	}
	return OKData(res)
}

func toolDesktopScreenshot(ctx context.Context, d *Deps, raw json.RawMessage) ToolResult {
	drv, err := requireDesktop(d)
	if err != nil {
		return Fail(err.Error())
	}
	var in struct {
		App      string `json:"app"`
		WindowID string `json:"windowId"`
	}
	_ = json.Unmarshal(raw, &in)
	app, err := desktopTarget(ctx, drv, in.App)
	if err != nil {
		return Fail(err.Error())
	}
	if err := ensureDesktopAccess(ctx, d, app, DesktopLevelRead, workbench.CapDesktopScreenshot, ""); err != nil {
		return Fail(err.Error())
	}
	shot, err := drv.Screenshot(ctx, app, in.WindowID)
	if err != nil {
		return Fail(err.Error())
	}
	shot["app"] = app.Name
	return OKData(shot)
}

type desktopActArgs struct {
	Action        string    `json:"action"`
	Ref           string    `json:"ref"`
	ToRef         string    `json:"toRef"`
	App           string    `json:"app"`
	Text          string    `json:"text"`
	Keys          string    `json:"keys"`
	Direction     string    `json:"direction"`
	Amount        int       `json:"amount"`
	Force         bool      `json:"force"`
	Headed        bool      `json:"headed"`
	X             *float64  `json:"x"`
	Y             *float64  `json:"y"`
	X2            *float64  `json:"x2"`
	Y2            *float64  `json:"y2"`
	Button        string    `json:"button"`
	Dx            *int      `json:"dx"`
	Dy            *int      `json:"dy"`
	Modifiers     []string  `json:"modifiers"`
	ImagePath     string    `json:"imagePath"`
	FileURL       string    `json:"fileUrl"`
	Format        string    `json:"format"`
	WindowID      string    `json:"windowId"`
	WindowTitle   string    `json:"windowTitle"`
	WaitFor       string    `json:"waitFor"`
	WaitGone      string    `json:"waitGone"`
	WaitTimeoutMs int       `json:"waitTimeoutMs"`
	Session       string    `json:"session"`
	Intent        string    `json:"intent"`
}

// desktopActTarget 校验动作参数并定位目标应用与元素语义。
func desktopActTarget(ctx context.Context, drv *desktop.Driver, in *desktopActArgs) (desktop.App, desktop.RefMeta, error) {
	in.Action = strings.ToLower(strings.TrimSpace(in.Action))
	in.Ref = strings.TrimSpace(in.Ref)
	in.ToRef = strings.TrimSpace(in.ToRef)
	var meta desktop.RefMeta
	switch {
	case desktop.IsAppAction(in.Action) && !desktop.IsRefAction(in.Action):
		// press / mouse_* / clipboard_* / focus_window / hover(可仅坐标) / drag
		if strings.TrimSpace(in.App) == "" && in.Ref == "" && in.ToRef == "" {
			return desktop.App{}, meta, errStr(in.Action + " 需要 app（授权归属的应用）")
		}
		if in.Action == desktop.ActionHover && in.Ref != "" {
			_, m, err := drv.RefInfo(in.Ref)
			if err != nil {
				return desktop.App{}, meta, err
			}
			meta = m
		}
		if in.Action == desktop.ActionDrag && in.Ref != "" {
			_, m, err := drv.RefInfo(in.Ref)
			if err != nil {
				return desktop.App{}, meta, err
			}
			meta = m
		}
	case desktop.IsRefAction(in.Action):
		if in.Ref == "" {
			return desktop.App{}, meta, errStr(in.Action + " 需要 ref（来自 desktop_snapshot / desktop_find）")
		}
		_, m, err := drv.RefInfo(in.Ref)
		if err != nil {
			return desktop.App{}, meta, err
		}
		meta = m
	default:
		return desktop.App{}, meta, errStr("不支持的 action: " + in.Action)
	}
	app, err := desktopTarget(ctx, drv, in.App, in.Ref, in.ToRef)
	return app, meta, err
}

func toolDesktopAct(ctx context.Context, d *Deps, raw json.RawMessage) ToolResult {
	drv, err := requireDesktop(d)
	if err != nil {
		return Fail(err.Error())
	}
	var in desktopActArgs
	_ = json.Unmarshal(raw, &in)
	app, meta, err := desktopActTarget(ctx, drv, &in)
	if err != nil {
		return Fail(err.Error())
	}
	if err := ensureDesktopAccess(ctx, d, app, DesktopLevelAct, workbench.CapDesktopAct, in.Intent); err != nil {
		return Fail(err.Error())
	}
	summary := desktopStepSummary(in, app, meta)
	preview := map[string]interface{}{"app": app.Name, "step": summary}
	if app.BundleID != "" {
		preview["bundleId"] = app.BundleID
	}
	if in.Text != "" {
		preview["text"] = truncateRunes(in.Text, 80)
	}
	if in.Intent != "" {
		preview["intent"] = in.Intent
	}
	if in.Headed || desktop.NeedsHeaded(in.Action) {
		preview["headed"] = true
		preview["note"] = "物理输入：会抢应用焦点并可能移动鼠标"
	}
	if in.Action == desktop.ActionPress && in.Force {
		// 危险快捷键不随「询问」开关豁免，也不走侧栏的免确认路径：每次都单独拍板
		if d.MCPConfirm == nil {
			return Fail("工作台确认门未就绪，请在 App 内打开 WWorkbench 后重试")
		}
		preview["risk"] = "该快捷键被标为危险：可能退出应用、关闭窗口或丢失未保存内容"
		body, _ := json.Marshal(preview)
		approved, err := d.MCPConfirm.Await(ctx, MCPConfirmRequest{
			ToolName: workbench.CapDesktopAct, Summary: "强制" + summary + "？", Preview: body, ConfirmLabel: "发送",
		})
		if err != nil {
			return Fail(err.Error())
		}
		if !approved {
			return Fail("用户已在工作台拒绝：" + summary)
		}
		return runDesktopAct(ctx, d, drv, in, app, meta)
	}
	return Confirm(uuid.NewString(), summary, preview)
}

// DesktopActConfirmed 逐步确认通过（或「询问」关闭）后执行桌面操作。
func DesktopActConfirmed(ctx context.Context, d *Deps, argsJSON string) ToolResult {
	drv, err := requireDesktop(d)
	if err != nil {
		return Fail(err.Error())
	}
	var in desktopActArgs
	_ = json.Unmarshal([]byte(argsJSON), &in)
	in.Force = false // 强制快捷键只走 toolDesktopAct 里的逐次确认
	app, meta, err := desktopActTarget(ctx, drv, &in)
	if err != nil {
		return Fail(err.Error())
	}
	if d.DesktopGrants == nil || !d.DesktopGrants.Allows(app.Key(), DesktopLevelAct) {
		return Fail("应用「" + app.Name + "」的操作授权已被撤销")
	}
	return runDesktopAct(ctx, d, drv, in, app, meta)
}

// runDesktopAct 执行并记账；locator 存 app + role + name（ref 每次快照都变，复现靠语义定位）。
func runDesktopAct(ctx context.Context, d *Deps, drv *desktop.Driver, in desktopActArgs, app desktop.App, meta desktop.RefMeta) ToolResult {
	args := map[string]interface{}{"action": in.Action}
	for k, v := range map[string]string{
		"text": in.Text, "keys": in.Keys, "direction": in.Direction,
		"waitFor": in.WaitFor, "waitGone": in.WaitGone, "button": in.Button,
		"imagePath": in.ImagePath, "fileUrl": in.FileURL, "format": in.Format,
		"windowId": in.WindowID, "windowTitle": in.WindowTitle, "toRef": in.ToRef,
	} {
		if v != "" {
			args[k] = v
		}
	}
	if in.Amount > 0 {
		args["amount"] = in.Amount
	}
	if in.Headed || desktop.NeedsHeaded(in.Action) {
		args["headed"] = true
	}
	if in.X != nil && in.Y != nil {
		args["x"], args["y"] = *in.X, *in.Y
	}
	if in.X2 != nil && in.Y2 != nil {
		args["x2"], args["y2"] = *in.X2, *in.Y2
	}
	locator := map[string]interface{}{"app": app.Key(), "appName": app.Name}
	if meta.Role != "" {
		locator["role"] = meta.Role
	}
	if meta.Name != "" {
		locator["name"] = meta.Name
	}
	step := TaskStepInput{
		Session: in.Session, Tool: workbench.CapDesktopAct, Action: "desktop_" + in.Action,
		Intent: in.Intent, Summary: desktopStepSummary(in, app, meta),
		Args: args, Locator: locator, Approved: true, Provider: model.TaskProviderAgentDesktop,
	}
	res, err := drv.Act(ctx, app, desktop.ActOpts{
		Action: in.Action, Ref: in.Ref, ToRef: in.ToRef, Text: in.Text, Keys: in.Keys,
		Direction: in.Direction, Amount: in.Amount, Force: in.Force, Headed: in.Headed,
		X: in.X, Y: in.Y, X2: in.X2, Y2: in.Y2, Button: in.Button, Dx: in.Dx, Dy: in.Dy,
		Modifiers: in.Modifiers, ImagePath: in.ImagePath, FileURL: in.FileURL, Format: in.Format,
		WindowID: in.WindowID, WindowTitle: in.WindowTitle,
		WaitFor: in.WaitFor, WaitGone: in.WaitGone, WaitTimeoutMs: in.WaitTimeoutMs,
	})
	if err != nil {
		return recordBrowserFail(ctx, d, step, err)
	}
	res["app"] = app.Name
	data, _ := json.Marshal(res)
	return recordBrowserOK(ctx, d, step, data)
}

// desktopStepSummary 人话步骤摘要：确认弹窗标题与任务账本共用。
func desktopStepSummary(in desktopActArgs, app desktop.App, meta desktop.RefMeta) string {
	target := meta.Role
	if meta.Name != "" {
		target = strings.TrimSpace(target + "「" + truncateRunes(meta.Name, 30) + "」")
	}
	if target == "" {
		target = in.Ref
	}
	coord := ""
	if in.X != nil && in.Y != nil {
		coord = fmt.Sprintf("(%.0f,%.0f)", *in.X, *in.Y)
	}
	var s string
	switch in.Action {
	case desktop.ActionPress:
		s = "按键 " + in.Keys
		if in.Headed {
			s += "（headed）"
		}
	case desktop.ActionFocusWindow:
		s = "前置窗口"
	case desktop.ActionMouseClick:
		s = "鼠标点击 " + coord
	case desktop.ActionMouseMove:
		s = "移动光标 " + coord
	case desktop.ActionMouseWheel:
		s = "滚轮 " + coord
	case desktop.ActionHover:
		if coord != "" {
			s = "悬停 " + coord
		} else {
			s = "悬停 " + target
		}
	case desktop.ActionDrag:
		s = "拖拽"
		if coord != "" {
			s += " " + coord
		}
	case desktop.ActionClipboardSet:
		s = "写入剪贴板"
		if in.ImagePath != "" {
			s += "（图片）"
		}
	case desktop.ActionClipboardGet:
		s = "读取剪贴板"
	case "type":
		s = fmt.Sprintf("输入 %d 字 → %s", utf8.RuneCountInString(in.Text), target)
	case "set_value":
		s = fmt.Sprintf("设值 %d 字 → %s", utf8.RuneCountInString(in.Text), target)
	case "select":
		s = "选择「" + truncateRunes(in.Text, 30) + "」· " + target
	default:
		verb, ok := desktopVerbs[in.Action]
		if !ok {
			verb = in.Action
		}
		s = verb + " " + target
	}
	return s + " · " + app.Name
}

var desktopVerbs = map[string]string{
	"click": "点击", "right_click": "右键", "double_click": "双击", "triple_click": "三击",
	"clear": "清空", "toggle": "切换", "check": "勾选", "uncheck": "取消勾选",
	"expand": "展开", "collapse": "收起", "scroll": "滚动", "scroll_to": "滚动到", "focus": "聚焦",
}

func toolDesktopLaunch(ctx context.Context, d *Deps, raw json.RawMessage) ToolResult {
	drv, err := requireDesktop(d)
	if err != nil {
		return Fail(err.Error())
	}
	var in struct {
		App     string `json:"app"`
		Session string `json:"session"`
		Intent  string `json:"intent"`
	}
	_ = json.Unmarshal(raw, &in)
	name := strings.TrimSpace(in.App)
	if d.DesktopGrants == nil {
		return Fail("桌面授权簿未就绪")
	}
	// 已在运行：按归一后的应用检查授权。未运行：拿不到 bundle id，先按名字问，启动后再落到真实应用上。
	askedByName := false
	running, err := drv.Resolve(ctx, name)
	switch {
	case err == nil:
		if err := ensureDesktopAccess(ctx, d, running, DesktopLevelAct, workbench.CapDesktopLaunch, in.Intent); err != nil {
			return Fail(err.Error())
		}
	case desktop.IsCode(err, desktop.CodeAppNotFound):
		if !d.DesktopGrants.allowsName(name, DesktopLevelAct) {
			if err := askDesktopGrant(ctx, d, desktop.App{Name: name}, DesktopLevelAct, workbench.CapDesktopLaunch, in.Intent); err != nil {
				return Fail(err.Error())
			}
			askedByName = true
		}
	default:
		return Fail(err.Error())
	}

	step := TaskStepInput{
		Session: in.Session, Tool: workbench.CapDesktopLaunch, Action: "desktop_launch",
		Intent: in.Intent, Summary: "启动 " + name, Args: map[string]interface{}{"app": name},
		Approved: true, Provider: model.TaskProviderAgentDesktop,
	}
	app, window, err := drv.Launch(ctx, name)
	if err != nil {
		return recordBrowserFail(ctx, d, step, err)
	}
	if askedByName && !isWorkbenchSelf(app) {
		d.DesktopGrants.Grant(app.Key(), app.Name, DesktopLevelAct)
	} else if err := ensureDesktopAccess(ctx, d, app, DesktopLevelAct, workbench.CapDesktopLaunch, in.Intent); err != nil {
		// 名字对上了已有授权，但启动起来的是另一个应用：必须重新过问
		return recordBrowserFail(ctx, d, step, err)
	}
	step.Summary = "启动 " + app.Name
	step.Locator = map[string]interface{}{"app": app.Key(), "appName": app.Name}
	out := map[string]interface{}{"app": app, "access": desktopAccess(d, app)}
	if window != nil {
		out["window"] = window
	}
	data, _ := json.Marshal(out)
	return recordBrowserOK(ctx, d, step, data)
}
