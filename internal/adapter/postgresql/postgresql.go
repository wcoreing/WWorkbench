package postgresql

import (
	"context"
	"database/sql"
	"fmt"
	"strings"
	"time"

	"WNavicat/internal/adapter"
	"WNavicat/internal/errno"
	"WNavicat/internal/model"
	"WNavicat/internal/tunnel"

	_ "github.com/jackc/pgx/v5/stdlib"
	"github.com/google/uuid"
)

const dbType = "postgresql"

// Adapter PostgreSQL 适配器。
type Adapter struct{}

// New 创建 PostgreSQL 适配器。
func New() adapter.DatabaseAdapter { return &Adapter{} }

// Type 返回数据库类型。
func (a *Adapter) Type() string { return dbType }

// Register 注册到全局注册表。
func Register(r *adapter.Registry) { r.Register(New()) }

// Open 打开连接池。
func (a *Adapter) Open(ctx context.Context, cfg model.ConnectionConfigDO, t tunnel.Tunnel) (*sql.DB, error) {
	host, port := splitAddr(t.Addr(), defaultPort(cfg.Port))
	dbName := cfg.Database
	if dbName == "" {
		dbName = "postgres"
	}
	dsn := fmt.Sprintf("host=%s port=%d user=%s password=%s dbname=%s sslmode=disable",
		host, port, cfg.User, cfg.Password, dbName)
	db, err := sql.Open("pgx", dsn)
	if err != nil {
		return nil, errno.Wrap(errno.CodeConnFailed, "打开 PostgreSQL 失败", err)
	}
	db.SetMaxOpenConns(10)
	db.SetMaxIdleConns(5)
	db.SetConnMaxLifetime(30 * time.Minute)
	if err := db.PingContext(ctx); err != nil {
		_ = db.Close()
		return nil, errno.Wrap(errno.CodeConnFailed, "连接 PostgreSQL 失败", err)
	}
	return db, nil
}

// Ping 测试连接。
func (a *Adapter) Ping(ctx context.Context, db *sql.DB) error {
	if err := db.PingContext(ctx); err != nil {
		return errno.Wrap(errno.CodeConnFailed, "Ping 失败", err)
	}
	return nil
}

// ListDatabases 列出数据库。
func (a *Adapter) ListDatabases(ctx context.Context, db *sql.DB) ([]string, error) {
	rows, err := db.QueryContext(ctx, `SELECT datname FROM pg_database WHERE datallowconn AND NOT datistemplate ORDER BY datname`)
	if err != nil {
		return nil, errno.Wrap(errno.CodeSQLFailed, "列出数据库失败", err)
	}
	defer rows.Close()
	var list []string
	for rows.Next() {
		var name string
		if err := rows.Scan(&name); err != nil {
			return nil, err
		}
		list = append(list, name)
	}
	return list, nil
}

// ListTables 列出 public 模式下的表。
func (a *Adapter) ListTables(ctx context.Context, db *sql.DB, _ string) ([]model.TableMetaDO, error) {
	return listSchemaObjects(ctx, db, "BASE TABLE")
}

// ListViews 列出视图。
func (a *Adapter) ListViews(ctx context.Context, db *sql.DB, _ string) ([]model.TableMetaDO, error) {
	return listSchemaObjects(ctx, db, "VIEW")
}

func listSchemaObjects(ctx context.Context, db *sql.DB, tableType string) ([]model.TableMetaDO, error) {
	q := `SELECT table_schema, table_name FROM information_schema.tables
		WHERE table_schema NOT IN ('pg_catalog', 'information_schema') AND table_type = $1
		ORDER BY table_schema, table_name`
	rows, err := db.QueryContext(ctx, q, tableType)
	if err != nil {
		return nil, errno.Wrap(errno.CodeSQLFailed, "列出对象失败", err)
	}
	defer rows.Close()
	var list []model.TableMetaDO
	for rows.Next() {
		var schema, name string
		if err := rows.Scan(&schema, &name); err != nil {
			return nil, err
		}
		t := model.TableMetaDO{Name: name}
		if schema != schemaPublic {
			t.Name = schema + "." + name
		}
		list = append(list, t)
	}
	return list, nil
}

// ListIndexes 列出索引。
func (a *Adapter) ListIndexes(ctx context.Context, db *sql.DB, _, table string) ([]model.IndexMetaDO, error) {
	schema, name := parseTableRef(table)
	q := `SELECT indexname, indexdef FROM pg_indexes WHERE schemaname = $1 AND tablename = $2 ORDER BY indexname`
	rows, err := db.QueryContext(ctx, q, schema, name)
	if err != nil {
		return nil, errno.Wrap(errno.CodeSQLFailed, "列出索引失败", err)
	}
	defer rows.Close()
	var list []model.IndexMetaDO
	for rows.Next() {
		var name, def string
		if err := rows.Scan(&name, &def); err != nil {
			return nil, err
		}
		list = append(list, model.IndexMetaDO{Name: name, Column: def, IndexType: "INDEX"})
	}
	return list, nil
}

// ListColumns 列出列。
func (a *Adapter) ListColumns(ctx context.Context, db *sql.DB, _, table string) ([]model.ColumnMetaDO, error) {
	return fetchColumns(ctx, db, table)
}

// GetTableDDL 获取建表语句（基于列元数据拼装）。
func (a *Adapter) GetTableDDL(ctx context.Context, db *sql.DB, _, table string) (string, error) {
	cols, err := fetchColumns(ctx, db, table)
	if err != nil {
		return "", err
	}
	if len(cols) == 0 {
		return "", errno.New(errno.CodeNotFound, "表不存在", table)
	}
	var parts []string
	for _, c := range cols {
		line := fmt.Sprintf("  %s %s", quoteIdent(c.Name), c.ColumnType)
		if !c.Nullable {
			line += " NOT NULL"
		}
		if c.DefaultValue != nil && *c.DefaultValue != "" {
			line += " DEFAULT " + *c.DefaultValue
		}
		parts = append(parts, line)
	}
	return fmt.Sprintf("CREATE TABLE %s (\n%s\n);", qualTable(table), strings.Join(parts, ",\n")), nil
}

// Execute 执行非查询 SQL。
func (a *Adapter) Execute(ctx context.Context, db *sql.DB, _, sqlText string) (*model.ExecuteResultDO, error) {
	start := time.Now()
	res, err := db.ExecContext(ctx, sqlText)
	if err != nil {
		return nil, errno.Wrap(errno.CodeSQLFailed, "执行 SQL 失败", err)
	}
	aff, _ := res.RowsAffected()
	return &model.ExecuteResultDO{
		RowsAffected: aff,
		Message:      "执行成功",
		ElapsedMs:    time.Since(start).Milliseconds(),
	}, nil
}

// QueryPage 分页查询。
func (a *Adapter) QueryPage(ctx context.Context, db *sql.DB, _, sqlText string, page, pageSize int) (*model.QueryPageDO, error) {
	if page < 1 {
		page = 1
	}
	if pageSize < 1 || pageSize > 500 {
		pageSize = 200
	}
	sqlText = trimSQLSemicolon(sqlText)
	start := time.Now()
	if canWrapAsSubquery(sqlText) {
		return queryPageWrapped(ctx, db, sqlText, page, pageSize, start)
	}
	return queryPageFullScan(ctx, db, sqlText, page, pageSize, start)
}

func queryPageWrapped(ctx context.Context, db *sql.DB, sqlText string, page, pageSize int, start time.Time) (*model.QueryPageDO, error) {
	var total int64
	countSQL := fmt.Sprintf("SELECT COUNT(*) FROM (%s) AS _wn_cnt", sqlText)
	if err := db.QueryRowContext(ctx, countSQL).Scan(&total); err != nil {
		return nil, errno.Wrap(errno.CodeSQLFailed, "统计行数失败", err)
	}
	offset := (page - 1) * pageSize
	pageSQL := fmt.Sprintf("SELECT * FROM (%s) AS _wn_q LIMIT %d OFFSET %d", sqlText, pageSize, offset)
	rows, err := db.QueryContext(ctx, pageSQL)
	if err != nil {
		return nil, errno.Wrap(errno.CodeSQLFailed, "查询失败", err)
	}
	defer rows.Close()
	pageRows, colMeta, err := readQueryRows(rows)
	if err != nil {
		return nil, err
	}
	return &model.QueryPageDO{
		Columns: colMeta, Rows: pageRows, Page: page, PageSize: pageSize, Total: total,
		ElapsedMs: time.Since(start).Milliseconds(),
	}, nil
}

func queryPageFullScan(ctx context.Context, db *sql.DB, sqlText string, page, pageSize int, start time.Time) (*model.QueryPageDO, error) {
	rows, err := db.QueryContext(ctx, sqlText)
	if err != nil {
		return nil, errno.Wrap(errno.CodeSQLFailed, "查询失败", err)
	}
	defer rows.Close()
	all, colMeta, err := readQueryRows(rows)
	if err != nil {
		return nil, err
	}
	total := int64(len(all))
	offset := (page - 1) * pageSize
	end := offset + pageSize
	if offset > len(all) {
		offset = len(all)
	}
	if end > len(all) {
		end = len(all)
	}
	pageRows := all[offset:end]
	if pageRows == nil {
		pageRows = []model.QueryRowDO{}
	}
	return &model.QueryPageDO{
		Columns: colMeta, Rows: pageRows, Page: page, PageSize: pageSize, Total: total,
		ElapsedMs: time.Since(start).Milliseconds(),
	}, nil
}

func readQueryRows(rows *sql.Rows) ([]model.QueryRowDO, []model.ColumnMetaDO, error) {
	cols, err := rows.Columns()
	if err != nil {
		return nil, nil, err
	}
	colTypes, _ := rows.ColumnTypes()
	colMeta := make([]model.ColumnMetaDO, len(cols))
	for i, name := range cols {
		colMeta[i].Name = name
		colMeta[i].Editable = true
		if i < len(colTypes) && colTypes[i] != nil {
			colMeta[i].DataType = colTypes[i].DatabaseTypeName()
			colMeta[i].ColumnType = colTypes[i].DatabaseTypeName()
		}
	}
	var all []model.QueryRowDO
	for rows.Next() {
		row, err := scanRow(rows, len(cols))
		if err != nil {
			return nil, nil, err
		}
		all = append(all, model.QueryRowDO{Cells: row})
	}
	if all == nil {
		all = []model.QueryRowDO{}
	}
	return all, colMeta, nil
}

// QueryTablePage 分页查表。
func (a *Adapter) QueryTablePage(ctx context.Context, db *sql.DB, _, table string, q model.TableDataQueryDO) (*model.TableDataPageDO, error) {
	page, pageSize := q.Page, q.PageSize
	if page < 1 {
		page = 1
	}
	if pageSize < 1 || pageSize > 500 {
		pageSize = 200
	}
	start := time.Now()
	columns, err := fetchColumns(ctx, db, table)
	if err != nil {
		return nil, err
	}
	colSet := columnSet(columns)
	whereSQL, whereArgs, err := buildTableWhere(q.Filters, colSet)
	if err != nil {
		return nil, err
	}
	orderSQL, err := buildTableOrderBy(q.Sorts, colSet)
	if err != nil {
		return nil, err
	}
	pkCols := primaryKeys(columns)
	hasPK := len(pkCols) > 0
	readOnly := !hasPK
	for i := range columns {
		columns[i].Editable = hasPK && !isBlobType(columns[i].DataType)
	}
	tbl := qualTable(table)
	var total int64
	countSQL := "SELECT COUNT(*) FROM " + tbl + whereSQL
	if err := db.QueryRowContext(ctx, countSQL, whereArgs...).Scan(&total); err != nil {
		total = -1
	}
	offset := (page - 1) * pageSize
	n := len(whereArgs)
	dataSQL := fmt.Sprintf("SELECT * FROM %s%s%s LIMIT $%d OFFSET $%d", tbl, whereSQL, orderSQL, n+1, n+2)
	args := append(append([]interface{}{}, whereArgs...), pageSize, offset)
	rows, err := db.QueryContext(ctx, dataSQL, args...)
	if err != nil {
		return nil, errno.Wrap(errno.CodeSQLFailed, "查询表数据失败", err)
	}
	defer rows.Close()
	colNames, _ := rows.Columns()
	var result []model.TableRowDO
	for rows.Next() {
		cells, err := scanRow(rows, len(colNames))
		if err != nil {
			return nil, err
		}
		vals := make(map[string]model.CellValueDO)
		for i, name := range colNames {
			vals[name] = cells[i]
		}
		result = append(result, model.TableRowDO{RowID: uuid.NewString(), Values: vals})
	}
	if result == nil {
		result = []model.TableRowDO{}
	}
	return &model.TableDataPageDO{
		Columns: columns, Rows: result, Page: page, PageSize: pageSize, Total: total,
		HasPrimaryKey: hasPK, ReadOnly: readOnly, ElapsedMs: time.Since(start).Milliseconds(),
	}, nil
}

// ApplyMutations 应用行变更。
func (a *Adapter) ApplyMutations(ctx context.Context, db *sql.DB, _, table string, batch model.RowMutationBatchDO) error {
	columns, err := fetchColumns(ctx, db, table)
	if err != nil {
		return err
	}
	pkCols := primaryKeys(columns)
	if len(pkCols) == 0 {
		return errno.New(errno.CodeReadOnlyTable, "表无主键，无法编辑", table)
	}
	tx, err := db.BeginTx(ctx, nil)
	if err != nil {
		return errno.Wrap(errno.CodeMutationFailed, "开启事务失败", err)
	}
	defer tx.Rollback()
	tbl := qualTable(table)
	for _, del := range batch.Deletes {
		if err := execDelete(ctx, tx, tbl, pkCols, del); err != nil {
			return err
		}
	}
	for _, upd := range batch.Updates {
		if err := execUpdate(ctx, tx, tbl, pkCols, columns, upd); err != nil {
			return err
		}
	}
	for _, ins := range batch.Inserts {
		if err := execInsert(ctx, tx, tbl, columns, ins); err != nil {
			return err
		}
	}
	return tx.Commit()
}

func fetchColumns(ctx context.Context, db *sql.DB, table string) ([]model.ColumnMetaDO, error) {
	schema, name := parseTableRef(table)
	q := `SELECT column_name, data_type, udt_name, is_nullable, column_default,
		COALESCE(col_description((table_schema||'.'||table_name)::regclass::oid, ordinal_position), '')
		FROM information_schema.columns
		WHERE table_schema = $1 AND table_name = $2 ORDER BY ordinal_position`
	rows, err := db.QueryContext(ctx, q, schema, name)
	if err != nil {
		return nil, errno.Wrap(errno.CodeSQLFailed, "列出列失败", err)
	}
	defer rows.Close()
	pkCols, _ := fetchPrimaryKeys(ctx, db, schema, name)
	pkSet := make(map[string]bool)
	for _, p := range pkCols {
		pkSet[p] = true
	}
	var list []model.ColumnMetaDO
	for rows.Next() {
		var c model.ColumnMetaDO
		var nullable string
		var def sql.NullString
		if err := rows.Scan(&c.Name, &c.DataType, &c.ColumnType, &nullable, &def, &c.Comment); err != nil {
			return nil, err
		}
		c.Nullable = nullable == "YES"
		c.IsPrimaryKey = pkSet[c.Name]
		if def.Valid {
			v := def.String
			c.DefaultValue = &v
		}
		c.Editable = !isBlobType(c.DataType)
		list = append(list, c)
	}
	return list, nil
}

func fetchPrimaryKeys(ctx context.Context, db *sql.DB, schema, table string) ([]string, error) {
	q := `SELECT kcu.column_name
		FROM information_schema.table_constraints tc
		JOIN information_schema.key_column_usage kcu
		  ON tc.constraint_name = kcu.constraint_name AND tc.table_schema = kcu.table_schema
		WHERE tc.constraint_type = 'PRIMARY KEY' AND tc.table_schema = $1 AND tc.table_name = $2
		ORDER BY kcu.ordinal_position`
	rows, err := db.QueryContext(ctx, q, schema, table)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	var pk []string
	for rows.Next() {
		var col string
		if err := rows.Scan(&col); err != nil {
			return nil, err
		}
		pk = append(pk, col)
	}
	return pk, nil
}

func execDelete(ctx context.Context, tx *sql.Tx, table string, pkCols []string, m model.RowMutationDO) error {
	where, args := pkWhere(pkCols, m.OldPK, m.Fields, 1)
	if len(where) == 0 {
		return errno.New(errno.CodeInvalidArg, "删除缺少主键", "")
	}
	_, err := tx.ExecContext(ctx, fmt.Sprintf("DELETE FROM %s WHERE %s", table, strings.Join(where, " AND ")), args...)
	return err
}

func execUpdate(ctx context.Context, tx *sql.Tx, table string, pkCols []string, columns []model.ColumnMetaDO, m model.RowMutationDO) error {
	pkSet := make(map[string]bool)
	for _, p := range pkCols {
		pkSet[p] = true
	}
	vals := fieldsToMap(m.Fields)
	var sets []string
	var args []interface{}
	idx := 1
	for _, col := range columns {
		if pkSet[col.Name] || !col.Editable {
			continue
		}
		fv, ok := vals[col.Name]
		if !ok {
			continue
		}
		sets = append(sets, fmt.Sprintf("%s=$%d", quoteIdent(col.Name), idx))
		idx++
		args = append(args, nullableArg(fv))
	}
	if len(sets) == 0 {
		return nil
	}
	where, wargs := pkWhere(pkCols, m.OldPK, m.Fields, idx)
	args = append(args, wargs...)
	_, err := tx.ExecContext(ctx, fmt.Sprintf("UPDATE %s SET %s WHERE %s", table, strings.Join(sets, ","), strings.Join(where, " AND ")), args...)
	return err
}

func execInsert(ctx context.Context, tx *sql.Tx, table string, columns []model.ColumnMetaDO, m model.RowMutationDO) error {
	vals := fieldsToMap(m.Fields)
	var names []string
	var placeholders []string
	var args []interface{}
	idx := 1
	for _, col := range columns {
		if col.IsPrimaryKey {
			if fv, ok := vals[col.Name]; !ok || fv.IsNull || fv.Value == nil || *fv.Value == "" {
				if strings.Contains(strings.ToLower(col.ColumnType), "serial") || strings.Contains(strings.ToLower(col.Extra), "nextval") {
					continue
				}
			}
		}
		fv, ok := vals[col.Name]
		if !ok {
			continue
		}
		names = append(names, quoteIdent(col.Name))
		placeholders = append(placeholders, fmt.Sprintf("$%d", idx))
		idx++
		args = append(args, nullableArg(fv))
	}
	if len(names) == 0 {
		return errno.New(errno.CodeInvalidArg, "插入无有效字段", "")
	}
	sqlText := fmt.Sprintf("INSERT INTO %s (%s) VALUES (%s)", table, strings.Join(names, ","), strings.Join(placeholders, ","))
	_, err := tx.ExecContext(ctx, sqlText, args...)
	return err
}

func pkWhere(pkCols []string, oldPK, fields []model.FieldValueDO, startIdx int) ([]string, []interface{}) {
	src := fieldsToMap(fields)
	if len(oldPK) > 0 {
		src = fieldsToMap(oldPK)
	}
	var where []string
	var args []interface{}
	idx := startIdx
	for _, col := range pkCols {
		fv, ok := src[col]
		if !ok {
			continue
		}
		if fv.IsNull || fv.Value == nil {
			where = append(where, quoteIdent(col)+" IS NULL")
		} else {
			where = append(where, fmt.Sprintf("%s=$%d", quoteIdent(col), idx))
			idx++
			args = append(args, *fv.Value)
		}
	}
	return where, args
}

func fieldsToMap(fields []model.FieldValueDO) map[string]model.FieldValueDO {
	m := make(map[string]model.FieldValueDO)
	for _, f := range fields {
		m[f.Name] = f
	}
	return m
}

func nullableArg(fv model.FieldValueDO) interface{} {
	if fv.IsNull || fv.Value == nil {
		return nil
	}
	return *fv.Value
}

func primaryKeys(cols []model.ColumnMetaDO) []string {
	var pk []string
	for _, c := range cols {
		if c.IsPrimaryKey {
			pk = append(pk, c.Name)
		}
	}
	return pk
}

func isBlobType(dt string) bool {
	dt = strings.ToLower(dt)
	return strings.Contains(dt, "bytea") || dt == "blob"
}

// ExportTableInsertSQL 导出 INSERT。
func (a *Adapter) ExportTableInsertSQL(ctx context.Context, db *sql.DB, _, table string, maxRows int) (string, error) {
	page, err := a.QueryTablePage(ctx, db, "", table, model.TableDataQueryDO{Page: 1, PageSize: maxRows})
	if err != nil {
		return "", err
	}
	if len(page.Rows) == 0 {
		return fmt.Sprintf("-- %s 无数据\n", table), nil
	}
	colNames := make([]string, len(page.Columns))
	for i, c := range page.Columns {
		colNames[i] = c.Name
	}
	var b strings.Builder
	b.WriteString(fmt.Sprintf("-- %s INSERT (%d rows)\n", table, len(page.Rows)))
	tbl := qualTable(table)
	for _, row := range page.Rows {
		var vals []string
		for _, col := range colNames {
			cell := row.Values[col]
			if cell.IsNull || cell.Value == nil {
				vals = append(vals, "NULL")
			} else {
				vals = append(vals, quoteSQLString(*cell.Value))
			}
		}
		cols := make([]string, len(colNames))
		for i, n := range colNames {
			cols[i] = quoteIdent(n)
		}
		b.WriteString(fmt.Sprintf("INSERT INTO %s (%s) VALUES (%s);\n", tbl, strings.Join(cols, ","), strings.Join(vals, ",")))
	}
	return b.String(), nil
}
