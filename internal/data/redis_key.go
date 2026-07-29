package data

import (
	"context"
	"fmt"
	"strings"
	"time"

	"WWorkbench/internal/model"
	"WWorkbench/internal/session"

	"github.com/google/uuid"
)

// redisKeyDataPage 读取 Redis 键值并展示为表数据。
func redisKeyDataPage(ctx context.Context, sess *session.Session, key string) (*model.TableDataPageDO, error) {
	start := time.Now()
	keyType, err := sess.Redis.Type(ctx, key).Result()
	if err != nil {
		return nil, err
	}
	cols := []model.ColumnMetaDO{
		{Name: "field", DataType: "text", ColumnType: "text", Editable: false},
		{Name: "value", DataType: "text", ColumnType: "text", Editable: false},
	}
	var rows []model.TableRowDO
	switch keyType {
	case "string":
		val, err := sess.Redis.Get(ctx, key).Result()
		if err != nil {
			return nil, err
		}
		rows = append(rows, redisRow("value", val))
	case "hash":
		vals, err := sess.Redis.HGetAll(ctx, key).Result()
		if err != nil {
			return nil, err
		}
		for f, v := range vals {
			rows = append(rows, redisRow(f, v))
		}
	case "list":
		vals, err := sess.Redis.LRange(ctx, key, 0, 199).Result()
		if err != nil {
			return nil, err
		}
		for i, v := range vals {
			rows = append(rows, redisRow(fmt.Sprintf("[%d]", i), v))
		}
	case "set":
		vals, err := sess.Redis.SMembers(ctx, key).Result()
		if err != nil {
			return nil, err
		}
		for _, v := range vals {
			rows = append(rows, redisRow("member", v))
		}
	case "zset":
		vals, err := sess.Redis.ZRangeWithScores(ctx, key, 0, 199).Result()
		if err != nil {
			return nil, err
		}
		for _, z := range vals {
			rows = append(rows, redisRow(fmt.Sprint(z.Member), fmt.Sprintf("%v", z.Score)))
		}
	default:
		rows = append(rows, redisRow("type", keyType))
		ttl, _ := sess.Redis.TTL(ctx, key).Result()
		rows = append(rows, redisRow("ttl", ttl.String()))
	}
	if rows == nil {
		rows = []model.TableRowDO{}
	}
	return &model.TableDataPageDO{
		Columns: cols, Rows: rows, Page: 1, PageSize: len(rows), Total: int64(len(rows)),
		ReadOnly: true, HasPrimaryKey: false, ElapsedMs: time.Since(start).Milliseconds(),
	}, nil
}

func redisRow(field, value string) model.TableRowDO {
	f, v := field, value
	return model.TableRowDO{
		RowID: uuid.NewString(),
		Values: map[string]model.CellValueDO{
			"field": {Value: &f, Display: f},
			"value": {Value: &v, Display: v},
		},
	}
}

// redisKeyPreview 格式化键预览（供导出等复用）。
func redisKeyPreview(ctx context.Context, sess *session.Session, key string) string {
	page, err := redisKeyDataPage(ctx, sess, key)
	if err != nil {
		return err.Error()
	}
	var b strings.Builder
	for _, row := range page.Rows {
		b.WriteString(row.Values["field"].Display)
		b.WriteString(": ")
		b.WriteString(row.Values["value"].Display)
		b.WriteByte('\n')
	}
	return b.String()
}
