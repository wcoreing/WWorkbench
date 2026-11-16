package browser

import (
	"context"
	"encoding/json"
	"fmt"
	"regexp"
	"strconv"
	"strings"
	"time"

	"WWorkbench/internal/errno"
)

// AgentBrowserCapabilities agent-browser 执行器能力（无 tab_group / open_frame / record）。
var AgentBrowserCapabilities = []string{
	"snapshot", "ax_snapshot", "click", "fill", "find", "wait", "pointer", "keys", "send_keys",
	"mouse_click", "screenshot", "iframe", "find_tab", "list_tabs", "attach", "run",
	"evaluate", "read_page", "upload", "network", "select", "select_option", "drag", "close_session",
}

// Call 把工作台 browser_* 动作翻译成 agent-browser 命令，并把结果整形成与扩展执行器一致的字段。
func (e *AgentBrowserExecutor) Call(ctx context.Context, action string, args json.RawMessage, session string) (json.RawMessage, error) {
	if e == nil {
		return nil, errno.New(errno.CodeConnFailed, "agent-browser 执行器未就绪", "")
	}
	action = strings.TrimSpace(action)
	if action == "" {
		return nil, errno.New(errno.CodeInvalidArg, "缺少 action", "")
	}
	a := abArgs{}
	if len(args) > 0 && string(args) != "null" {
		if err := json.Unmarshal(args, &a); err != nil {
			return nil, errno.Wrap(errno.CodeInvalidArg, "参数不是 JSON 对象", err)
		}
	}
	ctx, cancel := context.WithTimeout(ctx, callTimeout)
	defer cancel()
	out, err := e.dispatch(ctx, action, a, strings.TrimSpace(session))
	if err != nil {
		return nil, err
	}
	return json.Marshal(out)
}

func (e *AgentBrowserExecutor) dispatch(ctx context.Context, action string, a abArgs, session string) (map[string]interface{}, error) {
	if a == nil {
		a = abArgs{}
	}
	switch action {
	case "status":
		return map[string]interface{}{"executor": ExecutorNameAgentBrowser, "running": e.running(ctx)}, nil
	case "list_tabs":
		return e.listTabs(ctx)
	case "close_session":
		return e.closeSession(ctx, a.str("session"), session)
	case "group_session", "ensure_group":
		return nil, errStr("agent-browser 是独立浏览器，没有用户标签可借，不支持 group_session；直接 browser_navigate 打开页面（登录态保存在工作台专用 profile）")
	case "open_frame":
		return nil, errStr("agent-browser 快照已内联 iframe 内元素，直接用 ref 操作，无需 open_frame")
	case "record_start", "record_stop", "record_status":
		return nil, errStr("录制为扩展执行器（executor=wwb）独有")
	}
	e.touch(session)
	switch action {
	case "attach":
		return e.attach(ctx, a)
	case "find_tab":
		return e.findTab(ctx, a)
	case "navigate":
		return e.navigate(ctx, a, session)
	case "snapshot":
		return e.snapshot(ctx, a.num("maxChars", "max_chars"), 12000)
	case "find":
		return e.find(ctx, a)
	case "click", "mouse_click":
		return e.click(ctx, a)
	case "fill":
		return e.fill(ctx, a)
	case "keys", "send_keys":
		return e.keys(ctx, a)
	case "select_option", "select":
		return e.selectOption(ctx, a)
	case "drag":
		return e.drag(ctx, a)
	case "upload":
		return e.upload(ctx, a)
	case "screenshot":
		return e.screenshot(ctx, a)
	case "evaluate":
		return e.evaluate(ctx, a)
	case "read_page":
		return e.readPage(ctx, a)
	case "network":
		return e.network(ctx, a)
	case "wait":
		w, ok := abWaitSpec(a, false)
		if !ok {
			return nil, errStr("wait 请提供 text / textGone / nameIncludes / ref / selector / readyState")
		}
		out, err := e.wait(ctx, w)
		if err != nil {
			return nil, err
		}
		e.observe(ctx, a, "off", out)
		return out, nil
	case "run":
		return e.runSteps(ctx, a, session)
	}
	return nil, errStr("agent-browser 执行器不支持动作 " + action)
}

// ---- 入参 ----

type abArgs map[string]interface{}

// str 取第一个非空字符串（去首尾空白）；用于定位符、枚举等。
func (a abArgs) str(keys ...string) string {
	for _, k := range keys {
		if s, ok := a[k].(string); ok && strings.TrimSpace(s) != "" {
			return strings.TrimSpace(s)
		}
	}
	return ""
}

// text 取要写进页面的文本，保留原样（不去空白）；数字/布尔转成字面量。
func (a abArgs) text(keys ...string) string {
	for _, k := range keys {
		switch v := a[k].(type) {
		case string:
			if v != "" {
				return v
			}
		case float64:
			return strconv.FormatFloat(v, 'f', -1, 64)
		case bool:
			return strconv.FormatBool(v)
		}
	}
	return ""
}

func (a abArgs) num(keys ...string) float64 {
	for _, k := range keys {
		if f, ok := a[k].(float64); ok {
			return f
		}
	}
	return 0
}

func (a abArgs) on(keys ...string) bool {
	for _, k := range keys {
		if b, ok := a[k].(bool); ok && b {
			return true
		}
	}
	return false
}

func clampNum(v, def, lo, hi float64) float64 {
	if v <= 0 {
		v = def
	}
	if v < lo {
		return lo
	}
	if v > hi {
		return hi
	}
	return v
}

func abSleep(ctx context.Context, d time.Duration) bool {
	select {
	case <-ctx.Done():
		return false
	case <-time.After(d):
		return true
	}
}

// ---- 定位 ----

var abRefRe = regexp.MustCompile(`^@?(e\d+)$`)

// abRef 把 e7 / @e7 / [ref=e7] 统一成 agent-browser 的 @e7；不是 ref 则返回空。
func abRef(s string) string {
	s = strings.TrimSuffix(strings.TrimPrefix(strings.TrimSpace(s), "[ref="), "]")
	if m := abRefRe.FindStringSubmatch(s); m != nil {
		return "@" + m[1]
	}
	return ""
}

// abMatch 快照里带 ref 的元素。
type abMatch struct {
	Ref  string `json:"ref"`
	Name string `json:"name"`
	Role string `json:"role"`
}

// abMatchRefs 按无障碍名包含匹配（不分大小写），全等的排前面。
func abMatchRefs(refs []abMatch, query string) []abMatch {
	q := strings.ToLower(strings.TrimSpace(query))
	if q == "" {
		return nil
	}
	var exact, partial []abMatch
	for _, r := range refs {
		name := strings.ToLower(strings.TrimSpace(r.Name))
		switch {
		case name == q:
			exact = append(exact, r)
		case strings.Contains(name, q):
			partial = append(partial, r)
		}
	}
	return append(exact, partial...)
}

// target 取操作目标：ref 优先，其次 selector，都没有时按无障碍名在快照里找。
func (e *AgentBrowserExecutor) target(ctx context.Context, ref, selector, name string) (string, error) {
	if r := abRef(ref); r != "" {
		return r, nil
	}
	if r := abRef(selector); r != "" {
		return r, nil
	}
	if selector != "" {
		return selector, nil
	}
	if ref != "" {
		return "", errStr("ref " + ref + " 不是 agent-browser 的引用（形如 @e7）；请先 browser_snapshot 取新 ref")
	}
	if name == "" {
		return "", errStr("请提供 ref（快照中的 @eN）或 selector")
	}
	_, _, refs, err := e.snapshotRaw(ctx)
	if err != nil {
		return "", err
	}
	if m := abMatchRefs(refs, name); len(m) > 0 {
		return m[0].Ref, nil
	}
	return "", errStr("未找到名称含「" + name + "」的元素")
}

// ---- 标签与会话 ----

// abSeq 取 tN / @eN 里的序号。
func abSeq(id string) int {
	n, _ := strconv.Atoi(strings.TrimLeft(id, "@et"))
	return n
}

func abTabID(n int) string { return "t" + strconv.Itoa(n) }

// tabList 标签列表；tabId 取 agent-browser 稳定 id（tN）的序号，对齐工作台的数字 tabId。
func (e *AgentBrowserExecutor) tabList(ctx context.Context) ([]map[string]interface{}, error) {
	res, err := e.one(ctx, "tab", "list")
	if err != nil {
		return nil, err
	}
	raw, _ := res["tabs"].([]interface{})
	tabs := make([]map[string]interface{}, 0, len(raw))
	for _, t := range raw {
		m, ok := t.(map[string]interface{})
		if !ok {
			continue
		}
		id, _ := m["tabId"].(string)
		active, _ := m["active"].(bool)
		tabs = append(tabs, map[string]interface{}{
			"tabId": abSeq(id), "url": m["url"], "title": m["title"], "active": active, "attached": active,
		})
	}
	return tabs, nil
}

func (e *AgentBrowserExecutor) listTabs(ctx context.Context) (map[string]interface{}, error) {
	if !e.running(ctx) {
		return map[string]interface{}{
			"tabs": []interface{}{}, "running": false,
			"note": "agent-browser 浏览器未启动；browser_navigate 会自动拉起",
		}, nil
	}
	tabs, err := e.tabList(ctx)
	if err != nil {
		return nil, err
	}
	out := map[string]interface{}{"tabs": tabs, "running": true}
	for _, t := range tabs {
		if t["active"] == true {
			out["attachedTabId"] = t["tabId"]
		}
	}
	return out, nil
}

func (e *AgentBrowserExecutor) attach(ctx context.Context, a abArgs) (map[string]interface{}, error) {
	n := int(a.num("tabId"))
	if n <= 0 {
		return nil, errStr("请提供 tabId（先 browser_list_tabs）")
	}
	res, err := e.one(ctx, "tab", abTabID(n))
	if err != nil {
		return nil, err
	}
	return map[string]interface{}{"tabId": n, "url": res["url"], "title": res["title"], "attached": true}, nil
}

func (e *AgentBrowserExecutor) findTab(ctx context.Context, a abArgs) (map[string]interface{}, error) {
	if !e.running(ctx) {
		return nil, errStr("agent-browser 浏览器未启动，没有可附着的标签：先 browser_navigate 打开页面（独立浏览器，借不到用户已开的标签）")
	}
	tabs, err := e.tabList(ctx)
	if err != nil {
		return nil, err
	}
	active := a.on("active")
	query := strings.ToLower(a.str("url", "query"))
	if !active && query == "" {
		return nil, errStr("请提供 url/query，或 active:true")
	}
	for _, t := range tabs {
		isActive := t["active"] == true
		url, _ := t["url"].(string)
		title, _ := t["title"].(string)
		hit := isActive
		if !active {
			hit = strings.Contains(strings.ToLower(url), query) || strings.Contains(strings.ToLower(title), query)
		}
		if !hit {
			continue
		}
		if !isActive {
			if _, err := e.one(ctx, "tab", abTabID(t["tabId"].(int))); err != nil {
				return nil, err
			}
		}
		t["active"], t["attached"], t["borrowed"] = true, true, false
		return t, nil
	}
	if active {
		return nil, errStr("当前没有可附着的活动标签")
	}
	return nil, errStr("未找到匹配标签: " + query)
}

func (e *AgentBrowserExecutor) navigate(ctx context.Context, a abArgs, session string) (map[string]interface{}, error) {
	url := a.str("url")
	if url == "" {
		return nil, errStr("请提供 url")
	}
	out := map[string]interface{}{"url": url, "newTab": false}
	if session != "" {
		out["session"] = session
	}
	// 浏览器未启动时 tab new 会多留一个空白标签，此时用 open 直接在首个标签打开
	if a.on("newTab") && e.running(ctx) {
		res, err := e.one(ctx, "tab", "new", url)
		if err != nil {
			return nil, err
		}
		if id, _ := res["tabId"].(string); id != "" {
			e.own(session, id)
			out["tabId"] = abSeq(id)
		}
		out["newTab"] = true
	} else {
		res, err := e.one(ctx, "open", url)
		if err != nil {
			return nil, err
		}
		for _, k := range []string{"url", "title"} {
			if v, ok := res[k]; ok {
				out[k] = v
			}
		}
	}
	e.settle(ctx, a, "off", out)
	return out, nil
}

// closeSession 任务收口：没有其他任务在用就关掉整个浏览器（登录态留在 profile），否则只关本任务新开的标签。
func (e *AgentBrowserExecutor) closeSession(ctx context.Context, name, session string) (map[string]interface{}, error) {
	if name == "" {
		name = session
	}
	owned, others := e.release(name)
	out := map[string]interface{}{"session": name, "closed": true, "browserClosed": true}
	if !e.running(ctx) {
		return out, nil
	}
	if others == 0 {
		if _, err := e.one(ctx, "close"); err != nil {
			return nil, err
		}
		out["note"] = "已关闭 agent-browser 浏览器；登录态保留在工作台专用 profile"
		return out, nil
	}
	closed := 0
	for _, tab := range owned {
		if _, err := e.one(ctx, "tab", "close", tab); err == nil {
			closed++
		}
	}
	out["browserClosed"] = false
	out["closedTabs"] = closed
	out["note"] = "其他任务仍在用浏览器，只关闭了本任务新开的标签"
	return out, nil
}

// ---- 宏 ----

var abRunReadActions = map[string]bool{
	"snapshot": true, "find": true, "evaluate": true, "read_page": true,
	"wait": true, "list_tabs": true, "status": true, "find_tab": true,
}

var abRunWriteActions = map[string]bool{
	"fill": true, "click": true, "keys": true, "navigate": true, "select_option": true, "network": true,
}

// runSteps 顺序执行 steps，遇错即停；读写边界与扩展的 run 一致（写步骤需 allowWrite，上传/拖拽/收口不进宏）。
func (e *AgentBrowserExecutor) runSteps(ctx context.Context, a abArgs, session string) (map[string]interface{}, error) {
	steps, _ := a["steps"].([]interface{})
	if len(steps) == 0 {
		return nil, errStr("run 需要 steps[]")
	}
	mode := strings.ToLower(a.str("mode"))
	allowWrite := a.on("allowWrite", "allow_write") || mode == "write" || mode == "macro"
	results := make([]map[string]interface{}, 0, len(steps))
	for i, raw := range steps {
		st, _ := raw.(map[string]interface{})
		act := abArgs(st).str("action")
		switch act {
		case "send_keys":
			act = "keys"
		case "mouse_click":
			act = "click"
		case "select":
			act = "select_option"
		}
		switch {
		case act == "":
			return nil, errStr(fmt.Sprintf("steps[%d] 缺 action", i))
		case abRunWriteActions[act] && !allowWrite:
			return nil, errStr("run 默认只读；写步骤请传 allowWrite=true（或 mode=macro）：" + act)
		case !abRunReadActions[act] && !abRunWriteActions[act]:
			return nil, errStr("run 不允许：" + act)
		}
		stepArgs, _ := st["args"].(map[string]interface{})
		data, err := e.dispatch(ctx, act, abArgs(stepArgs), session)
		if err != nil {
			results = append(results, map[string]interface{}{"action": act, "ok": false, "error": err.Error()})
			return map[string]interface{}{"stoppedAt": i, "results": results, "ok": false, "allowWrite": allowWrite}, nil
		}
		results = append(results, map[string]interface{}{"action": act, "ok": true, "data": data})
	}
	return map[string]interface{}{"stoppedAt": nil, "results": results, "ok": true, "allowWrite": allowWrite}, nil
}
