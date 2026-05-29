package data

import (
	"context"

	"WNavicat/internal/errno"
	"WNavicat/internal/model"
	"WNavicat/internal/session"
)

// Service 表数据服务。
type Service struct {
	sessions *session.Manager
}

// NewService 创建表数据服务。
func NewService(sessions *session.Manager) *Service {
	return &Service{sessions: sessions}
}

// GetTableDataPage 分页获取表数据（含筛选排序）。
func (s *Service) GetTableDataPage(ctx context.Context, sessionID, database, table string, q model.TableDataQueryDO) (*model.TableDataPageDO, error) {
	if database == "" || table == "" {
		return nil, errno.New(errno.CodeInvalidArg, "数据库和表名不能为空", "")
	}
	sess, err := s.sessions.Get(sessionID)
	if err != nil {
		return nil, err
	}
	ad, err := s.sessions.Adapter(sess)
	if err != nil {
		return nil, err
	}
	return ad.QueryTablePage(ctx, sess.DB, database, table, q)
}

// ApplyTableMutations 提交表数据变更。
func (s *Service) ApplyTableMutations(ctx context.Context, sessionID, database, table string, batch model.RowMutationBatchDO) error {
	if database == "" || table == "" {
		return errno.New(errno.CodeInvalidArg, "数据库和表名不能为空", "")
	}
	sess, err := s.sessions.Get(sessionID)
	if err != nil {
		return err
	}
	ad, err := s.sessions.Adapter(sess)
	if err != nil {
		return err
	}
	return ad.ApplyMutations(ctx, sess.DB, database, table, batch)
}

// ExportTableInsertSQL 导出表数据为 INSERT 语句。
func (s *Service) ExportTableInsertSQL(ctx context.Context, sessionID, database, table string, maxRows int) (string, error) {
	if database == "" || table == "" {
		return "", errno.New(errno.CodeInvalidArg, "数据库和表名不能为空", "")
	}
	if maxRows <= 0 || maxRows > 10000 {
		maxRows = 1000
	}
	sess, err := s.sessions.Get(sessionID)
	if err != nil {
		return "", err
	}
	ad, err := s.sessions.Adapter(sess)
	if err != nil {
		return "", err
	}
	return ad.ExportTableInsertSQL(ctx, sess.DB, database, table, maxRows)
}
