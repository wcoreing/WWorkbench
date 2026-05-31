package agent

// ToolRisk 工具风险级别。
func ToolRisk(name string) string {
	switch name {
	case "execute_sql":
		return "write"
	case "open_database_session", "close_database_session":
		return "session"
	default:
		return "read"
	}
}
