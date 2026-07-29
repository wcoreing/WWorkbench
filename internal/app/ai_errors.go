package app

import "WWorkbench/internal/errno"

func errAgentNotReady() error {
	return errno.New(errno.CodeUnknown, "AI 助手未就绪", "")
}
