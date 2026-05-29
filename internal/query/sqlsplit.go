package query

import "strings"

// splitStatements 按分号拆分 SQL，忽略引号与反引号内的分号。
func splitStatements(sql string) []string {
	var parts []string
	var current strings.Builder
	inSingle, inDouble, inBacktick := false, false, false
	escaped := false
	for _, r := range sql {
		if escaped {
			current.WriteRune(r)
			escaped = false
			continue
		}
		if r == '\\' && inSingle {
			current.WriteRune(r)
			escaped = true
			continue
		}
		switch {
		case r == '\'' && !inDouble && !inBacktick:
			inSingle = !inSingle
		case r == '"' && !inSingle && !inBacktick:
			inDouble = !inDouble
		case r == '`' && !inSingle && !inDouble:
			inBacktick = !inBacktick
		case r == ';' && !inSingle && !inDouble && !inBacktick:
			if s := strings.TrimSpace(current.String()); s != "" {
				parts = append(parts, s)
			}
			current.Reset()
			continue
		}
		current.WriteRune(r)
	}
	if s := strings.TrimSpace(current.String()); s != "" {
		parts = append(parts, s)
	}
	return parts
}
