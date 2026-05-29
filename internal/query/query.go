package query

import (
	"context"
	"strings"
	"time"

	"WNavicat/internal/errno"
	"WNavicat/internal/model"
	"WNavicat/internal/session"
	"WNavicat/internal/store"

	"github.com/google/uuid"
)

// Service 查询服务。
type Service struct {
	sessions *session.Manager
	store    *store.Store
}

// NewService 创建查询服务。
func NewService(sessions *session.Manager, st *store.Store) *Service {
	return &Service{sessions: sessions, store: st}
}

// ExecuteSQL 执行 SQL（自动区分查询与更新）。
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
	start := time.Now()
	var result interface{}
	var success bool
	if isQuery(sqlText) {
		page, err := ad.QueryPage(ctx, sess.DB, database, sqlText, 1, 500)
		if err != nil {
			s.recordHistory(sess.ConnectionID, database, sqlText, time.Since(start).Milliseconds(), false)
			return nil, err
		}
		result = page
		success = true
	} else {
		execRes, err := ad.Execute(ctx, sess.DB, database, sqlText)
		if err != nil {
			s.recordHistory(sess.ConnectionID, database, sqlText, time.Since(start).Milliseconds(), false)
			return nil, err
		}
		result = execRes
		success = true
	}
	s.recordHistory(sess.ConnectionID, database, sqlText, time.Since(start).Milliseconds(), success)
	return result, nil
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
