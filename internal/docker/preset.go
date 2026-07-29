package docker

import (
	"crypto/rand"
	"encoding/hex"
	"strings"

	"WWorkbench/internal/model"
)

// GetContainerRunPreset 根据镜像名返回运行预设。
func GetContainerRunPreset(image string) model.ContainerRunPresetDO {
	image = strings.TrimSpace(image)
	if image == "" || image == "<none>" {
		return genericPreset("image")
	}
	lower := strings.ToLower(image)
	switch {
	case strings.Contains(lower, "mysql"), strings.Contains(lower, "mariadb"):
		return mysqlPreset(image)
	case strings.Contains(lower, "postgres"):
		return postgresPreset(image)
	case strings.Contains(lower, "redis"):
		return redisPreset(image)
	default:
		return genericPreset(image)
	}
}

// mysqlPreset MySQL / MariaDB 运行预设。
func mysqlPreset(image string) model.ContainerRunPresetDO {
	return model.ContainerRunPresetDO{
		Image:   image,
		Name:    suggestName("mysql"),
		Restart: "unless-stopped",
		Ports: []model.ContainerPortMappingDO{{
			HostPort: 3306, ContainerPort: 3306, Protocol: "tcp",
		}},
		EnvFields: []model.ContainerRunEnvFieldDO{
			{Key: "MYSQL_ROOT_PASSWORD", Placeholder: "root 密码", Required: true, Secret: true, Default: randomPassword(16)},
			{Key: "MYSQL_DATABASE", Placeholder: "可选，初始数据库名"},
			{Key: "MYSQL_USER", Placeholder: "可选，普通用户"},
			{Key: "MYSQL_PASSWORD", Placeholder: "可选，普通用户密码", Secret: true},
		},
	}
}

// postgresPreset PostgreSQL 运行预设。
func postgresPreset(image string) model.ContainerRunPresetDO {
	return model.ContainerRunPresetDO{
		Image:   image,
		Name:    suggestName("postgres"),
		Restart: "unless-stopped",
		Ports: []model.ContainerPortMappingDO{{
			HostPort: 5432, ContainerPort: 5432, Protocol: "tcp",
		}},
		EnvFields: []model.ContainerRunEnvFieldDO{
			{Key: "POSTGRES_PASSWORD", Placeholder: "超级用户密码", Required: true, Secret: true, Default: randomPassword(16)},
			{Key: "POSTGRES_USER", Placeholder: "超级用户名", Default: "postgres"},
			{Key: "POSTGRES_DB", Placeholder: "初始数据库名"},
		},
	}
}

// redisPreset Redis 运行预设。
func redisPreset(image string) model.ContainerRunPresetDO {
	return model.ContainerRunPresetDO{
		Image:   image,
		Name:    suggestName("redis"),
		Restart: "unless-stopped",
		Ports: []model.ContainerPortMappingDO{{
			HostPort: 6379, ContainerPort: 6379, Protocol: "tcp",
		}},
		EnvFields: []model.ContainerRunEnvFieldDO{
			{Key: "REDIS_PASSWORD", Placeholder: "可选，启用 requirepass", Secret: true},
		},
	}
}

// genericPreset 通用运行预设。
func genericPreset(image string) model.ContainerRunPresetDO {
	base := "app"
	if idx := strings.LastIndex(image, "/"); idx >= 0 {
		image = image[idx+1:]
	}
	if idx := strings.Index(image, ":"); idx > 0 {
		base = image[:idx]
	} else if image != "" {
		base = image
	}
	base = strings.Map(func(r rune) rune {
		if (r >= 'a' && r <= 'z') || (r >= '0' && r <= '9') || r == '-' {
			return r
		}
		return '-'
	}, strings.ToLower(base))
	return model.ContainerRunPresetDO{
		Image:     image,
		Name:      suggestName(base),
		Restart:   "unless-stopped",
		EnvFields: nil,
	}
}

// suggestName 生成建议容器名。
func suggestName(prefix string) string {
	return prefix + "-" + randomSuffix(4)
}

// randomSuffix 生成随机后缀。
func randomSuffix(n int) string {
	if n <= 0 {
		n = 4
	}
	buf := make([]byte, (n+1)/2)
	_, _ = rand.Read(buf)
	return hex.EncodeToString(buf)[:n]
}

// randomPassword 生成随机密码。
func randomPassword(n int) string {
	if n < 8 {
		n = 8
	}
	return randomSuffix(n)
}
