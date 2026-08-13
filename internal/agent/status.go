package agent

// 工具/任务状态（UI 与事件 payload）。
const (
	StatusOK             = "ok"
	StatusError          = "error"
	StatusDenied         = "denied"
	StatusNeedConfirm    = "need_confirm"
	StatusWaitingConfirm = "waiting_confirm"
	StatusStopped        = "stopped"
)
