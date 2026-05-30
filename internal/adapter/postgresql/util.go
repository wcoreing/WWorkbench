package postgresql

import (
	"database/sql"
	"fmt"
	"strings"
	"time"

	"WNavicat/internal/model"
)

const schemaPublic = "public"

// quoteIdent PostgreSQL 标识符引号。
func quoteIdent(s string) string {
	return `"` + strings.ReplaceAll(s, `"`, `""`) + `"`
}

// parseTableRef 解析 schema.table 或单表名（默认 public）。
func parseTableRef(table string) (schema, name string) {
	table = strings.TrimSpace(table)
	if i := strings.Index(table, "."); i >= 0 {
		return table[:i], table[i+1:]
	}
	return schemaPublic, table
}

// qualTable 返回 schema 限定的表名。
func qualTable(table string) string {
	schema, name := parseTableRef(table)
	return quoteIdent(schema) + "." + quoteIdent(name)
}

func splitAddr(addr string, defaultPort int) (string, int) {
	if strings.Contains(addr, ":") {
		parts := strings.Split(addr, ":")
		host := parts[0]
		port := defaultPort
		if len(parts) > 1 {
			fmt.Sscanf(parts[1], "%d", &port)
		}
		return host, port
	}
	return addr, defaultPort
}

func defaultPort(port int) int {
	if port <= 0 {
		return 5432
	}
	return port
}

func scanRow(rows *sql.Rows, n int) ([]model.CellValueDO, error) {
	vals := make([]interface{}, n)
	ptrs := make([]interface{}, n)
	for i := range vals {
		ptrs[i] = &vals[i]
	}
	if err := rows.Scan(ptrs...); err != nil {
		return nil, err
	}
	out := make([]model.CellValueDO, n)
	for i, v := range vals {
		out[i] = toCell(v)
	}
	return out, nil
}

func toCell(v interface{}) model.CellValueDO {
	if v == nil {
		return model.CellValueDO{IsNull: true, Display: "NULL"}
	}
	switch x := v.(type) {
	case []byte:
		s := string(x)
		return model.CellValueDO{Value: &s, Display: s}
	case time.Time:
		s := x.Format("2006-01-02 15:04:05")
		return model.CellValueDO{Value: &s, Display: s}
	default:
		s := fmt.Sprint(x)
		return model.CellValueDO{Value: &s, Display: s}
	}
}

func quoteSQLString(s string) string {
	return "'" + strings.ReplaceAll(s, "'", "''") + "'"
}

func trimSQLSemicolon(sql string) string {
	return strings.TrimSuffix(strings.TrimSpace(sql), ";")
}

func canWrapAsSubquery(sql string) bool {
	upper := strings.ToUpper(strings.TrimSpace(sql))
	for _, p := range []string{"SHOW ", "DESC ", "DESCRIBE ", "EXPLAIN ", "\\"} {
		if strings.HasPrefix(upper, p) {
			return false
		}
	}
	return true
}
