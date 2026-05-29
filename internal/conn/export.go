package conn

import (
	"encoding/json"
	"strings"

	"WNavicat/internal/errno"
	"WNavicat/internal/model"

	"github.com/google/uuid"
)

const connectionsExportVersion = "1"

// ExportConnections 导出连接配置为 JSON。
func (s *Service) ExportConnections(includeSecrets bool) (string, error) {
	list, err := s.store.ListConnections()
	if err != nil {
		return "", err
	}
	out := make([]model.ConnectionDO, len(list))
	for i, c := range list {
		out[i] = c
		if !includeSecrets {
			StripSecrets(&out[i])
		}
	}
	pack := model.ConnectionsExportDO{
		Version:     connectionsExportVersion,
		Connections: out,
	}
	data, err := json.MarshalIndent(pack, "", "  ")
	if err != nil {
		return "", errno.Wrap(errno.CodeStoreFailed, "序列化连接失败", err)
	}
	return string(data), nil
}

// ImportConnections 从 JSON 导入连接（按 ID 覆盖）。
func (s *Service) ImportConnections(jsonText string) (int, error) {
	jsonText = strings.TrimSpace(jsonText)
	if jsonText == "" {
		return 0, errno.New(errno.CodeInvalidArg, "导入内容为空", "")
	}
	var pack model.ConnectionsExportDO
	if err := json.Unmarshal([]byte(jsonText), &pack); err != nil {
		return 0, errno.Wrap(errno.CodeInvalidArg, "解析连接 JSON 失败", err)
	}
	if len(pack.Connections) == 0 {
		return 0, errno.New(errno.CodeInvalidArg, "无有效连接", "")
	}
	count := 0
	for _, c := range pack.Connections {
		if c.Name == "" || c.Host == "" || c.User == "" {
			continue
		}
		if c.ID == "" {
			c.ID = uuid.NewString()
		}
		if c.DbType == "" {
			c.DbType = "mysql"
		}
		if err := s.store.SaveConnection(c); err != nil {
			return count, err
		}
		count++
	}
	return count, nil
}
