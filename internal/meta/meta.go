package meta

import (
	"context"
	"database/sql"

	"WWorkbench/internal/adapter"
	redisadapter "WWorkbench/internal/adapter/redis"
	"WWorkbench/internal/errno"
	"WWorkbench/internal/model"
	"WWorkbench/internal/session"
)

// Service 元数据服务。
type Service struct {
	sessions *session.Manager
}

// NewService 创建元数据服务。
func NewService(sessions *session.Manager) *Service {
	return &Service{sessions: sessions}
}

// GetObjectTree 获取对象树（仅库列表，表/视图点击库后懒加载）。
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
	nodes := make([]model.ObjectTreeNodeDO, 0, len(dbs))
	for _, db := range dbs {
		nodes = append(nodes, model.ObjectTreeNodeDO{
			ID:       sessionID + ":db:" + db,
			Label:    db,
			NodeType: "database",
			Database: db,
			Lazy:     true,
		})
	}
	return nodes, nil
}

// ListDatabaseObjects 列出库内表与视图（对象树懒加载）。
func (s *Service) ListDatabaseObjects(ctx context.Context, sessionID, database string) ([]model.ObjectTreeNodeDO, error) {
	if database == "" {
		return nil, errno.New(errno.CodeInvalidArg, "数据库名不能为空", "")
	}
	sess, err := s.sessions.Get(sessionID)
	if err != nil {
		return nil, err
	}
	if sess.DbType == "redis" {
		return nil, errno.New(errno.CodeInvalidArg, "Redis 不支持按库懒加载", database)
	}
	ad, err := s.sessions.Adapter(sess)
	if err != nil {
		return nil, err
	}
	db, release, err := s.sessions.DBForDatabase(ctx, sessionID, database)
	if err != nil {
		return nil, err
	}
	defer release()
	return listDatabaseObjectNodes(ctx, ad, db, sessionID, database)
}

// listDatabaseObjectNodes 构建库内表/视图节点。
func listDatabaseObjectNodes(ctx context.Context, ad adapter.DatabaseAdapter, db *sql.DB, sessionID, database string) ([]model.ObjectTreeNodeDO, error) {
	tables, err := ad.ListTables(ctx, db, database)
	if err != nil {
		return nil, err
	}
	var nodes []model.ObjectTreeNodeDO
	for _, tbl := range tables {
		nodes = append(nodes, model.ObjectTreeNodeDO{
			ID:       sessionID + ":tbl:" + database + "." + tbl.Name,
			Label:    tbl.Name,
			NodeType: "table",
			Database: database,
			Table:    tbl.Name,
			Lazy:     true,
		})
	}
	views, err := ad.ListViews(ctx, db, database)
	if err != nil {
		return nil, err
	}
	for _, v := range views {
		nodes = append(nodes, model.ObjectTreeNodeDO{
			ID:       sessionID + ":view:" + database + "." + v.Name,
			Label:    v.Name,
			NodeType: "view",
			Database: database,
			Table:    v.Name,
			Lazy:     true,
		})
	}
	return nodes, nil
}

// redisObjectTree 构建 Redis 键对象树。
func redisObjectTree(ctx context.Context, sess *session.Session) ([]model.ObjectTreeNodeDO, error) {
	dbLabel := "DB " + sess.Database
	if sess.Database == "" {
		dbLabel = "DB 0"
	}
	keys, err := redisadapter.ScanKeys(ctx, sess.Redis, "*", 2000)
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
	db, release, err := s.sessions.DBForDatabase(ctx, sessionID, database)
	if err != nil {
		return nil, err
	}
	defer release()
	return ad.ListColumns(ctx, db, database, table)
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
	db, release, err := s.sessions.DBForDatabase(ctx, sessionID, database)
	if err != nil {
		return nil, err
	}
	defer release()
	return ad.ListIndexes(ctx, db, database, table)
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
	db, release, err := s.sessions.DBForDatabase(ctx, sessionID, database)
	if err != nil {
		return "", err
	}
	defer release()
	return ad.GetTableDDL(ctx, db, database, table)
}
