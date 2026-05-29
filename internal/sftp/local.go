package sftp

import (
	"os"
	"path/filepath"

	"WNavicat/internal/errno"
)

// MkdirLocal 创建本地目录。
func MkdirLocal(dir string) error {
	dir = filepath.Clean(dir)
	if err := os.MkdirAll(dir, 0o755); err != nil {
		return errno.Wrap(errno.CodeStoreFailed, "创建本地目录失败", err)
	}
	return nil
}

// RenameLocal 重命名本地路径。
func RenameLocal(oldPath, newPath string) error {
	oldPath = filepath.Clean(oldPath)
	newPath = filepath.Clean(newPath)
	if err := os.Rename(oldPath, newPath); err != nil {
		return errno.Wrap(errno.CodeInvalidArg, "重命名失败", err)
	}
	return nil
}

// DeleteLocal 删除本地文件或空目录。
func DeleteLocal(target string) error {
	target = filepath.Clean(target)
	info, err := os.Stat(target)
	if err != nil {
		return errno.Wrap(errno.CodeInvalidArg, "路径不存在", err)
	}
	if info.IsDir() {
		if err := os.Remove(target); err != nil {
			return errno.Wrap(errno.CodeStoreFailed, "删除目录失败", err)
		}
		return nil
	}
	if err := os.Remove(target); err != nil {
		return errno.Wrap(errno.CodeStoreFailed, "删除文件失败", err)
	}
	return nil
}
