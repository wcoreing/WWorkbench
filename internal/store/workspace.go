package store

import (
	"os"
	"path/filepath"
	"strings"

	"WNavicat/internal/errno"
)

var allowedWorkspaces = map[string]bool{
	"database": true,
	"terminal": true,
	"sftp":     true,
	"docker":   true,
	"httpapi":  true,
	"logs":     true,
}

// LoadWorkspaceJSON 读取产品线工作区 JSON 快照。
func (s *Store) LoadWorkspaceJSON(product string) (string, error) {
	if !allowedWorkspaces[product] {
		return "", errno.New(errno.CodeInvalidArg, "未知工作区类型", product)
	}
	path := filepath.Join(s.dataDir, "workspaces", product+".json")
	data, err := os.ReadFile(path)
	if err != nil {
		if os.IsNotExist(err) {
			return "", nil
		}
		return "", errno.Wrap(errno.CodeStoreFailed, "读取工作区快照失败", err)
	}
	return string(data), nil
}

// SaveWorkspaceJSON 保存产品线工作区 JSON 快照。
func (s *Store) SaveWorkspaceJSON(product, content string) error {
	if !allowedWorkspaces[product] {
		return errno.New(errno.CodeInvalidArg, "未知工作区类型", product)
	}
	if strings.TrimSpace(content) == "" {
		return errno.New(errno.CodeInvalidArg, "工作区快照不能为空", product)
	}
	dir := filepath.Join(s.dataDir, "workspaces")
	if err := os.MkdirAll(dir, 0o700); err != nil {
		return errno.Wrap(errno.CodeStoreFailed, "创建工作区目录失败", err)
	}
	path := filepath.Join(dir, product+".json")
	tmp := path + ".tmp"
	if err := os.WriteFile(tmp, []byte(content), 0o600); err != nil {
		return errno.Wrap(errno.CodeStoreFailed, "写入工作区快照失败", err)
	}
	if err := os.Rename(tmp, path); err != nil {
		_ = os.Remove(tmp)
		return errno.Wrap(errno.CodeStoreFailed, "保存工作区快照失败", err)
	}
	return nil
}
