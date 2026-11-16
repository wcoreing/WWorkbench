package browser

import (
	"context"
	"fmt"
	"runtime"
	"strconv"
	"strings"
	"time"
)

// agent-browser 执行器：交互类动作（点击、填值、按键、下拉、拖拽、上传）。

// ---- 交互 ----

func (e *AgentBrowserExecutor) click(ctx context.Context, a abArgs) (map[string]interface{}, error) {
	t, err := e.target(ctx, a.str("ref"), a.str("selector"), a.str("name"))
	if err != nil {
		return nil, err
	}
	if _, err := e.one(ctx, "click", t); err != nil {
		return nil, err
	}
	out := map[string]interface{}{"clicked": t}
	e.settle(ctx, a, "ax", out)
	return out, nil
}

func (e *AgentBrowserExecutor) fill(ctx context.Context, a abArgs) (map[string]interface{}, error) {
	fields, _ := a["fields"].([]interface{})
	if len(fields) == 0 {
		t, err := e.target(ctx, a.str("ref"), a.str("selector"), a.str("name"))
		if err != nil {
			return nil, err
		}
		_, off, err := e.fillAll(ctx, [][2]string{{t, a.text("value")}})
		if err != nil {
			return nil, err
		}
		out := map[string]interface{}{"filled": t}
		abNoteMismatch(out, off)
		e.settle(ctx, a, "off", out)
		return out, nil
	}
	// 先把所有定位解析完（失败则一项都不动），再执行：连续的 fill 合成一次批量调用，下拉项单独走 selectOption
	type item struct {
		sel  abArgs    // 非空：下拉项
		fill [2]string // 否则：{目标, 值}
	}
	items := make([]item, 0, len(fields))
	for i, raw := range fields {
		m, _ := raw.(map[string]interface{})
		f := abArgs(m)
		t, err := e.target(ctx, f.str("ref"), f.str("selector"), f.str("name"))
		if err != nil {
			return nil, fmt.Errorf("fields[%d]: %w", i, err)
		}
		if act := f.str("action"); act == "select_option" || act == "select" {
			items = append(items, item{sel: abArgs{"selector": t, "value": f.text("value", "option")}})
			continue
		}
		items = append(items, item{fill: [2]string{t, f.text("value", "option")}})
	}
	done := 0
	var pending [][2]string
	var off []string
	flush := func() error {
		if len(pending) == 0 {
			return nil
		}
		n, bad, err := e.fillAll(ctx, pending)
		done += n
		off = append(off, bad...)
		pending = nil
		return err
	}
	for _, it := range items {
		if it.sel == nil {
			pending = append(pending, it.fill)
			continue
		}
		err := flush()
		if err == nil {
			_, err = e.selectOption(ctx, it.sel)
		}
		if err != nil {
			return nil, fmt.Errorf("批填第 %d 项失败（前 %d 项已填）: %w", done+1, done, err)
		}
		done++
	}
	if err := flush(); err != nil {
		return nil, fmt.Errorf("批填第 %d 项失败（前 %d 项已填）: %w", done+1, done, err)
	}
	out := map[string]interface{}{"batch": true, "ok": true, "filled": done}
	abNoteMismatch(out, off)
	e.settle(ctx, a, "off", out)
	return out, nil
}

// fillAll 依次填入（遇错即停），再回读页面上的实际值。
// agent-browser 的 fill 对非输入元素也报成功（实测），不回读就会把没生效的填入记成成功。
// 返回已填项数、回读不一致的目标；err 为首个失败项的原因。回读尽力而为，读不到不下结论。
func (e *AgentBrowserExecutor) fillAll(ctx context.Context, fills [][2]string) (done int, off []string, err error) {
	cmds := make([][]string, 0, len(fills))
	for _, f := range fills {
		cmds = append(cmds, []string{"fill", f[0], f[1]})
	}
	res, err := e.run(ctx, nil, cmds...)
	done = len(res)
	if done == 0 {
		return 0, nil, err
	}
	reads := make([][]string, 0, done*2)
	for _, f := range fills[:done] {
		reads = append(reads, []string{"get", "value", f[0]}, []string{"get", "text", f[0]})
	}
	got, _ := e.run(ctx, nil, reads...)
	for i := 0; i*2+1 < len(got); i++ {
		value, _ := got[i*2]["value"].(string)
		text, _ := got[i*2+1]["text"].(string) // 富文本编辑器（contenteditable）没有 value，看正文
		want := strings.TrimSpace(fills[i][1])
		if strings.TrimSpace(value) == want || (want != "" && strings.Contains(text, want)) {
			continue
		}
		off = append(off, fills[i][0])
	}
	return done, off, err
}

// abNoteMismatch 把回读不一致如实写进结果，由调用方判断（可能点错了元素，也可能是站点做了格式化）。
func abNoteMismatch(out map[string]interface{}, off []string) {
	if len(off) == 0 {
		return
	}
	out["mismatched"] = off
	out["note"] = "已执行，但回读发现这些目标上的值与填入的不一致：目标可能不是输入框，或站点对输入做了格式化；请 browser_snapshot 核对后再继续"
}

var abKeyNames = map[string]string{
	"esc": "Escape", "escape": "Escape", "return": "Enter", "enter": "Enter", "space": "Space",
	"del": "Delete", "delete": "Delete", "backspace": "Backspace", "tab": "Tab",
	"up": "ArrowUp", "down": "ArrowDown", "left": "ArrowLeft", "right": "ArrowRight",
	"arrowup": "ArrowUp", "arrowdown": "ArrowDown", "arrowleft": "ArrowLeft", "arrowright": "ArrowRight",
	"pageup": "PageUp", "pagedown": "PageDown", "home": "Home", "end": "End",
}

// abKey 把工作台按键写法（Mod+A、Cmd+Enter、Esc）转成 agent-browser 的（Meta+a、Meta+Enter、Escape）。
func abKey(raw string) string {
	var parts []string
	for _, p := range strings.Split(raw, "+") {
		if p = strings.TrimSpace(p); p != "" {
			parts = append(parts, p)
		}
	}
	if len(parts) == 0 {
		return strings.TrimSpace(raw) // 「+」键本身
	}
	last := len(parts) - 1
	for i, p := range parts[:last] {
		switch strings.ToLower(p) {
		case "mod":
			parts[i] = "Control"
			if runtime.GOOS == "darwin" {
				parts[i] = "Meta"
			}
		case "meta", "cmd", "command":
			parts[i] = "Meta"
		case "ctrl", "control":
			parts[i] = "Control"
		case "alt", "option":
			parts[i] = "Alt"
		case "shift":
			parts[i] = "Shift"
		}
	}
	if name, ok := abKeyNames[strings.ToLower(parts[last])]; ok {
		parts[last] = name
	} else if last > 0 && len([]rune(parts[last])) == 1 {
		parts[last] = strings.ToLower(parts[last])
	}
	return strings.Join(parts, "+")
}

func (e *AgentBrowserExecutor) keys(ctx context.Context, a abArgs) (map[string]interface{}, error) {
	raw := a.str("keys", "key")
	if raw == "" {
		return nil, errStr("请提供 keys（如 Enter、Escape、Mod+A）")
	}
	key := abKey(raw)
	repeat := int(clampNum(a.num("repeat"), 1, 1, 20))
	var cmds [][]string
	if a.str("ref") != "" || a.str("selector") != "" {
		t, err := e.target(ctx, a.str("ref"), a.str("selector"), "")
		if err != nil {
			return nil, err
		}
		cmds = append(cmds, []string{"focus", t})
	}
	for i := 0; i < repeat; i++ {
		cmds = append(cmds, []string{"press", key})
	}
	if _, err := e.run(ctx, nil, cmds...); err != nil {
		return nil, err
	}
	return map[string]interface{}{"keys": raw, "pressed": key, "repeat": repeat}, nil
}

var abOptionRoles = map[string]bool{
	"option": true, "menuitem": true, "menuitemradio": true, "menuitemcheckbox": true, "treeitem": true, "listitem": true,
}

// selectOption 原生 <select> 直接选；自绘下拉（Ant Design / Element 等）点开触发器后再点同名选项。
func (e *AgentBrowserExecutor) selectOption(ctx context.Context, a abArgs) (map[string]interface{}, error) {
	val := a.text("value", "option")
	if val == "" {
		return nil, errStr("请提供 value/option（选项文案）")
	}
	t, err := e.target(ctx, a.str("ref"), a.str("selector"), "")
	if err != nil {
		return nil, err
	}
	// agent-browser 的 select 对非 <select> 元素也报成功但不生效（实测），必须先判定。
	// get html 返回的是内部 HTML：原生下拉以 <option>/<optgroup> 开头，包着它的外层容器则以 <select 开头。
	res, err := e.one(ctx, "get", "html", t)
	if err != nil {
		return nil, err
	}
	html, _ := res["html"].(string)
	html = strings.ToLower(strings.TrimSpace(html))
	if strings.HasPrefix(html, "<option") || strings.HasPrefix(html, "<optgroup") {
		if _, err := e.one(ctx, "select", t, val); err != nil {
			return nil, err
		}
		return map[string]interface{}{"selected": val, "mode": "native"}, nil
	}
	if _, err := e.one(ctx, "click", t); err != nil {
		return nil, err
	}
	for i := 0; i < 5; i++ {
		if _, _, refs, err := e.snapshotRaw(ctx); err == nil {
			for _, m := range abMatchRefs(refs, val) {
				if m.Ref == t || !abOptionRoles[m.Role] {
					continue
				}
				if _, err := e.one(ctx, "click", m.Ref); err != nil {
					if strings.Contains(err.Error(), "box model") { // 原生 <option> 没有布局盒，点不了
						return nil, errStr("选项「" + val + "」属于原生下拉，请把 ref/selector 指向 <select> 本身（快照里 role=combobox 的那个）")
					}
					return nil, err
				}
				return map[string]interface{}{"selected": val, "mode": "listbox", "ref": m.Ref}, nil
			}
		}
		if !abSleep(ctx, 150*time.Millisecond) {
			break
		}
	}
	return nil, errStr("下拉里未找到选项「" + val + "」（触发器已点开，可 browser_snapshot 查看可选项）")
}

func (e *AgentBrowserExecutor) drag(ctx context.Context, a abArgs) (map[string]interface{}, error) {
	from, to := abRef(a.str("fromRef")), abRef(a.str("toRef"))
	if from == "" {
		from = a.str("fromSelector")
	}
	if to == "" {
		to = a.str("toSelector")
	}
	if from != "" && to != "" {
		if _, err := e.one(ctx, "drag", from, to); err != nil {
			return nil, err
		}
		return map[string]interface{}{"dragged": true, "from": from, "to": to}, nil
	}
	fx, fy, tx, ty := a.num("fromX"), a.num("fromY"), a.num("toX"), a.num("toY")
	if fx == 0 && fy == 0 && tx == 0 && ty == 0 {
		return nil, errStr("请成对提供 fromRef/toRef、fromSelector/toSelector，或坐标 fromX/fromY/toX/toY")
	}
	steps := int(clampNum(a.num("steps"), 8, 1, 30))
	px := func(v float64) string { return strconv.FormatFloat(v, 'f', 0, 64) }
	cmds := [][]string{{"mouse", "move", px(fx), px(fy)}, {"mouse", "down"}}
	for i := 1; i <= steps; i++ {
		k := float64(i) / float64(steps)
		cmds = append(cmds, []string{"mouse", "move", px(fx + (tx-fx)*k), px(fy + (ty-fy)*k)})
	}
	if _, err := e.run(ctx, nil, append(cmds, []string{"mouse", "up"})...); err != nil {
		return nil, err
	}
	return map[string]interface{}{"dragged": true, "mode": "pointer", "steps": steps}, nil
}

const abFileInput = "input[type=file]"

func (e *AgentBrowserExecutor) upload(ctx context.Context, a abArgs) (map[string]interface{}, error) {
	raw, _ := a["files"].([]interface{})
	var files []string
	for _, f := range raw {
		if s, ok := f.(string); ok && strings.TrimSpace(s) != "" {
			files = append(files, strings.TrimSpace(s))
		}
	}
	if len(files) == 0 {
		return nil, errStr("请提供 files（本机绝对路径数组）")
	}
	t := abFileInput
	if a.str("ref") != "" || a.str("selector") != "" {
		var err error
		if t, err = e.target(ctx, a.str("ref"), a.str("selector"), ""); err != nil {
			return nil, err
		}
	}
	_, err := e.one(ctx, append([]string{"upload", t}, files...)...)
	// 指到的是自绘上传按钮而非 <input type=file>：退回页面里的文件输入框
	if err != nil && t != abFileInput && strings.Contains(err.Error(), "not a file input") {
		t = abFileInput
		_, err = e.one(ctx, append([]string{"upload", t}, files...)...)
	}
	if err != nil {
		return nil, err
	}
	return map[string]interface{}{"files": files, "fileCount": len(files), "target": t}, nil
}
