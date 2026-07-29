package sftp

import (
	"context"

	"WWorkbench/internal/model"
)

// remoteStat 远程路径状态。
type remoteStat struct {
	Name    string
	Size    int64
	ModTime int64
	IsDir   bool
}

// remoteFS 远程文件系统抽象（SSH SFTP 或 Docker 容器）。
type remoteFS interface {
	Close()
	Home() (string, error)
	ListDir(dir string) ([]model.FileEntryDO, error)
	Stat(path string) (*remoteStat, error)
	MkdirAll(dir string) error
	Rename(oldPath, newPath string) error
	Remove(path string) error
	RemoveAll(path string) error
	UploadFile(ctx context.Context, localPath, remotePath string, onProgress func(done, total int64)) error
	DownloadFile(ctx context.Context, remotePath, localPath string, onProgress func(done, total int64)) error
	Walk(dir string, fn func(path string, isDir bool) error) error
	OpenTransfer() (remoteFS, error)
}
