package postgresql

import (
	"fmt"
	"strings"

	"WNavicat/internal/errno"
	"WNavicat/internal/model"
)

// buildTableWhere 根据筛选条件生成 WHERE 子句。
func buildTableWhere(filters []model.TableFilterDO, colSet map[string]bool) (string, []interface{}, error) {
	var parts []string
	var args []interface{}
	idx := 1
	for _, f := range filters {
		if !f.Enabled || f.Column == "" {
			continue
		}
		if !colSet[f.Column] {
			return "", nil, errno.New(errno.CodeInvalidArg, "无效的筛选列", f.Column)
		}
		col := quoteIdent(f.Column)
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
func buildTableOrderBy(sorts []model.TableSortDO, colSet map[string]bool) (string, error) {
	var parts []string
	for _, s := range sorts {
		if s.Column == "" {
			continue
		}
		if !colSet[s.Column] {
			return "", errno.New(errno.CodeInvalidArg, "无效的排序列", s.Column)
		}
		dir := "ASC"
		if !s.Ascending {
			dir = "DESC"
		}
		parts = append(parts, fmt.Sprintf("%s %s", quoteIdent(s.Column), dir))
	}
	if len(parts) == 0 {
		return "", nil
	}
	return " ORDER BY " + strings.Join(parts, ", "), nil
}

func columnSet(columns []model.ColumnMetaDO) map[string]bool {
	m := make(map[string]bool, len(columns))
	for _, c := range columns {
		m[c.Name] = true
	}
	return m
}
