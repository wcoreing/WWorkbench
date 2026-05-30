package redis

import (
	"context"
	"fmt"
	"strconv"
	"strings"
	"time"

	"WNavicat/internal/errno"
	"WNavicat/internal/model"
	"WNavicat/internal/tunnel"

	goredis "github.com/redis/go-redis/v9"
)

const dbType = "redis"

// OpenClient 打开 Redis 客户端（支持 SSH 隧道）。
func OpenClient(ctx context.Context, cfg model.ConnectionConfigDO, t tunnel.Tunnel) (*goredis.Client, error) {
	host, port := splitAddr(t.Addr(), defaultPort(cfg.Port))
	dbIndex, err := parseDBIndex(cfg.Database)
	if err != nil {
		return nil, err
	}
	opts := &goredis.Options{
		Addr:     fmt.Sprintf("%s:%d", host, port),
		Username: cfg.User,
		Password: cfg.Password,
		DB:       dbIndex,
	}
	client := goredis.NewClient(opts)
	pingCtx, cancel := context.WithTimeout(ctx, 15*time.Second)
	defer cancel()
	if err := client.Ping(pingCtx).Err(); err != nil {
		_ = client.Close()
		return nil, errno.Wrap(errno.CodeConnFailed, "连接 Redis 失败", err)
	}
	return client, nil
}

// Ping 测试 Redis 连接。
func Ping(ctx context.Context, client *goredis.Client) error {
	if err := client.Ping(ctx).Err(); err != nil {
		return errno.Wrap(errno.CodeConnFailed, "Ping 失败", err)
	}
	return nil
}

// ListDBIndexes 返回可选逻辑库编号列表（0-15）。
func ListDBIndexes() []string {
	out := make([]string, 16)
	for i := 0; i < 16; i++ {
		out[i] = strconv.Itoa(i)
	}
	return out
}

// ScanKeys 使用 SCAN 游标分批扫描键名（上限 maxKeys）。
func ScanKeys(ctx context.Context, client *goredis.Client, pattern string, maxKeys int) ([]string, error) {
	if maxKeys <= 0 {
		maxKeys = 500
	}
	if maxKeys > 5000 {
		maxKeys = 5000
	}
	if pattern == "" {
		pattern = "*"
	}
	var keys []string
	cursor := uint64(0)
	const batch = int64(200)
	for len(keys) < maxKeys {
		n := batch
		if remain := maxKeys - len(keys); int64(remain) < n {
			n = int64(remain)
		}
		batchKeys, next, err := client.Scan(ctx, cursor, pattern, n).Result()
		if err != nil {
			return nil, errno.Wrap(errno.CodeSQLFailed, "扫描键失败", err)
		}
		keys = append(keys, batchKeys...)
		cursor = next
		if next == 0 {
			break
		}
	}
	return keys, nil
}

// ExecuteCommand 执行 Redis 命令并返回文本结果。
func ExecuteCommand(ctx context.Context, client *goredis.Client, line string) (interface{}, error) {
	line = strings.TrimSpace(line)
	if line == "" {
		return nil, errno.New(errno.CodeInvalidArg, "命令不能为空", "")
	}
	parts := splitCommand(line)
	if len(parts) == 0 {
		return nil, errno.New(errno.CodeInvalidArg, "命令不能为空", "")
	}
	cmd := strings.ToUpper(parts[0])
	args := make([]interface{}, len(parts)-1)
	for i, a := range parts[1:] {
		args[i] = a
	}
	start := time.Now()
	res := client.Do(ctx, append([]interface{}{cmd}, args...)...)
	if err := res.Err(); err != nil {
		return nil, errno.Wrap(errno.CodeSQLFailed, "执行 Redis 命令失败", err)
	}
	text, err := formatRedisResult(res)
	if err != nil {
		return nil, err
	}
	if isQueryLike(cmd) {
		return buildQueryPage(text, time.Since(start).Milliseconds()), nil
	}
	return &model.ExecuteResultDO{
		Message:   text,
		ElapsedMs: time.Since(start).Milliseconds(),
	}, nil
}

func isQueryLike(cmd string) bool {
	switch cmd {
	case "GET", "HGET", "HGETALL", "LRANGE", "SMEMBERS", "ZRANGE", "KEYS", "SCAN", "INFO", "TTL", "TYPE", "EXISTS":
		return true
	default:
		return false
	}
}

func buildQueryPage(text string, elapsed int64) *model.QueryPageDO {
	lines := strings.Split(text, "\n")
	rows := make([]model.QueryRowDO, 0, len(lines))
	for _, line := range lines {
		if line == "" {
			continue
		}
		v := line
		rows = append(rows, model.QueryRowDO{Cells: []model.CellValueDO{{Value: &v, Display: v}}})
	}
	return &model.QueryPageDO{
		Columns:   []model.ColumnMetaDO{{Name: "result", Editable: false}},
		Rows:      rows,
		Page:      1,
		PageSize:  len(rows),
		Total:     int64(len(rows)),
		ElapsedMs: elapsed,
	}
}

func formatRedisResult(res *goredis.Cmd) (string, error) {
	val, err := res.Result()
	if err != nil {
		return "", err
	}
	switch v := val.(type) {
	case nil:
		return "(nil)", nil
	case string:
		return v, nil
	case []byte:
		return string(v), nil
	case int64:
		return strconv.FormatInt(v, 10), nil
	case []interface{}:
		var b strings.Builder
		for i, item := range v {
			if i > 0 {
				b.WriteByte('\n')
			}
			b.WriteString(fmt.Sprint(item))
		}
		return b.String(), nil
	case map[interface{}]interface{}:
		var b strings.Builder
		for k, item := range v {
			if b.Len() > 0 {
				b.WriteByte('\n')
			}
			b.WriteString(fmt.Sprintf("%v: %v", k, item))
		}
		return b.String(), nil
	default:
		return fmt.Sprint(v), nil
	}
}

func splitCommand(line string) []string {
	var parts []string
	var cur strings.Builder
	inQuote := false
	quote := byte(0)
	for i := 0; i < len(line); i++ {
		c := line[i]
		if inQuote {
			if c == quote {
				inQuote = false
			} else {
				cur.WriteByte(c)
			}
			continue
		}
		if c == '"' || c == '\'' {
			inQuote = true
			quote = c
			continue
		}
		if c == ' ' || c == '\t' {
			if cur.Len() > 0 {
				parts = append(parts, cur.String())
				cur.Reset()
			}
			continue
		}
		cur.WriteByte(c)
	}
	if cur.Len() > 0 {
		parts = append(parts, cur.String())
	}
	return parts
}

func parseDBIndex(db string) (int, error) {
	db = strings.TrimSpace(db)
	if db == "" {
		return 0, nil
	}
	n, err := strconv.Atoi(db)
	if err != nil || n < 0 || n > 15 {
		return 0, errno.New(errno.CodeInvalidArg, "Redis DB 编号应为 0-15", db)
	}
	return n, nil
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

func defaultPort(port int) int {
	if port <= 0 {
		return 6379
	}
	return port
}
