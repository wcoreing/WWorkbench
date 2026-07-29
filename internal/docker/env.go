package docker

import (
	"context"
	"sort"
	"strings"

	"WWorkbench/internal/errno"
	"WWorkbench/internal/model"
)

var envHighlightKeys = map[string]bool{
	"MYSQL_ROOT_PASSWORD":      true,
	"MYSQL_PASSWORD":           true,
	"MYSQL_USER":               true,
	"MYSQL_DATABASE":           true,
	"MARIADB_ROOT_PASSWORD":    true,
	"MARIADB_PASSWORD":         true,
	"MARIADB_USER":             true,
	"MARIADB_DATABASE":         true,
	"POSTGRES_PASSWORD":        true,
	"POSTGRES_USER":            true,
	"POSTGRES_DB":              true,
	"MONGO_INITDB_ROOT_PASSWORD": true,
	"MONGO_INITDB_ROOT_USERNAME": true,
}

// GetContainerEnv 读取容器启动时配置的环境变量。
func (m *Manager) GetContainerEnv(ctx context.Context, contextID, containerID string) (*model.ContainerEnvDO, error) {
	handle, err := m.openClient(ctx, contextID)
	if err != nil {
		return nil, err
	}
	defer handle.close()

	inspect, err := handle.client.ContainerInspect(ctx, containerID)
	if err != nil {
		return nil, errno.Wrap(errno.CodeConnFailed, "读取容器信息失败", err)
	}
	return &model.ContainerEnvDO{Vars: formatContainerEnv(inspect.Config.Env)}, nil
}

// formatContainerEnv 格式化并排序容器环境变量。
func formatContainerEnv(raw []string) []model.ContainerEnvVarDO {
	if len(raw) == 0 {
		return nil
	}
	out := make([]model.ContainerEnvVarDO, 0, len(raw))
	for _, item := range raw {
		key, value, ok := strings.Cut(item, "=")
		if !ok || key == "" {
			continue
		}
		out = append(out, model.ContainerEnvVarDO{
			Key:       key,
			Value:     value,
			Highlight: isEnvHighlight(key),
		})
	}
	sort.Slice(out, func(i, j int) bool {
		hi, hj := out[i].Highlight, out[j].Highlight
		if hi != hj {
			return hi
		}
		return out[i].Key < out[j].Key
	})
	return out
}

// isEnvHighlight 判断是否为数据库相关环境变量。
func isEnvHighlight(key string) bool {
	if envHighlightKeys[key] {
		return true
	}
	upper := strings.ToUpper(key)
	return strings.Contains(upper, "PASSWORD") || strings.Contains(upper, "SECRET")
}

// envToMap 将 KEY=VALUE 列表转为 map。
func envToMap(raw []string) map[string]string {
	m := make(map[string]string, len(raw))
	for _, item := range raw {
		key, value, ok := strings.Cut(item, "=")
		if !ok || key == "" {
			continue
		}
		m[key] = value
	}
	return m
}

// dbCredentialsFromEnv 从环境变量解析数据库账号信息。
func dbCredentialsFromEnv(env map[string]string, dbType string) (user, password, database string) {
	switch dbType {
	case "postgresql":
		password = env["POSTGRES_PASSWORD"]
		if u := env["POSTGRES_USER"]; u != "" {
			user = u
		}
		database = env["POSTGRES_DB"]
	case "mysql":
		if p := env["MYSQL_ROOT_PASSWORD"]; p != "" {
			password = p
			user = "root"
		} else if p := env["MYSQL_PASSWORD"]; p != "" {
			password = p
			if u := env["MYSQL_USER"]; u != "" {
				user = u
			}
		}
		if p := env["MARIADB_ROOT_PASSWORD"]; p != "" && password == "" {
			password = p
			user = "root"
		} else if p := env["MARIADB_PASSWORD"]; p != "" && password == "" {
			password = p
			if u := env["MARIADB_USER"]; u != "" {
				user = u
			}
		}
		if db := env["MYSQL_DATABASE"]; db != "" {
			database = db
		} else if db := env["MARIADB_DATABASE"]; db != "" {
			database = db
		}
	}
	return user, password, database
}
