package meta

import (
	"context"
	"fmt"
	"strings"

	"WWorkbench/internal/errno"
)

// DropDatabase 删除数据库（禁止系统库；SQLite/Redis 不支持）。
func (s *Service) DropDatabase(ctx context.Context, sessionID, name string) error {
	name = strings.TrimSpace(name)
	if name == "" {
		return errno.New(errno.CodeInvalidArg, "数据库名不能为空", "")
	}
	if !dbNameRe.MatchString(name) {
		return errno.New(errno.CodeInvalidArg, "数据库名仅允许字母、数字、下划线", name)
	}
	sess, err := s.sessions.Get(sessionID)
	if err != nil {
		return err
	}
	if sess.DbType == "redis" {
		return errno.New(errno.CodeInvalidArg, "Redis 不支持删除数据库", name)
	}
	if sess.DbType == "sqlite" {
		return errno.New(errno.CodeInvalidArg, "SQLite 不支持删除数据库，请删除文件", name)
	}
	if isProtectedDatabase(sess.DbType, name) {
		return errno.New(errno.CodeInvalidArg, "禁止删除系统库", name)
	}

	// PostgreSQL 不能删除当前连接所在库，先切到 postgres。
	if sess.DbType == "postgresql" && strings.EqualFold(strings.TrimSpace(sess.Database), name) {
		if _, err := s.sessions.SwitchDatabase(ctx, sessionID, "postgres"); err != nil {
			return errno.Wrap(errno.CodeSQLFailed, "删除前无法切换到 postgres", err)
		}
		sess, err = s.sessions.Get(sessionID)
		if err != nil {
			return err
		}
	}

	ad, err := s.sessions.Adapter(sess)
	if err != nil {
		return err
	}
	sqlText, err := buildDropDatabaseSQL(sess.DbType, name)
	if err != nil {
		return err
	}
	if _, err := ad.Execute(ctx, sess.DB, "", sqlText); err != nil {
		return err
	}

	// MySQL：会话仍指向已删库时清空当前库标记。
	if sess.DbType != "postgresql" && strings.EqualFold(strings.TrimSpace(sess.Database), name) {
		_ = s.sessions.ClearDatabase(sessionID)
	}
	return nil
}

func buildDropDatabaseSQL(dbType, name string) (string, error) {
	switch dbType {
	case "postgresql":
		return fmt.Sprintf(`DROP DATABASE "%s"`, strings.ReplaceAll(name, `"`, `""`)), nil
	case "mysql":
		return fmt.Sprintf("DROP DATABASE `%s`", strings.ReplaceAll(name, "`", "``")), nil
	default:
		return fmt.Sprintf("DROP DATABASE `%s`", strings.ReplaceAll(name, "`", "``")), nil
	}
}

func isProtectedDatabase(dbType, name string) bool {
	n := strings.ToLower(strings.TrimSpace(name))
	switch dbType {
	case "postgresql":
		switch n {
		case "postgres", "template0", "template1":
			return true
		}
	default: // mysql 及兼容
		switch n {
		case "mysql", "information_schema", "performance_schema", "sys":
			return true
		}
	}
	return false
}
