package adapter

import (
	"context"
	"database/sql"

	"WNavicat/internal/model"
	"WNavicat/internal/tunnel"
)

// DatabaseAdapter 数据库方言适配器。
type DatabaseAdapter interface {
	// Type 返回数据库类型标识。
	Type() string
	// Open 打开数据库连接池。
	Open(ctx context.Context, cfg model.ConnectionConfigDO, t tunnel.Tunnel) (*sql.DB, error)
	// Ping 测试连接。
	Ping(ctx context.Context, db *sql.DB) error
	// ListDatabases 列出数据库。
	ListDatabases(ctx context.Context, db *sql.DB) ([]string, error)
	// ListTables 列出表。
	ListTables(ctx context.Context, db *sql.DB, database string) ([]model.TableMetaDO, error)
	// ListViews 列出视图。
	ListViews(ctx context.Context, db *sql.DB, database string) ([]model.TableMetaDO, error)
	// ListIndexes 列出表索引。
	ListIndexes(ctx context.Context, db *sql.DB, database, table string) ([]model.IndexMetaDO, error)
	// ListColumns 列出列。
	ListColumns(ctx context.Context, db *sql.DB, database, table string) ([]model.ColumnMetaDO, error)
	// GetTableDDL 获取建表语句。
	GetTableDDL(ctx context.Context, db *sql.DB, database, table string) (string, error)
	// Execute 执行非查询 SQL。
	Execute(ctx context.Context, db *sql.DB, database, sqlText string) (*model.ExecuteResultDO, error)
	// QueryPage 分页查询 SQL。
	QueryPage(ctx context.Context, db *sql.DB, database, sqlText string, page, pageSize int) (*model.QueryPageDO, error)
	// QueryTablePage 分页查询表数据（含筛选排序）。
	QueryTablePage(ctx context.Context, db *sql.DB, database, table string, q model.TableDataQueryDO) (*model.TableDataPageDO, error)
	// ApplyMutations 应用行变更。
	ApplyMutations(ctx context.Context, db *sql.DB, database, table string, batch model.RowMutationBatchDO) error
	// ExportTableInsertSQL 导出表 INSERT 语句。
	ExportTableInsertSQL(ctx context.Context, db *sql.DB, database, table string, maxRows int) (string, error)
}
