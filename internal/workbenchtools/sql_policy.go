package workbenchtools

import "strings"

// SQLKind SQL 风险分类。
type SQLKind int

const (
	SQLReadonly SQLKind = iota
	SQLWrite
	SQLBlocked
)

// ClassifySQL 对 SQL 做只读/写入/禁止分类。
func ClassifySQL(sql string) SQLKind {
	upper := strings.ToUpper(strings.TrimSpace(sql))
	if upper == "" {
		return SQLBlocked
	}
	for _, p := range []string{"DROP DATABASE", "DROP SCHEMA"} {
		if strings.Contains(upper, p) {
			return SQLBlocked
		}
	}
	for _, p := range []string{
		"INSERT", "UPDATE", "DELETE", "CREATE", "ALTER", "DROP", "TRUNCATE",
		"REPLACE", "RENAME", "GRANT", "REVOKE", "CALL",
	} {
		if strings.HasPrefix(upper, p) {
			return SQLWrite
		}
	}
	for _, p := range []string{"SELECT", "SHOW", "DESC", "DESCRIBE", "EXPLAIN", "WITH", "USE"} {
		if strings.HasPrefix(upper, p) {
			return SQLReadonly
		}
	}
	return SQLReadonly
}
