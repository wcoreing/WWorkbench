package environment

import "strings"

// InstallLogHandler 安装过程日志回调；replaceLast 表示本行以 \r 刷新（覆盖上一行）。
type InstallLogHandler func(lang, line string, replaceLast bool)

// SetInstallLogHandler 注册安装日志回调。
func (m *Manager) SetInstallLogHandler(h InstallLogHandler) {
	m.onInstallLog = h
}

// emitInstallLog 输出安装日志行。
func (m *Manager) emitInstallLog(lang, line string, replaceLast bool) {
	if m.onInstallLog == nil || line == "" {
		return
	}
	m.onInstallLog(lang, line, replaceLast)
}

// installEmitter 构造安装过程日志输出函数（普通消息追加；前缀 \r 表示覆盖上一行）。
func (m *Manager) installEmitter(lang string) func(string) {
	return func(line string) {
		replaceLast := false
		if strings.HasPrefix(line, "\r") {
			replaceLast = true
			line = strings.TrimPrefix(line, "\r")
		}
		m.emitInstallLog(lang, line, replaceLast)
	}
}
