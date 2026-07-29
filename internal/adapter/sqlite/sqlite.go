package sqlite

import (
	"context"
	"database/sql"
	"fmt"
	"os"
	"path/filepath"
	"strings"
	"time"

	"WWorkbench/internal/adapter"
	"WWorkbench/internal/errno"
	"WWorkbench/internal/model"
	"WWorkbench/internal/tunnel"

	"github.com/google/uuid"
	_ "modernc.org/sqlite"
)

const dbType = "sqlite"

// Adapter SQLite 适配器。
type Adapter struct{}

// New 创建 SQLite 适配器。
func New() adapter.DatabaseAdapter { return &Adapter{} }

// Type 返回数据库类型。
func (a *Adapter) Type() string { return dbType }

// Register 注册到全局注册表。
func Register(r *adapter.Registry) { r.Register(New()) }

// Open 打开 SQLite 文件（路径取自 cfg.Host）。
func (a *Adapter) Open(ctx context.Context, cfg model.ConnectionConfigDO, _ tunnel.Tunnel) (*sql.DB, error) {
	path, err := resolveDBPath(cfg.Host)
	if err != nil {
		return nil, err
	}
	db, err := sql.Open("sqlite", path)
	if err != nil {
		return nil, errno.Wrap(errno.CodeConnFailed, "打开 SQLite 失败", err)
	}
	// SQLite 写锁敏感，单连接避免 database is locked。
	db.SetMaxOpenConns(1)
	db.SetMaxIdleConns(1)
	db.SetConnMaxLifetime(0)
	if _, err := db.ExecContext(ctx, "PRAGMA foreign_keys = ON"); err != nil {
		_ = db.Close()
		return nil, errno.Wrap(errno.CodeConnFailed, "启用外键失败", err)
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

// ListDatabases 列出已打开的数据库（main / 附加库）。
func (a *Adapter) ListDatabases(ctx context.Context, db *sql.DB) ([]string, error) {
	rows, err := db.QueryContext(ctx, `PRAGMA database_list`)
	if err != nil {
		return nil, errno.Wrap(errno.CodeSQLFailed, "列出数据库失败", err)
	}
	defer rows.Close()
	var list []string
	for rows.Next() {
		var seq int
		var name, file string
		if err := rows.Scan(&seq, &name, &file); err != nil {
			return nil, err
		}
		list = append(list, name)
	}
	if len(list) == 0 {
		list = []string{"main"}
	}
	return list, nil
}

// ListTables 列出表。
func (a *Adapter) ListTables(ctx context.Context, db *sql.DB, database string) ([]model.TableMetaDO, error) {
	return listSchemaObjects(ctx, db, database, "table")
}

// ListViews 列出视图。
func (a *Adapter) ListViews(ctx context.Context, db *sql.DB, database string) ([]model.TableMetaDO, error) {
	return listSchemaObjects(ctx, db, database, "view")
}

func listSchemaObjects(ctx context.Context, db *sql.DB, database, objType string) ([]model.TableMetaDO, error) {
	schema := normalizeSchema(database)
	q := fmt.Sprintf(
		`SELECT name FROM %s.sqlite_master WHERE type = ? AND name NOT LIKE 'sqlite_%%' ORDER BY name`,
		quoteIdent(schema),
	)
	rows, err := db.QueryContext(ctx, q, objType)
	if err != nil {
		return nil, errno.Wrap(errno.CodeSQLFailed, "列出对象失败", err)
	}
	defer rows.Close()
	var list []model.TableMetaDO
	for rows.Next() {
		var name string
		if err := rows.Scan(&name); err != nil {
			return nil, err
		}
		list = append(list, model.TableMetaDO{Name: name})
	}
	return list, nil
}

// ListIndexes 列出索引（每列一行，与 MySQL 适配器对齐）。
// 注意：SQLite 连接 MaxOpenConns=1，必须先收齐 index_list 再查 index_info，避免嵌套查询死锁。
func (a *Adapter) ListIndexes(ctx context.Context, db *sql.DB, database, table string) ([]model.IndexMetaDO, error) {
	schema := normalizeSchema(database)
	q := fmt.Sprintf(`PRAGMA %s.index_list(%s)`, quoteIdent(schema), quoteIdent(table))
	rows, err := db.QueryContext(ctx, q)
	if err != nil {
		return nil, errno.Wrap(errno.CodeSQLFailed, "列出索引失败", err)
	}
	type idxHead struct {
		name   string
		unique int
	}
	var heads []idxHead
	for rows.Next() {
		var seq int
		var name string
		var unique int
		var origin, partial sql.NullString
		if err := rows.Scan(&seq, &name, &unique, &origin, &partial); err != nil {
			rows.Close()
			return nil, err
		}
		if strings.HasPrefix(name, "sqlite_autoindex_") {
			continue
		}
		heads = append(heads, idxHead{name: name, unique: unique})
	}
	if err := rows.Err(); err != nil {
		rows.Close()
		return nil, err
	}
	rows.Close()

	var list []model.IndexMetaDO
	for _, h := range heads {
		cols, err := indexColumns(ctx, db, schema, h.name)
		if err != nil {
			return nil, errno.Wrap(errno.CodeSQLFailed, "列出索引列失败", err)
		}
		idxType := "INDEX"
		if h.unique != 0 {
			idxType = "UNIQUE"
		}
		for i, col := range cols {
			list = append(list, model.IndexMetaDO{
				Name: h.name, Column: col, NonUnique: h.unique == 0, IndexType: idxType, SeqInIndex: i + 1,
			})
		}
	}
	return list, nil
}

func indexColumns(ctx context.Context, db *sql.DB, schema, indexName string) ([]string, error) {
	q := fmt.Sprintf(`PRAGMA %s.index_info(%s)`, quoteIdent(schema), quoteIdent(indexName))
	rows, err := db.QueryContext(ctx, q)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	var cols []string
	for rows.Next() {
		var seqno, cid sql.NullInt64
		var name sql.NullString
		if err := rows.Scan(&seqno, &cid, &name); err != nil {
			return nil, err
		}
		if name.Valid {
			cols = append(cols, name.String)
		}
	}
	return cols, nil
}

// ListColumns 列出列。
func (a *Adapter) ListColumns(ctx context.Context, db *sql.DB, database, table string) ([]model.ColumnMetaDO, error) {
	return fetchColumns(ctx, db, database, table)
}

// GetTableDDL 获取建表/视图 SQL。
func (a *Adapter) GetTableDDL(ctx context.Context, db *sql.DB, database, table string) (string, error) {
	schema := normalizeSchema(database)
	q := fmt.Sprintf(
		`SELECT sql FROM %s.sqlite_master WHERE name = ? AND type IN ('table','view') LIMIT 1`,
		quoteIdent(schema),
	)
	var ddl sql.NullString
	if err := db.QueryRowContext(ctx, q, table).Scan(&ddl); err != nil {
		return "", errno.Wrap(errno.CodeSQLFailed, "获取 DDL 失败", err)
	}
	if !ddl.Valid || ddl.String == "" {
		return "", errno.New(errno.CodeNotFound, "表不存在", table)
	}
	return ddl.String, nil
}

// Execute 执行非查询 SQL。
func (a *Adapter) Execute(ctx context.Context, db *sql.DB, _, sqlText string) (*model.ExecuteResultDO, error) {
	start := time.Now()
	res, err := db.ExecContext(ctx, sqlText)
	if err != nil {
		return nil, errno.Wrap(errno.CodeSQLFailed, "执行 SQL 失败", err)
	}
	aff, _ := res.RowsAffected()
	lid, _ := res.LastInsertId()
	return &model.ExecuteResultDO{
		RowsAffected: aff,
		LastInsertID: lid,
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
	countSQL := fmt.Sprintf("SELECT COUNT(*) FROM (%s)", sqlText)
	if err := db.QueryRowContext(ctx, countSQL).Scan(&total); err != nil {
		return nil, errno.Wrap(errno.CodeSQLFailed, "统计行数失败", err)
	}
	offset := (page - 1) * pageSize
	pageSQL := fmt.Sprintf("SELECT * FROM (%s) LIMIT %d OFFSET %d", sqlText, pageSize, offset)
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
func (a *Adapter) QueryTablePage(ctx context.Context, db *sql.DB, database, table string, q model.TableDataQueryDO) (*model.TableDataPageDO, error) {
	page, pageSize := q.Page, q.PageSize
	if page < 1 {
		page = 1
	}
	if pageSize < 1 || pageSize > 500 {
		pageSize = 200
	}
	start := time.Now()
	columns, err := fetchColumns(ctx, db, database, table)
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
	tbl := qualTable(database, table)
	var total int64
	countSQL := "SELECT COUNT(*) FROM " + tbl + whereSQL
	if err := db.QueryRowContext(ctx, countSQL, whereArgs...).Scan(&total); err != nil {
		total = -1
	}
	offset := (page - 1) * pageSize
	dataSQL := fmt.Sprintf("SELECT * FROM %s%s%s LIMIT %d OFFSET %d", tbl, whereSQL, orderSQL, pageSize, offset)
	rows, err := db.QueryContext(ctx, dataSQL, whereArgs...)
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
func (a *Adapter) ApplyMutations(ctx context.Context, db *sql.DB, database, table string, batch model.RowMutationBatchDO) error {
	columns, err := fetchColumns(ctx, db, database, table)
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
	tbl := qualTable(database, table)
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
	if err := tx.Commit(); err != nil {
		return errno.Wrap(errno.CodeMutationFailed, "提交事务失败", err)
	}
	return nil
}

func fetchColumns(ctx context.Context, db *sql.DB, database, table string) ([]model.ColumnMetaDO, error) {
	schema := normalizeSchema(database)
	q := fmt.Sprintf(`PRAGMA %s.table_info(%s)`, quoteIdent(schema), quoteIdent(table))
	rows, err := db.QueryContext(ctx, q)
	if err != nil {
		return nil, errno.Wrap(errno.CodeSQLFailed, "列出列失败", err)
	}
	defer rows.Close()
	var list []model.ColumnMetaDO
	for rows.Next() {
		var cid int
		var name, colType string
		var notnull, pk int
		var dflt sql.NullString
		if err := rows.Scan(&cid, &name, &colType, &notnull, &dflt, &pk); err != nil {
			return nil, err
		}
		c := model.ColumnMetaDO{
			Name:         name,
			DataType:     colType,
			ColumnType:   colType,
			Nullable:     notnull == 0,
			IsPrimaryKey: pk > 0,
			Editable:     !isBlobType(colType),
		}
		if dflt.Valid {
			v := dflt.String
			c.DefaultValue = &v
		}
		list = append(list, c)
	}
	return list, nil
}

func execDelete(ctx context.Context, tx *sql.Tx, table string, pkCols []string, m model.RowMutationDO) error {
	where, args := pkWhere(pkCols, m.OldPK, m.Fields)
	if len(where) == 0 {
		return errno.New(errno.CodeInvalidArg, "删除缺少主键", "")
	}
	_, err := tx.ExecContext(ctx, fmt.Sprintf("DELETE FROM %s WHERE %s", table, strings.Join(where, " AND ")), args...)
	if err != nil {
		return errno.Wrap(errno.CodeMutationFailed, "删除行失败", err)
	}
	return nil
}

func execUpdate(ctx context.Context, tx *sql.Tx, table string, pkCols []string, columns []model.ColumnMetaDO, m model.RowMutationDO) error {
	pkSet := make(map[string]bool, len(pkCols))
	for _, p := range pkCols {
		pkSet[p] = true
	}
	vals := fieldsToMap(m.Fields)
	var sets []string
	var args []interface{}
	for _, col := range columns {
		if pkSet[col.Name] || !col.Editable {
			continue
		}
		fv, ok := vals[col.Name]
		if !ok {
			continue
		}
		sets = append(sets, quoteIdent(col.Name)+"=?")
		args = append(args, nullableArg(fv))
	}
	if len(sets) == 0 {
		return nil
	}
	where, wargs := pkWhere(pkCols, m.OldPK, m.Fields)
	args = append(args, wargs...)
	_, err := tx.ExecContext(ctx, fmt.Sprintf("UPDATE %s SET %s WHERE %s", table, strings.Join(sets, ","), strings.Join(where, " AND ")), args...)
	if err != nil {
		return errno.Wrap(errno.CodeMutationFailed, "更新行失败", err)
	}
	return nil
}

func execInsert(ctx context.Context, tx *sql.Tx, table string, columns []model.ColumnMetaDO, m model.RowMutationDO) error {
	vals := fieldsToMap(m.Fields)
	var names []string
	var placeholders []string
	var args []interface{}
	for _, col := range columns {
		fv, ok := vals[col.Name]
		if !ok {
			continue
		}
		if col.IsPrimaryKey && (fv.IsNull || fv.Value == nil || *fv.Value == "") {
			continue
		}
		names = append(names, quoteIdent(col.Name))
		placeholders = append(placeholders, "?")
		args = append(args, nullableArg(fv))
	}
	if len(names) == 0 {
		return errno.New(errno.CodeInvalidArg, "插入无有效字段", "")
	}
	sqlText := fmt.Sprintf("INSERT INTO %s (%s) VALUES (%s)", table, strings.Join(names, ","), strings.Join(placeholders, ","))
	_, err := tx.ExecContext(ctx, sqlText, args...)
	if err != nil {
		return errno.Wrap(errno.CodeMutationFailed, "插入行失败", err)
	}
	return nil
}

func pkWhere(pkCols []string, oldPK, fields []model.FieldValueDO) ([]string, []interface{}) {
	src := fieldsToMap(fields)
	if len(oldPK) > 0 {
		src = fieldsToMap(oldPK)
	}
	var where []string
	var args []interface{}
	for _, col := range pkCols {
		fv, ok := src[col]
		if !ok {
			continue
		}
		if fv.IsNull || fv.Value == nil {
			where = append(where, quoteIdent(col)+" IS NULL")
		} else {
			where = append(where, quoteIdent(col)+"=?")
			args = append(args, *fv.Value)
		}
	}
	return where, args
}

func fieldsToMap(fields []model.FieldValueDO) map[string]model.FieldValueDO {
	m := make(map[string]model.FieldValueDO, len(fields))
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

func scanRow(rows *sql.Rows, n int) ([]model.CellValueDO, error) {
	vals := make([]interface{}, n)
	ptrs := make([]interface{}, n)
	for i := range vals {
		ptrs[i] = &vals[i]
	}
	if err := rows.Scan(ptrs...); err != nil {
		return nil, err
	}
	out := make([]model.CellValueDO, n)
	for i, v := range vals {
		out[i] = toCell(v)
	}
	return out, nil
}

func toCell(v interface{}) model.CellValueDO {
	if v == nil {
		return model.CellValueDO{IsNull: true, Display: "NULL"}
	}
	switch x := v.(type) {
	case []byte:
		s := string(x)
		return model.CellValueDO{Value: &s, Display: s}
	case time.Time:
		s := x.Format("2006-01-02 15:04:05")
		return model.CellValueDO{Value: &s, Display: s}
	default:
		s := fmt.Sprint(x)
		return model.CellValueDO{Value: &s, Display: s}
	}
}

func isBlobType(dt string) bool {
	dt = strings.ToLower(strings.TrimSpace(dt))
	return dt == "blob" || strings.Contains(dt, "blob")
}

// ExportTableInsertSQL 导出 INSERT。
func (a *Adapter) ExportTableInsertSQL(ctx context.Context, db *sql.DB, database, table string, maxRows int) (string, error) {
	page, err := a.QueryTablePage(ctx, db, database, table, model.TableDataQueryDO{Page: 1, PageSize: maxRows})
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
	tbl := qualTable(database, table)
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

func resolveDBPath(raw string) (string, error) {
	path := strings.TrimSpace(raw)
	if path == "" {
		return "", errno.New(errno.CodeInvalidArg, "请填写 SQLite 文件路径", "")
	}
	if path == ":memory:" || strings.HasPrefix(path, "file:") {
		return path, nil
	}
	if strings.HasPrefix(path, "~/") || path == "~" {
		home, err := os.UserHomeDir()
		if err != nil {
			return "", errno.Wrap(errno.CodeInvalidArg, "解析用户目录失败", err)
		}
		if path == "~" {
			path = home
		} else {
			path = filepath.Join(home, path[2:])
		}
	}
	abs, err := filepath.Abs(path)
	if err != nil {
		return "", errno.Wrap(errno.CodeInvalidArg, "无效的文件路径", err)
	}
	return abs, nil
}

func normalizeSchema(database string) string {
	database = strings.TrimSpace(database)
	if database == "" {
		return "main"
	}
	return database
}

func quoteIdent(s string) string {
	return `"` + strings.ReplaceAll(s, `"`, `""`) + `"`
}

func qualTable(database, table string) string {
	schema := normalizeSchema(database)
	return quoteIdent(schema) + "." + quoteIdent(table)
}

func quoteSQLString(s string) string {
	return "'" + strings.ReplaceAll(s, "'", "''") + "'"
}

func trimSQLSemicolon(sql string) string {
	return strings.TrimSuffix(strings.TrimSpace(sql), ";")
}

func canWrapAsSubquery(sql string) bool {
	upper := strings.ToUpper(strings.TrimSpace(sql))
	for _, p := range []string{"PRAGMA ", "EXPLAIN ", "ATTACH ", "DETACH "} {
		if strings.HasPrefix(upper, p) {
			return false
		}
	}
	return true
}
