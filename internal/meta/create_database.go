package meta

import (
	"context"
	"fmt"
	"regexp"
	"strings"

	"WNavicat/internal/errno"
)

var dbNameRe = regexp.MustCompile(`^[a-zA-Z0-9_]+$`)
var charsetRe = regexp.MustCompile(`^[a-zA-Z0-9_]+$`)

// CreateDatabase 创建数据库。
func (s *Service) CreateDatabase(ctx context.Context, sessionID, name, charset, collation string) error {
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
		return errno.New(errno.CodeInvalidArg, "Redis 不支持创建数据库", name)
	}
	ad, err := s.sessions.Adapter(sess)
	if err != nil {
		return err
	}
	sqlText, err := buildCreateDatabaseSQL(sess.DbType, name, charset, collation)
	if err != nil {
		return err
	}
	if _, err := ad.Execute(ctx, sess.DB, "", sqlText); err != nil {
		return err
	}
	return nil
}

// buildCreateDatabaseSQL 生成建库语句。
func buildCreateDatabaseSQL(dbType, name, charset, collation string) (string, error) {
	switch dbType {
	case "mysql":
		if charset == "" {
			charset = "utf8mb4"
		}
		if collation == "" {
			collation = "utf8mb4_unicode_ci"
		}
		if !charsetRe.MatchString(charset) || !charsetRe.MatchString(collation) {
			return "", errno.New(errno.CodeInvalidArg, "字符集或排序规则无效", charset)
		}
		return fmt.Sprintf(
			"CREATE DATABASE `%s` CHARACTER SET %s COLLATE %s",
			strings.ReplaceAll(name, "`", "``"),
			charset,
			collation,
		), nil
	case "postgresql":
		return fmt.Sprintf(`CREATE DATABASE "%s"`, strings.ReplaceAll(name, `"`, `""`)), nil
	default:
		return fmt.Sprintf("CREATE DATABASE `%s`", strings.ReplaceAll(name, "`", "``")), nil
	}
}
