package workbenchtools

import "WWorkbench/internal/workbench"

// RadarBus 向前端投递资产变更（workbench-changed）。
type RadarBus struct {
	emit func(event string, payload map[string]interface{})
}

// NewRadarBus 创建资产雷达总线。
func NewRadarBus(emit func(event string, payload map[string]interface{})) *RadarBus {
	return &RadarBus{emit: emit}
}

// Emit 广播资产变更。
func (b *RadarBus) Emit(ev workbench.RadarEvent) {
	if b == nil || b.emit == nil {
		return
	}
	if len(ev.IDs) == 0 && ev.Domain == "" {
		return
	}
	payload := map[string]interface{}{
		"domain":  ev.Domain,
		"op":      ev.Op,
		"ids":     ev.IDs,
		"writeId": ev.WriteID,
		"reveal":  ev.Reveal,
	}
	if ev.Product != "" {
		payload["product"] = ev.Product
	}
	if ev.Label != "" {
		payload["label"] = ev.Label
	}
	b.emit(workbench.RadarEventName, payload)
}

// EmitHTTPRequest 快捷广播 HTTP 请求资产变更。
func (b *RadarBus) EmitHTTPRequest(op, id, writeID, label string, reveal bool) {
	if id == "" {
		return
	}
	b.Emit(workbench.RadarEvent{
		Domain:  workbench.RadarDomainHTTPRequest,
		Op:      op,
		IDs:     []string{id},
		WriteID: writeID,
		Reveal:  reveal,
		Product: "httpapi",
		Label:   label,
	})
}

// EmitNotebookNote 快捷广播笔记本资产变更。
func (b *RadarBus) EmitNotebookNote(op, id, writeID, label string, reveal bool) {
	if id == "" {
		return
	}
	b.Emit(workbench.RadarEvent{
		Domain:  workbench.RadarDomainNotebookNote,
		Op:      op,
		IDs:     []string{id},
		WriteID: writeID,
		Reveal:  reveal,
		Product: "notebook",
		Label:   label,
	})
}

// EmitDockerContainer 快捷广播 Docker 容器状态变更。
func (b *RadarBus) EmitDockerContainer(op, contextID, containerID, writeID, label string, reveal bool) {
	if containerID == "" {
		return
	}
	ids := []string{containerID}
	if contextID != "" {
		ids = []string{contextID, containerID}
	}
	b.Emit(workbench.RadarEvent{
		Domain:  workbench.RadarDomainDockerContainer,
		Op:      op,
		IDs:     ids,
		WriteID: writeID,
		Reveal:  reveal,
		Product: "docker",
		Label:   label,
	})
}
