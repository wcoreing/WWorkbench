package mysql

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

	_ "github.com/go-sql-driver/mysql"
	"github.com/google/uuid"
)

const dbType = "mysql"

// Adapter MySQL 适配器。
type Adapter struct{}

// New 创建 MySQL 适配器。
func New() adapter.DatabaseAdapter {
	return &Adapter{}
}

// Type 返回数据库类型。
func (a *Adapter) Type() string { return dbType }

// Open 打开连接池。
func (a *Adapter) Open(ctx context.Context, cfg model.ConnectionConfigDO, t tunnel.Tunnel) (*sql.DB, error) {
	host, port := splitAddr(t.Addr(), cfg.Port)
	dsnDB := cfg.Database
	dsn := fmt.Sprintf("%s:%s@tcp(%s:%d)/%s?parseTime=true&loc=Local&charset=%s&multiStatements=true",
		cfg.User, cfg.Password, host, port, dsnDB, defaultCharset(cfg.Charset))
	db, err := sql.Open("mysql", dsn)
	if err != nil {
		return nil, errno.Wrap(errno.CodeConnFailed, "打开 MySQL 失败", err)
	}
	db.SetMaxOpenConns(10)
	db.SetMaxIdleConns(5)
	db.SetConnMaxLifetime(30 * time.Minute)
	if err := db.PingContext(ctx); err != nil {
		_ = db.Close()
		return nil, errno.Wrap(errno.CodeConnFailed, "连接 MySQL 失败", err)
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
	rows, err := db.QueryContext(ctx, "SHOW DATABASES")
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
		if name == "information_schema" || name == "performance_schema" || name == "mysql" || name == "sys" {
			continue
		}
		list = append(list, name)
	}
	return list, nil
}

// ListTables 列出表。
func (a *Adapter) ListTables(ctx context.Context, db *sql.DB, database string) ([]model.TableMetaDO, error) {
	return listSchemaObjects(ctx, db, database, "BASE TABLE")
}

// ListViews 列出视图。
func (a *Adapter) ListViews(ctx context.Context, db *sql.DB, database string) ([]model.TableMetaDO, error) {
	return listSchemaObjects(ctx, db, database, "VIEW")
}

// listSchemaObjects 按类型列出库内对象。
func listSchemaObjects(ctx context.Context, db *sql.DB, database, tableType string) ([]model.TableMetaDO, error) {
	q := `SELECT TABLE_NAME, IFNULL(TABLE_COMMENT,''), IFNULL(ENGINE,''), IFNULL(TABLE_ROWS,0)
		FROM information_schema.TABLES WHERE TABLE_SCHEMA = ? AND TABLE_TYPE = ? ORDER BY TABLE_NAME`
	rows, err := db.QueryContext(ctx, q, database, tableType)
	if err != nil {
		return nil, errno.Wrap(errno.CodeSQLFailed, "列出对象失败", err)
	}
	defer rows.Close()
	var list []model.TableMetaDO
	for rows.Next() {
		var t model.TableMetaDO
		if err := rows.Scan(&t.Name, &t.Comment, &t.Engine, &t.Rows); err != nil {
			return nil, err
		}
		list = append(list, t)
	}
	return list, nil
}

// ListIndexes 列出表索引。
func (a *Adapter) ListIndexes(ctx context.Context, db *sql.DB, database, table string) ([]model.IndexMetaDO, error) {
	q := `SELECT INDEX_NAME, COLUMN_NAME, NON_UNIQUE, SEQ_IN_INDEX, INDEX_TYPE
		FROM information_schema.STATISTICS
		WHERE TABLE_SCHEMA = ? AND TABLE_NAME = ?
		ORDER BY INDEX_NAME, SEQ_IN_INDEX`
	rows, err := db.QueryContext(ctx, q, database, table)
	if err != nil {
		return nil, errno.Wrap(errno.CodeSQLFailed, "列出索引失败", err)
	}
	defer rows.Close()
	var list []model.IndexMetaDO
	for rows.Next() {
		var idx model.IndexMetaDO
		var nonUnique int
		if err := rows.Scan(&idx.Name, &idx.Column, &nonUnique, &idx.SeqInIndex, &idx.IndexType); err != nil {
			return nil, err
		}
		idx.NonUnique = nonUnique != 0
		list = append(list, idx)
	}
	return list, nil
}

// ListColumns 列出列。
func (a *Adapter) ListColumns(ctx context.Context, db *sql.DB, database, table string) ([]model.ColumnMetaDO, error) {
	return fetchColumns(ctx, db, database, table)
}

// GetTableDDL 获取 DDL。
func (a *Adapter) GetTableDDL(ctx context.Context, db *sql.DB, database, table string) (string, error) {
	row := db.QueryRowContext(ctx, fmt.Sprintf("SHOW CREATE TABLE `%s`.`%s`", escapeIdent(database), escapeIdent(table)))
	var tbl, ddl string
	if err := row.Scan(&tbl, &ddl); err != nil {
		return "", errno.Wrap(errno.CodeSQLFailed, "获取 DDL 失败", err)
	}
	return ddl, nil
}

// Execute 执行非查询。
func (a *Adapter) Execute(ctx context.Context, db *sql.DB, database, sqlText string) (*model.ExecuteResultDO, error) {
	start := time.Now()
	conn, err := db.Conn(ctx)
	if err != nil {
		return nil, err
	}
	defer conn.Close()
	if database != "" {
		if _, err := conn.ExecContext(ctx, "USE `"+escapeIdent(database)+"`"); err != nil {
			return nil, errno.Wrap(errno.CodeSQLFailed, "切换数据库失败", err)
		}
	}
	res, err := conn.ExecContext(ctx, sqlText)
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
func (a *Adapter) QueryPage(ctx context.Context, db *sql.DB, database, sqlText string, page, pageSize int) (*model.QueryPageDO, error) {
	if page < 1 {
		page = 1
	}
	if pageSize < 1 || pageSize > 500 {
		pageSize = 200
	}
	sqlText = trimSQLSemicolon(sqlText)
	start := time.Now()
	conn, err := db.Conn(ctx)
	if err != nil {
		return nil, err
	}
	defer conn.Close()
	if database != "" {
		if _, err := conn.ExecContext(ctx, "USE `"+escapeIdent(database)+"`"); err != nil {
			return nil, errno.Wrap(errno.CodeSQLFailed, "切换数据库失败", err)
		}
	}
	if canWrapAsSubquery(sqlText) {
		return queryPageWrapped(ctx, conn, sqlText, page, pageSize, start)
	}
	return queryPageFullScan(ctx, conn, sqlText, page, pageSize, start)
}

// queryPageWrapped 子查询包装实现服务端分页。
func queryPageWrapped(ctx context.Context, conn *sql.Conn, sqlText string, page, pageSize int, start time.Time) (*model.QueryPageDO, error) {
	var total int64
	countSQL := fmt.Sprintf("SELECT COUNT(*) FROM (%s) AS _wn_cnt", sqlText)
	if err := conn.QueryRowContext(ctx, countSQL).Scan(&total); err != nil {
		return nil, errno.Wrap(errno.CodeSQLFailed, "统计行数失败", err)
	}
	offset := (page - 1) * pageSize
	pageSQL := fmt.Sprintf("SELECT * FROM (%s) AS _wn_q LIMIT %d OFFSET %d", sqlText, pageSize, offset)
	rows, err := conn.QueryContext(ctx, pageSQL)
	if err != nil {
		return nil, errno.Wrap(errno.CodeSQLFailed, "查询失败", err)
	}
	defer rows.Close()
	pageRows, colMeta, err := readQueryRows(rows)
	if err != nil {
		return nil, err
	}
	return &model.QueryPageDO{
		Columns:   colMeta,
		Rows:      pageRows,
		Page:      page,
		PageSize:  pageSize,
		Total:     total,
		ElapsedMs: time.Since(start).Milliseconds(),
	}, nil
}

// queryPageFullScan 无法子查询包装时全量读取再分页（适用于 SHOW/DESC 等小结果集）。
func queryPageFullScan(ctx context.Context, conn *sql.Conn, sqlText string, page, pageSize int, start time.Time) (*model.QueryPageDO, error) {
	rows, err := conn.QueryContext(ctx, sqlText)
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
		Columns:   colMeta,
		Rows:      pageRows,
		Page:      page,
		PageSize:  pageSize,
		Total:     total,
		ElapsedMs: time.Since(start).Milliseconds(),
	}, nil
}

// readQueryRows 读取查询结果行与列元数据。
func readQueryRows(rows *sql.Rows) ([]model.QueryRowDO, []model.ColumnMetaDO, error) {
	cols, err := rows.Columns()
	if err != nil {
		return nil, nil, err
	}
	colTypes, _ := rows.ColumnTypes()
	colMeta := buildColumnMeta(cols, colTypes)
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

// trimSQLSemicolon 去掉末尾分号。
func trimSQLSemicolon(sql string) string {
	return strings.TrimSuffix(strings.TrimSpace(sql), ";")
}

// canWrapAsSubquery 判断 SQL 是否可包装为子查询分页。
func canWrapAsSubquery(sql string) bool {
	upper := strings.ToUpper(strings.TrimSpace(sql))
	for _, p := range []string{"SHOW ", "DESC ", "DESCRIBE ", "EXPLAIN "} {
		if strings.HasPrefix(upper, p) {
			return false
		}
	}
	return true
}

// QueryTablePage 分页查表（支持筛选与排序）。
func (a *Adapter) QueryTablePage(ctx context.Context, db *sql.DB, database, table string, q model.TableDataQueryDO) (*model.TableDataPageDO, error) {
	page := q.Page
	pageSize := q.PageSize
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
		if isBlobType(columns[i].DataType) {
			columns[i].Editable = false
		} else {
			columns[i].Editable = hasPK
		}
	}
	tbl := fmt.Sprintf("`%s`.`%s`", escapeIdent(database), escapeIdent(table))
	var total int64
	countSQL := "SELECT COUNT(*) FROM " + tbl + whereSQL
	if err := db.QueryRowContext(ctx, countSQL, whereArgs...).Scan(&total); err != nil {
		total = -1
	}
	offset := (page - 1) * pageSize
	dataSQL := "SELECT * FROM " + tbl + whereSQL + orderSQL + fmt.Sprintf(" LIMIT %d OFFSET %d", pageSize, offset)
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
		Columns:       columns,
		Rows:          result,
		Page:          page,
		PageSize:      pageSize,
		Total:         total,
		HasPrimaryKey: hasPK,
		ReadOnly:      readOnly,
		ElapsedMs:     time.Since(start).Milliseconds(),
	}, nil
}

// ApplyMutations 应用变更。
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
	if _, err := tx.ExecContext(ctx, "USE `"+escapeIdent(database)+"`"); err != nil {
		return errno.Wrap(errno.CodeMutationFailed, "切换数据库失败", err)
	}
	tbl := escapeIdent(table)
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
	q := `SELECT COLUMN_NAME, DATA_TYPE, COLUMN_TYPE, IS_NULLABLE, COLUMN_KEY,
		IFNULL(EXTRA,''), COLUMN_DEFAULT, IFNULL(COLUMN_COMMENT,'')
		FROM information_schema.COLUMNS
		WHERE TABLE_SCHEMA = ? AND TABLE_NAME = ? ORDER BY ORDINAL_POSITION`
	rows, err := db.QueryContext(ctx, q, database, table)
	if err != nil {
		return nil, errno.Wrap(errno.CodeSQLFailed, "列出列失败", err)
	}
	defer rows.Close()
	var list []model.ColumnMetaDO
	for rows.Next() {
		var c model.ColumnMetaDO
		var nullable, colKey string
		var def sql.NullString
		if err := rows.Scan(&c.Name, &c.DataType, &c.ColumnType, &nullable, &colKey, &c.Extra, &def, &c.Comment); err != nil {
			return nil, err
		}
		c.Nullable = nullable == "YES"
		c.IsPrimaryKey = colKey == "PRI"
		if def.Valid {
			v := def.String
			c.DefaultValue = &v
		}
		c.Editable = !isBlobType(c.DataType)
		list = append(list, c)
	}
	return list, nil
}

func execDelete(ctx context.Context, tx *sql.Tx, table string, pkCols []string, m model.RowMutationDO) error {
	where, args := pkWhere(pkCols, m.OldPK, m.Fields)
	if len(where) == 0 {
		return errno.New(errno.CodeInvalidArg, "删除缺少主键", "")
	}
	sqlText := fmt.Sprintf("DELETE FROM `%s` WHERE %s", table, strings.Join(where, " AND "))
	_, err := tx.ExecContext(ctx, sqlText, args...)
	if err != nil {
		return errno.Wrap(errno.CodeMutationFailed, "删除行失败", err)
	}
	return nil
}

func execUpdate(ctx context.Context, tx *sql.Tx, table string, pkCols []string, columns []model.ColumnMetaDO, m model.RowMutationDO) error {
	pkSet := make(map[string]bool)
	for _, p := range pkCols {
		pkSet[p] = true
	}
	var sets []string
	var args []interface{}
	vals := fieldsToMap(m.Fields)
	for _, col := range columns {
		if pkSet[col.Name] || !col.Editable {
			continue
		}
		fv, ok := vals[col.Name]
		if !ok {
			continue
		}
		sets = append(sets, fmt.Sprintf("`%s`=?", escapeIdent(col.Name)))
		args = append(args, nullableArg(fv))
	}
	if len(sets) == 0 {
		return nil
	}
	where, wargs := pkWhere(pkCols, m.OldPK, m.Fields)
	args = append(args, wargs...)
	sqlText := fmt.Sprintf("UPDATE `%s` SET %s WHERE %s", table, strings.Join(sets, ","), strings.Join(where, " AND "))
	_, err := tx.ExecContext(ctx, sqlText, args...)
	if err != nil {
		return errno.Wrap(errno.CodeMutationFailed, "更新行失败", err)
	}
	return nil
}

func execInsert(ctx context.Context, tx *sql.Tx, table string, columns []model.ColumnMetaDO, m model.RowMutationDO) error {
	var names []string
	var placeholders []string
	var args []interface{}
	vals := fieldsToMap(m.Fields)
	for _, col := range columns {
		if col.IsPrimaryKey && isAutoIncrement(col.ColumnType) {
			if fv, ok := vals[col.Name]; !ok || fv.IsNull || fv.Value == nil || *fv.Value == "" {
				continue
			}
		}
		fv, ok := vals[col.Name]
		if !ok {
			if !col.Nullable && col.DefaultValue == nil {
				return errno.New(errno.CodeInvalidArg, fmt.Sprintf("字段 %s 不能为空", col.Name), "")
			}
			continue
		}
		names = append(names, "`"+escapeIdent(col.Name)+"`")
		placeholders = append(placeholders, "?")
		args = append(args, nullableArg(fv))
	}
	if len(names) == 0 {
		return errno.New(errno.CodeInvalidArg, "插入无有效字段", "")
	}
	sqlText := fmt.Sprintf("INSERT INTO `%s` (%s) VALUES (%s)", table, strings.Join(names, ","), strings.Join(placeholders, ","))
	_, err := tx.ExecContext(ctx, sqlText, args...)
	if err != nil {
		return errno.Wrap(errno.CodeMutationFailed, "插入行失败", err)
	}
	return nil
}

func isAutoIncrement(columnType string) bool {
	return strings.Contains(strings.ToLower(columnType), "auto_increment")
}

func pkWhere(pkCols []string, oldPK, fields []model.FieldValueDO) ([]string, []interface{}) {
	var where []string
	var args []interface{}
	src := fieldsToMap(fields)
	if len(oldPK) > 0 {
		src = fieldsToMap(oldPK)
	}
	for _, col := range pkCols {
		fv, ok := src[col]
		if !ok {
			continue
		}
		if fv.IsNull || fv.Value == nil {
			where = append(where, fmt.Sprintf("`%s` IS NULL", escapeIdent(col)))
		} else {
			where = append(where, fmt.Sprintf("`%s`=?", escapeIdent(col)))
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

func buildColumnMeta(names []string, types []*sql.ColumnType) []model.ColumnMetaDO {
	out := make([]model.ColumnMetaDO, len(names))
	for i, name := range names {
		out[i].Name = name
		out[i].Editable = true
		if i < len(types) && types[i] != nil {
			out[i].DataType = types[i].DatabaseTypeName()
			out[i].ColumnType = types[i].DatabaseTypeName()
		}
	}
	return out
}

func isBlobType(dt string) bool {
	dt = strings.ToLower(dt)
	return dt == "blob" || dt == "mediumblob" || dt == "longblob" || dt == "tinyblob" || dt == "binary" || dt == "varbinary"
}

func escapeIdent(s string) string {
	return strings.ReplaceAll(s, "`", "``")
}

func defaultCharset(c string) string {
	if c == "" {
		return "utf8mb4"
	}
	return c
}

func splitAddr(addr string, defaultPort int) (string, int) {
	if strings.Contains(addr, ":") {
		parts := strings.Split(addr, ":")
		host := parts[0]
		port := defaultPort
		if len(parts) > 1 {
			fmt.Sscanf(parts[1], "%d", &port)
		}
		return host, port
	}
	return addr, defaultPort
}

// ExportTableInsertSQL 导出表数据为 INSERT 语句。
func (a *Adapter) ExportTableInsertSQL(ctx context.Context, db *sql.DB, database, table string, maxRows int) (string, error) {
	page, err := a.QueryTablePage(ctx, db, database, table, model.TableDataQueryDO{
		Page: 1, PageSize: maxRows,
	})
	if err != nil {
		return "", err
	}
	if len(page.Rows) == 0 {
		return fmt.Sprintf("-- %s.%s 无数据\n", database, table), nil
	}
	colNames := make([]string, len(page.Columns))
	for i, c := range page.Columns {
		colNames[i] = c.Name
	}
	var b strings.Builder
	b.WriteString(fmt.Sprintf("-- %s.%s INSERT (%d rows)\n", database, table, len(page.Rows)))
	tbl := fmt.Sprintf("`%s`.`%s`", escapeIdent(database), escapeIdent(table))
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
			cols[i] = "`" + escapeIdent(n) + "`"
		}
		b.WriteString(fmt.Sprintf("INSERT INTO %s (%s) VALUES (%s);\n",
			tbl, strings.Join(cols, ","), strings.Join(vals, ",")))
	}
	return b.String(), nil
}

// quoteSQLString 转义 SQL 字符串字面量。
func quoteSQLString(s string) string {
	return "'" + strings.ReplaceAll(s, "'", "''") + "'"
}

// Register 注册到全局（由 main 调用）。
func Register(r *adapter.Registry) {
	r.Register(New())
}
