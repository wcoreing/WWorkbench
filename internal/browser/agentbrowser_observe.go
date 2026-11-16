package browser

import (
	"context"
	"encoding/base64"
	"fmt"
	"os"
	"path/filepath"
	"sort"
	"strconv"
	"strings"
	"time"

	"WWorkbench/internal/errno"
)

// agent-browser 执行器：观察、等待与读取类动作。

// ---- 观察 ----

// snapshotRaw 取可交互无障碍树：正文、页面地址、带 ref 的元素（按 ref 序号排序）。
// agent-browser 的 ref 跨快照稳定，内部多取一次快照不会让调用方手里的 ref 失效。
func (e *AgentBrowserExecutor) snapshotRaw(ctx context.Context) (text, origin string, refs []abMatch, err error) {
	res, err := e.one(ctx, "snapshot", "-i")
	if err != nil {
		return "", "", nil, err
	}
	text, _ = res["snapshot"].(string)
	origin, _ = res["origin"].(string)
	if m, ok := res["refs"].(map[string]interface{}); ok {
		for id, v := range m {
			item, _ := v.(map[string]interface{})
			name, _ := item["name"].(string)
			role, _ := item["role"].(string)
			refs = append(refs, abMatch{Ref: "@" + id, Name: name, Role: role})
		}
	}
	sort.Slice(refs, func(i, j int) bool {
		return abSeq(refs[i].Ref) < abSeq(refs[j].Ref)
	})
	return text, origin, refs, nil
}

func (e *AgentBrowserExecutor) snapshot(ctx context.Context, maxChars, defChars float64) (map[string]interface{}, error) {
	text, origin, refs, err := e.snapshotRaw(ctx)
	if err != nil {
		return nil, err
	}
	out := map[string]interface{}{
		"format": "aria", "url": origin, "refCount": len(refs), "source": ExecutorNameAgentBrowser,
		"note": "ref 写法：树里的 [ref=e7] 即 ref=@e7；iframe 内元素已内联，直接用 ref",
	}
	if r, max := []rune(text), int(clampNum(maxChars, defChars, 200, 60000)); len(r) > max {
		text = string(r[:max])
		out["truncated"] = true
		out["note"] = "快照已截断：调大 maxChars，或用 browser_find 按名称找元素"
	}
	if strings.TrimSpace(text) == "" {
		out["note"] = "页面没有可交互元素（空白页或仍在加载）"
	}
	out["tree_text"] = text
	return out, nil
}

func (e *AgentBrowserExecutor) find(ctx context.Context, a abArgs) (map[string]interface{}, error) {
	query := a.str("query")
	if query == "" {
		return nil, errStr("请提供 query")
	}
	_, _, refs, err := e.snapshotRaw(ctx)
	if err != nil {
		return nil, err
	}
	matches := abMatchRefs(refs, query)
	total := len(matches)
	if total > 50 {
		matches = matches[:50]
	}
	if matches == nil {
		matches = []abMatch{}
	}
	return map[string]interface{}{"query": query, "matches": matches, "totalMatches": total}, nil
}

// abObservationMode 对齐扩展：off 不带观察；probe 只带 url/title；ax 带回可交互快照。
func abObservationMode(a abArgs, def string) string {
	raw := a["observation"]
	if raw == nil {
		raw = a["includeSnapshot"]
	}
	switch v := raw.(type) {
	case bool:
		if v {
			return "ax"
		}
		return "off"
	case string:
		switch strings.ToLower(strings.TrimSpace(v)) {
		case "false", "off", "none":
			return "off"
		case "probe", "light":
			return "probe"
		case "true", "ax", "full":
			return "ax"
		}
	}
	return def
}

// observe 交互后的观察，省掉调用方再发一次 browser_snapshot。
func (e *AgentBrowserExecutor) observe(ctx context.Context, a abArgs, def string, out map[string]interface{}) {
	switch abObservationMode(a, def) {
	case "probe":
		obs := map[string]interface{}{"kind": "probe"}
		res, _ := e.run(ctx, nil, []string{"get", "url"}, []string{"get", "title"})
		for _, r := range res {
			for k, v := range r {
				obs[k] = v
			}
		}
		out["observation"] = obs
	case "ax":
		abSleep(ctx, 100*time.Millisecond) // 等页面对交互作出反应
		snap, err := e.snapshot(ctx, a.num("snapshotMaxChars"), 8000)
		if err != nil {
			out["observationError"] = err.Error()
			return
		}
		snap["kind"] = "ax"
		out["observation"] = snap
	}
}

// settle 交互类动作收尾：waitFor* 内联短等 + 观察。
// 带 waitFor 时：等到了只带轻量观察，没等到带回快照（让调用方看清页面现状）。
func (e *AgentBrowserExecutor) settle(ctx context.Context, a abArgs, def string, out map[string]interface{}) {
	if w, ok := abWaitSpec(a, true); ok {
		def = "ax"
		res, err := e.wait(ctx, w)
		if err != nil {
			res = map[string]interface{}{"matched": false, "error": err.Error()}
		} else if res["matched"] == true {
			def = "probe"
		}
		out["wait"] = res
	}
	e.observe(ctx, a, def, out)
}

// ---- 等待 ----

type abWait struct {
	text, textGone, nameIncludes, ref, selector string
	ready                                       bool
	timeout                                     time.Duration
}

// abWaitSpec 解析等待条件。inline=true 读交互动作上的 waitFor* 字段（短等），否则读 browser_wait 的字段。
func abWaitSpec(a abArgs, inline bool) (abWait, bool) {
	w := abWait{
		text: a.str("text"), textGone: a.str("textGone", "text_gone"), nameIncludes: a.str("nameIncludes"),
		ref: a.str("ref"), selector: a.str("selector"), ready: a.on("readyState"),
	}
	ms := clampNum(a.num("timeoutMs", "timeout_ms"), 8000, 200, 40000)
	if inline {
		w = abWait{
			text: a.str("waitFor", "waitForText"), textGone: a.str("waitForTextGone"),
			nameIncludes: a.str("waitForNameIncludes", "waitForName"),
			ref:          a.str("waitForRef"), selector: a.str("waitForSelector"),
			ready: a.on("waitForReady", "waitForReadyState"),
		}
		ms = clampNum(a.num("waitForTimeoutMs", "waitTimeoutMs"), 3000, 200, 20000)
	}
	w.timeout = time.Duration(ms) * time.Millisecond
	ok := w.ready || w.text != "" || w.textGone != "" || w.nameIncludes != "" || w.ref != "" || w.selector != ""
	return w, ok
}

// wait 只判一个条件，优先级同扩展：readyState > text > textGone > nameIncludes > ref > selector。超时不算错误。
func (e *AgentBrowserExecutor) wait(ctx context.Context, w abWait) (map[string]interface{}, error) {
	start := time.Now()
	var (
		kind    string
		matched bool
		err     error
	)
	switch {
	case w.ready:
		kind = "readyState"
		matched, err = e.waitCmd(ctx, w.timeout, "--fn", `document.readyState==="complete"`)
	case w.text != "":
		kind = "text"
		matched, err = e.waitCmd(ctx, w.timeout, "--text", w.text)
	case w.textGone != "":
		kind = "textGone"
		matched, err = e.waitCmd(ctx, w.timeout, "--fn", "!(document.body?document.body.innerText:'').includes("+strconvQuote(w.textGone)+")")
	case w.nameIncludes != "":
		kind = "nameIncludes"
		matched, err = e.waitRefs(ctx, w.timeout, func(refs []abMatch) bool { return len(abMatchRefs(refs, w.nameIncludes)) > 0 })
	case abRef(w.ref) != "":
		// agent-browser 的 wait @eN 实测不命中，改为轮询快照里是否有该 ref
		kind = "ref"
		ref := abRef(w.ref)
		matched, err = e.waitRefs(ctx, w.timeout, func(refs []abMatch) bool {
			for _, r := range refs {
				if r.Ref == ref {
					return true
				}
			}
			return false
		})
	case w.selector != "":
		kind = "selector"
		matched, err = e.waitCmd(ctx, w.timeout, w.selector)
	default:
		return nil, errStr("ref " + w.ref + " 不是 agent-browser 的引用（形如 @e7）")
	}
	if err != nil {
		return nil, err
	}
	return map[string]interface{}{
		"matched": matched, "timedOut": !matched, "waitedMs": time.Since(start).Milliseconds(), "kind": kind,
	}, nil
}

func (e *AgentBrowserExecutor) waitCmd(ctx context.Context, timeout time.Duration, cond ...string) (bool, error) {
	cmd := append([]string{"wait"}, cond...)
	_, err := e.one(ctx, append(cmd, "--timeout", strconv.FormatInt(timeout.Milliseconds(), 10))...)
	if err == nil {
		return true, nil
	}
	if strings.Contains(strings.ToLower(err.Error()), "timed out") {
		return false, nil
	}
	return false, err
}

func (e *AgentBrowserExecutor) waitRefs(ctx context.Context, timeout time.Duration, hit func([]abMatch) bool) (bool, error) {
	deadline := time.Now().Add(timeout)
	for {
		if _, _, refs, err := e.snapshotRaw(ctx); err == nil && hit(refs) {
			return true, nil
		}
		if time.Now().After(deadline) {
			return false, nil
		}
		if !abSleep(ctx, 300*time.Millisecond) {
			return false, ctx.Err()
		}
	}
}

// ---- 读取 ----

func (e *AgentBrowserExecutor) screenshot(ctx context.Context, a abArgs) (map[string]interface{}, error) {
	format, ext := "jpeg", "jpg"
	if strings.EqualFold(a.str("format"), "png") {
		format, ext = "png", "png"
	}
	dir := filepath.Join(e.dataDir, "browser-shots")
	if err := os.MkdirAll(dir, 0o755); err != nil {
		return nil, errno.Wrap(errno.CodeStoreFailed, "创建截图目录失败", err)
	}
	path := filepath.Join(dir, "shot-"+time.Now().Format("20060102-150405.000")+"."+ext)
	outer := []string{"--screenshot-format", format}
	if q := a.num("quality"); format == "jpeg" && q > 0 {
		outer = append(outer, "--screenshot-quality", strconv.Itoa(int(clampNum(q, q, 1, 100))))
	}
	res, err := e.run(ctx, outer, []string{"screenshot", path}, []string{"get", "url"}, []string{"get", "title"})
	if len(res) == 0 {
		return nil, err
	}
	out := map[string]interface{}{"path": path, "format": format, "source": ExecutorNameAgentBrowser}
	if st, err := os.Stat(path); err == nil {
		out["sizeBytes"] = st.Size()
	}
	for _, r := range res[1:] {
		for k, v := range r {
			out[k] = v
		}
	}
	return out, nil
}

func (e *AgentBrowserExecutor) eval(ctx context.Context, code string) (interface{}, error) {
	res, err := e.one(ctx, "eval", "-b", base64.StdEncoding.EncodeToString([]byte(code)))
	if err != nil {
		return nil, err
	}
	return res["result"], nil
}

func (e *AgentBrowserExecutor) evaluate(ctx context.Context, a abArgs) (map[string]interface{}, error) {
	code := a.text("code")
	if strings.TrimSpace(code) == "" {
		return nil, errStr("请提供 code")
	}
	val, err := e.eval(ctx, code)
	if err != nil {
		return nil, err
	}
	typ := "object"
	switch val.(type) {
	case nil:
		typ = "undefined"
	case string:
		typ = "string"
	case float64:
		typ = "number"
	case bool:
		typ = "boolean"
	}
	return map[string]interface{}{"type": typ, "value": val}, nil
}

// readPage 与扩展同语义：body.innerText 分页读取（切片在页内完成，避免回传整页）。
func (e *AgentBrowserExecutor) readPage(ctx context.Context, a abArgs) (map[string]interface{}, error) {
	max := int(clampNum(a.num("maxChars"), 8000, 200, 60000))
	start := int(a.num("start"))
	if start < 0 {
		start = 0
	}
	val, err := e.eval(ctx, fmt.Sprintf(`(() => {
  const raw = ((document.body && document.body.innerText) || document.documentElement.innerText || "").replace(/\r/g, "");
  const text = raw.slice(%d, %d);
  const next = %d + text.length;
  const complete = next >= raw.length;
  return { text, complete, nextStart: complete ? undefined : next, start: %d, totalChars: raw.length, url: location.href, title: document.title };
})()`, start, start+max, start, start))
	if err != nil {
		return nil, err
	}
	out, ok := val.(map[string]interface{})
	if !ok {
		return nil, errStr("读取页面正文失败")
	}
	if out["complete"] != true {
		out["note"] = "未读完：把 nextStart 作为 start 继续 read_page"
	}
	return out, nil
}

func (e *AgentBrowserExecutor) network(ctx context.Context, a abArgs) (map[string]interface{}, error) {
	cmd := strings.ToLower(a.str("cmd", "action"))
	switch cmd {
	case "start":
		if _, err := e.one(ctx, "network", "requests", "--clear"); err != nil {
			return nil, err
		}
		return map[string]interface{}{"capturing": true, "note": "agent-browser 持续捕获网络；已清空历史。list/verify 查看，detail 取 body"}, nil
	case "stop":
		return map[string]interface{}{"capturing": true, "note": "agent-browser 持续捕获网络，无需 stop"}, nil
	case "detail":
		id := a.str("requestId")
		if id == "" {
			return nil, errStr("请提供 requestId")
		}
		return e.one(ctx, "network", "request", id)
	case "", "list", "verify":
	default:
		return nil, errStr("network cmd 仅支持 start|list|detail|verify|stop")
	}
	args := []string{"network", "requests"}
	if f := a.str("filter"); f != "" {
		args = append(args, "--filter", f)
	}
	if m := a.str("method"); m != "" {
		args = append(args, "--method", strings.ToUpper(m))
	}
	if s, ok := a["status"].(float64); ok {
		args = append(args, "--status", strconv.Itoa(int(s)))
	}
	res, err := e.one(ctx, args...)
	if err != nil {
		return nil, err
	}
	gte, hasGte := a["statusGte"].(float64)
	lt, hasLt := a["statusLt"].(float64)
	raw, _ := res["requests"].([]interface{})
	list := make([]map[string]interface{}, 0, len(raw))
	for _, r := range raw {
		m, ok := r.(map[string]interface{})
		if !ok {
			continue
		}
		status, _ := m["status"].(float64)
		if (hasGte && status < gte) || (hasLt && status >= lt) {
			continue
		}
		list = append(list, map[string]interface{}{
			"requestId": m["requestId"], "method": m["method"], "url": m["url"],
			"status": m["status"], "type": m["resourceType"], "mimeType": m["mimeType"],
		})
	}
	limit := 80
	if cmd == "verify" {
		limit = 10
	}
	if n := int(a.num("limit")); n > 0 {
		limit = n
	}
	if len(list) > limit {
		list = list[len(list)-limit:]
	}
	out := map[string]interface{}{"count": len(list), "capturing": true, "requests": list}
	if cmd != "verify" {
		return out, nil
	}
	// verify：最近一条已有状态码的匹配请求是否 2xx
	out["verified"], out["match"], out["note"] = false, nil, "无匹配请求：检查 filter/method，或先 start 再触发提交"
	for i := len(list) - 1; i >= 0; i-- {
		status, ok := list[i]["status"].(float64)
		if !ok {
			continue
		}
		out["match"] = list[i]
		out["verified"] = status >= 200 && status < 300
		out["note"] = fmt.Sprintf("已命中 %v %d", list[i]["method"], int(status))
		break
	}
	return out, nil
}
