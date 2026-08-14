package turnctx

import "WWorkbench/internal/model"

// ApplySnapshot 把界面快照字段写入工具参数 map（空可选字段不写）。
func ApplySnapshot(dst map[string]interface{}, snap model.AgentContextDO) {
	if dst == nil {
		return
	}
	dst["activeProduct"] = snap.ActiveProduct
	dst["sessionId"] = snap.SessionID
	dst["connectionId"] = snap.ConnectionID
	dst["database"] = snap.Database
	setIf := func(k, v string) {
		if v != "" {
			dst[k] = v
		}
	}
	setIf("table", snap.Table)
	setIf("focusKind", snap.FocusKind)
	setIf("focusLabel", snap.FocusLabel)
	setIf("tabTitle", snap.TabTitle)
	setIf("openTabsBrief", snap.OpenTabsBrief)
	setIf("selectionBrief", snap.SelectionBrief)
	if len(snap.Mentions) > 0 {
		dst["mentions"] = snap.Mentions
	}
}
