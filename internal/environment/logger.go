package environment

// InstallLogHandler 安装过程日志回调。
type InstallLogHandler func(lang, line string)

// SetInstallLogHandler 注册安装日志回调。
func (m *Manager) SetInstallLogHandler(h InstallLogHandler) {
	m.onInstallLog = h
}

// emitInstallLog 输出安装日志行。
func (m *Manager) emitInstallLog(lang, line string) {
	if m.onInstallLog == nil || line == "" {
		return
	}
	m.onInstallLog(lang, line)
}

// installEmitter 构造安装过程日志输出函数。
func (m *Manager) installEmitter(lang string) func(string) {
	return func(line string) {
		m.emitInstallLog(lang, line)
	}
}
