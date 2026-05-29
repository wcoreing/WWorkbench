package query

import (
	"context"
	"strings"
	"time"

	"WNavicat/internal/adapter"
	"WNavicat/internal/errno"
	"WNavicat/internal/model"
	"WNavicat/internal/session"
	"WNavicat/internal/store"

	"github.com/google/uuid"
)

const defaultQueryPageSize = 200

// Service 查询服务。
type Service struct {
	sessions *session.Manager
	store    *store.Store
}

// NewService 创建查询服务。
func NewService(sessions *session.Manager, st *store.Store) *Service {
	return &Service{sessions: sessions, store: st}
}

// ExecuteSQL 执行 SQL（自动区分查询与更新，支持多语句）。
func (s *Service) ExecuteSQL(ctx context.Context, sessionID, database, sqlText string) (interface{}, error) {
	sqlText = strings.TrimSpace(sqlText)
	if sqlText == "" {
		return nil, errno.New(errno.CodeInvalidArg, "SQL 不能为空", "")
	}
	sess, err := s.sessions.Get(sessionID)
	if err != nil {
		return nil, err
	}
	ad, err := s.sessions.Adapter(sess)
	if err != nil {
		return nil, err
	}
	stmts := splitStatements(sqlText)
	if len(stmts) == 0 {
		return nil, errno.New(errno.CodeInvalidArg, "SQL 不能为空", "")
	}
	start := time.Now()
	if len(stmts) == 1 {
		res, err := s.executeOne(ctx, ad, sess, database, stmts[0])
		s.recordHistory(sess.ConnectionID, database, sqlText, time.Since(start).Milliseconds(), err == nil)
		return res, err
	}
	batch := model.SQLBatchResultDO{Items: []model.SQLBatchItemDO{}}
	allOK := true
	for _, stmt := range stmts {
		item := model.SQLBatchItemDO{SQL: stmt}
		res, err := s.executeOne(ctx, ad, sess, database, stmt)
		if err != nil {
			item.Error = err.Error()
			allOK = false
		} else {
			switch v := res.(type) {
			case *model.QueryPageDO:
				item.Query = v
			case *model.ExecuteResultDO:
				item.Execute = v
			}
		}
		batch.Items = append(batch.Items, item)
	}
	s.recordHistory(sess.ConnectionID, database, sqlText, time.Since(start).Milliseconds(), allOK)
	return batch, nil
}

// executeOne 执行单条 SQL。
func (s *Service) executeOne(ctx context.Context, ad adapter.DatabaseAdapter, sess *session.Session, database, sqlText string) (interface{}, error) {
	if isQuery(sqlText) {
		page, err := ad.QueryPage(ctx, sess.DB, database, sqlText, 1, defaultQueryPageSize)
		if err != nil {
			return nil, err
		}
		return page, nil
	}
	return ad.Execute(ctx, sess.DB, database, sqlText)
}

// QuerySQLPage 分页查询。
func (s *Service) QuerySQLPage(ctx context.Context, sessionID, database, sqlText string, page, pageSize int) (*model.QueryPageDO, error) {
	sess, err := s.sessions.Get(sessionID)
	if err != nil {
		return nil, err
	}
	ad, err := s.sessions.Adapter(sess)
	if err != nil {
		return nil, err
	}
	return ad.QueryPage(ctx, sess.DB, database, sqlText, page, pageSize)
}

// recordHistory 记录查询历史。
func (s *Service) recordHistory(connectionID, database, sqlText string, elapsed int64, success bool) {
	_ = s.store.AddQueryHistory(model.QueryHistoryDO{
		ID:           uuid.NewString(),
		ConnectionID: connectionID,
		Database:     database,
		SQL:          sqlText,
		ExecutedAt:   time.Now().Unix(),
		ElapsedMs:    elapsed,
		Success:      success,
	})
}

// ListHistory 查询历史列表。
func (s *Service) ListHistory(connectionID string, limit int) ([]model.QueryHistoryDO, error) {
	return s.store.ListQueryHistory(connectionID, limit)
}

func isQuery(sql string) bool {
	upper := strings.ToUpper(strings.TrimSpace(sql))
	prefixes := []string{"SELECT", "SHOW", "DESC", "DESCRIBE", "EXPLAIN", "WITH"}
	for _, p := range prefixes {
		if strings.HasPrefix(upper, p) {
			return true
		}
	}
	return false
}
