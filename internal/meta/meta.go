package meta

import (
	"context"

	redisadapter "WNavicat/internal/adapter/redis"
	"WNavicat/internal/errno"
	"WNavicat/internal/model"
	"WNavicat/internal/session"
)

// Service 元数据服务。
type Service struct {
	sessions *session.Manager
}

// NewService 创建元数据服务。
func NewService(sessions *session.Manager) *Service {
	return &Service{sessions: sessions}
}

// GetObjectTree 获取对象树（库与表，列懒加载由前端按需请求）。
func (s *Service) GetObjectTree(ctx context.Context, sessionID string) ([]model.ObjectTreeNodeDO, error) {
	sess, err := s.sessions.Get(sessionID)
	if err != nil {
		return nil, err
	}
	if sess.DbType == "redis" {
		return redisObjectTree(ctx, sess)
	}
	ad, err := s.sessions.Adapter(sess)
	if err != nil {
		return nil, err
	}
	dbs, err := ad.ListDatabases(ctx, sess.DB)
	if err != nil {
		return nil, err
	}
	var nodes []model.ObjectTreeNodeDO
	for _, db := range dbs {
		dbNode := model.ObjectTreeNodeDO{
			ID:       sessionID + ":db:" + db,
			Label:    db,
			NodeType: "database",
			Database: db,
			Lazy:     true,
		}
		tables, err := ad.ListTables(ctx, sess.DB, db)
		if err != nil {
			return nil, err
		}
		for _, tbl := range tables {
			dbNode.Children = append(dbNode.Children, model.ObjectTreeNodeDO{
				ID:       sessionID + ":tbl:" + db + "." + tbl.Name,
				Label:    tbl.Name,
				NodeType: "table",
				Database: db,
				Table:    tbl.Name,
				Lazy:     true,
			})
		}
		views, err := ad.ListViews(ctx, sess.DB, db)
		if err != nil {
			return nil, err
		}
		for _, v := range views {
			dbNode.Children = append(dbNode.Children, model.ObjectTreeNodeDO{
				ID:       sessionID + ":view:" + db + "." + v.Name,
				Label:    v.Name,
				NodeType: "view",
				Database: db,
				Table:    v.Name,
				Lazy:     true,
			})
		}
		dbNode.Lazy = false
		nodes = append(nodes, dbNode)
	}
	return nodes, nil
}

// redisObjectTree 构建 Redis 键对象树。
func redisObjectTree(ctx context.Context, sess *session.Session) ([]model.ObjectTreeNodeDO, error) {
	dbLabel := "DB " + sess.Database
	if sess.Database == "" {
		dbLabel = "DB 0"
	}
	keys, err := redisadapter.ScanKeys(ctx, sess.Redis, "*", 500)
	if err != nil {
		return nil, err
	}
	dbNode := model.ObjectTreeNodeDO{
		ID: sess.ID + ":db:" + sess.Database, Label: dbLabel, NodeType: "database", Database: sess.Database,
	}
	for _, key := range keys {
		dbNode.Children = append(dbNode.Children, model.ObjectTreeNodeDO{
			ID: sess.ID + ":key:" + key, Label: key, NodeType: "table", Database: sess.Database, Table: key,
		})
	}
	return []model.ObjectTreeNodeDO{dbNode}, nil
}

// ListColumns 列出表列。
func (s *Service) ListColumns(ctx context.Context, sessionID, database, table string) ([]model.ColumnMetaDO, error) {
	sess, err := s.sessions.Get(sessionID)
	if err != nil {
		return nil, err
	}
	if sess.DbType == "redis" {
		return []model.ColumnMetaDO{
			{Name: "field", DataType: "text", ColumnType: "text", Editable: false},
			{Name: "value", DataType: "text", ColumnType: "text", Editable: false},
		}, nil
	}
	ad, err := s.sessions.Adapter(sess)
	if err != nil {
		return nil, err
	}
	return ad.ListColumns(ctx, sess.DB, database, table)
}

// ListIndexes 列出表索引。
func (s *Service) ListIndexes(ctx context.Context, sessionID, database, table string) ([]model.IndexMetaDO, error) {
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
	return ad.ListIndexes(ctx, sess.DB, database, table)
}

// GetTableDDL 获取表 DDL。
func (s *Service) GetTableDDL(ctx context.Context, sessionID, database, table string) (string, error) {
	if database == "" || table == "" {
		return "", errno.New(errno.CodeInvalidArg, "数据库和表名不能为空", "")
	}
	sess, err := s.sessions.Get(sessionID)
	if err != nil {
		return "", err
	}
	ad, err := s.sessions.Adapter(sess)
	if err != nil {
		return "", err
	}
	return ad.GetTableDDL(ctx, sess.DB, database, table)
}
