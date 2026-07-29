package postgresql

import (
	"fmt"
	"strings"

	"WWorkbench/internal/errno"
	"WWorkbench/internal/model"
)

// buildTableWhere 根据筛选条件生成 WHERE 子句。
func buildTableWhere(filters []model.TableFilterDO, colSet map[string]string) (string, []interface{}, error) {
	var parts []string
	var args []interface{}
	idx := 1
	for _, f := range filters {
		if !f.Enabled || f.Column == "" {
			continue
		}
		colName, ok := resolveColumn(colSet, f.Column)
		if !ok {
			return "", nil, errno.New(errno.CodeInvalidArg, "无效的筛选列", f.Column)
		}
		col := quoteIdent(colName)
		ph := func() string {
			s := fmt.Sprintf("$%d", idx)
			idx++
			return s
		}
		switch f.Operator {
		case "eq":
			p := ph()
			parts = append(parts, col+"="+p)
			args = append(args, f.Value)
		case "neq":
			p := ph()
			parts = append(parts, col+"<>"+p)
			args = append(args, f.Value)
		case "gt":
			p := ph()
			parts = append(parts, col+">"+p)
			args = append(args, f.Value)
		case "gte":
			p := ph()
			parts = append(parts, col+">="+p)
			args = append(args, f.Value)
		case "lt":
			p := ph()
			parts = append(parts, col+"<"+p)
			args = append(args, f.Value)
		case "lte":
			p := ph()
			parts = append(parts, col+"<="+p)
			args = append(args, f.Value)
		case "like":
			p := ph()
			parts = append(parts, col+" LIKE "+p)
			args = append(args, f.Value)
		case "not_like":
			p := ph()
			parts = append(parts, col+" NOT LIKE "+p)
			args = append(args, f.Value)
		case "is_null":
			parts = append(parts, col+" IS NULL")
		case "is_not_null":
			parts = append(parts, col+" IS NOT NULL")
		default:
			return "", nil, errno.New(errno.CodeInvalidArg, "不支持的筛选运算符", f.Operator)
		}
	}
	if len(parts) == 0 {
		return "", nil, nil
	}
	return " WHERE " + strings.Join(parts, " AND "), args, nil
}

// buildTableOrderBy 生成 ORDER BY 子句。
func buildTableOrderBy(sorts []model.TableSortDO, colSet map[string]string) (string, error) {
	var parts []string
	for _, s := range sorts {
		if s.Column == "" {
			continue
		}
		col, ok := resolveColumn(colSet, s.Column)
		if !ok {
			return "", errno.New(errno.CodeInvalidArg, "无效的排序列", s.Column)
		}
		dir := "ASC"
		if !s.Ascending {
			dir = "DESC"
		}
		parts = append(parts, fmt.Sprintf("%s %s", quoteIdent(col), dir))
	}
	if len(parts) == 0 {
		return "", nil
	}
	return " ORDER BY " + strings.Join(parts, ", "), nil
}

func columnSet(columns []model.ColumnMetaDO) map[string]string {
	m := make(map[string]string, len(columns)*2)
	for _, c := range columns {
		m[c.Name] = c.Name
		lower := strings.ToLower(c.Name)
		if _, exists := m[lower]; !exists {
			m[lower] = c.Name
		}
	}
	return m
}

func resolveColumn(colSet map[string]string, name string) (string, bool) {
	if real, ok := colSet[name]; ok {
		return real, true
	}
	if real, ok := colSet[strings.ToLower(name)]; ok {
		return real, true
	}
	return "", false
}
