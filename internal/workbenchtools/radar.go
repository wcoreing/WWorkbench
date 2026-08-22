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
	if ev.Domain == "" || len(ev.IDs) == 0 {
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

// EmitAsset 通用单 ID 资产广播。
func (b *RadarBus) EmitAsset(domain, product, op, id, writeID, label string, reveal bool) {
	if id == "" {
		return
	}
	b.Emit(workbench.RadarEvent{
		Domain: domain, Op: op, IDs: []string{id},
		WriteID: writeID, Reveal: reveal, Product: product, Label: label,
	})
}

// EmitHTTPRequest 快捷广播 HTTP 请求资产变更。
func (b *RadarBus) EmitHTTPRequest(op, id, writeID, label string, reveal bool) {
	b.EmitAsset(workbench.RadarDomainHTTPRequest, "httpapi", op, id, writeID, label, reveal)
}

// EmitHTTPEnv 快捷广播 HTTP 环境预设变更。
func (b *RadarBus) EmitHTTPEnv(op, id, writeID, label string, reveal bool) {
	b.EmitAsset(workbench.RadarDomainHTTPEnv, "httpapi", op, id, writeID, label, reveal)
}

// EmitHTTPFolder 快捷广播 HTTP 目录变更。
func (b *RadarBus) EmitHTTPFolder(op, id, writeID, label string, reveal bool) {
	b.EmitAsset(workbench.RadarDomainHTTPFolder, "httpapi", op, id, writeID, label, reveal)
}

// EmitNotebookNote 快捷广播笔记本资产变更。
func (b *RadarBus) EmitNotebookNote(op, id, writeID, label string, reveal bool) {
	b.EmitAsset(workbench.RadarDomainNotebookNote, "notebook", op, id, writeID, label, reveal)
}

// EmitNotebookGroup 快捷广播笔记本分组变更。
func (b *RadarBus) EmitNotebookGroup(op, id, writeID, label string, reveal bool) {
	b.EmitAsset(workbench.RadarDomainNotebookGroup, "notebook", op, id, writeID, label, reveal)
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

// EmitDockerContext 快捷广播 Docker 上下文变更。
func (b *RadarBus) EmitDockerContext(op, id, writeID, label string, reveal bool) {
	b.EmitAsset(workbench.RadarDomainDockerContext, "docker", op, id, writeID, label, reveal)
}

// EmitSSHHost 快捷广播 SSH 主机变更（终端 / SFTP 共用）。
func (b *RadarBus) EmitSSHHost(op, id, writeID, label string, reveal bool) {
	b.EmitAsset(workbench.RadarDomainSSHHost, "terminal", op, id, writeID, label, reveal)
}

// EmitConnection 快捷广播数据库连接变更。
func (b *RadarBus) EmitConnection(op, id, writeID, label string, reveal bool) {
	b.EmitAsset(workbench.RadarDomainConnection, "database", op, id, writeID, label, reveal)
}

// EmitLogSource 快捷广播日志源变更。
func (b *RadarBus) EmitLogSource(op, id, writeID, label string, reveal bool) {
	b.EmitAsset(workbench.RadarDomainLogSource, "logs", op, id, writeID, label, reveal)
}

// EmitEnvPreset 快捷广播环境预设变更。
func (b *RadarBus) EmitEnvPreset(op, id, writeID, label string, reveal bool) {
	b.EmitAsset(workbench.RadarDomainEnvPreset, "environment", op, id, writeID, label, reveal)
}

// EmitSFTPBookmark 快捷广播 SFTP 书签变更。
func (b *RadarBus) EmitSFTPBookmark(op, id, writeID, label string, reveal bool) {
	b.EmitAsset(workbench.RadarDomainSFTPBookmark, "sftp", op, id, writeID, label, reveal)
}

// EmitSSHForward 快捷广播 SSH 端口转发预设变更。
func (b *RadarBus) EmitSSHForward(op, id, writeID, label string, reveal bool) {
	b.EmitAsset(workbench.RadarDomainSSHForward, "terminal", op, id, writeID, label, reveal)
}

// EmitAgentSkill 快捷广播 Agent 技能变更。
func (b *RadarBus) EmitAgentSkill(op, id, writeID, label string, reveal bool) {
	b.EmitAsset(workbench.RadarDomainAgentSkill, "skills", op, id, writeID, label, reveal)
}
