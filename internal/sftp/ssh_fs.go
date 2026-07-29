package sftp

import (
	"context"
	"io"
	"os"
	"path"
	"path/filepath"

	"WWorkbench/internal/errno"
	"WWorkbench/internal/model"

	pkgsftp "github.com/pkg/sftp"
	"golang.org/x/crypto/ssh"
)

type sshFS struct {
	ssh  *ssh.Client
	sftp *pkgsftp.Client
}

func newSSHFS(sshClient *ssh.Client, sftpClient *pkgsftp.Client) *sshFS {
	return &sshFS{ssh: sshClient, sftp: sftpClient}
}

func (f *sshFS) Close() {
	if f.sftp != nil {
		_ = f.sftp.Close()
	}
	if f.ssh != nil {
		_ = f.ssh.Close()
	}
}

func (f *sshFS) Home() (string, error) {
	wd, err := f.sftp.Getwd()
	if err == nil && wd != "" {
		return cleanRemotePath(wd), nil
	}
	home, err := f.sftp.RealPath(".")
	if err != nil {
		return "/", errno.Wrap(errno.CodeConnFailed, "获取远程目录失败", err)
	}
	return cleanRemotePath(home), nil
}

func (f *sshFS) ListDir(dir string) ([]model.FileEntryDO, error) {
	dir = cleanRemotePath(dir)
	entries, err := f.sftp.ReadDir(dir)
	if err != nil {
		return nil, errno.Wrap(errno.CodeConnFailed, "读取远程目录失败", err)
	}
	out := make([]model.FileEntryDO, 0, len(entries))
	for _, ent := range entries {
		name := ent.Name()
		if name == "." {
			continue
		}
		out = append(out, model.FileEntryDO{
			Name:    name,
			Path:    path.Join(dir, name),
			IsDir:   ent.IsDir(),
			Size:    ent.Size(),
			ModTime: ent.ModTime().Unix(),
		})
	}
	sortFileEntries(out)
	return out, nil
}

func (f *sshFS) Stat(p string) (*remoteStat, error) {
	info, err := f.sftp.Stat(cleanRemotePath(p))
	if err != nil {
		return nil, err
	}
	return &remoteStat{
		Name:    info.Name(),
		Size:    info.Size(),
		ModTime: info.ModTime().Unix(),
		IsDir:   info.IsDir(),
	}, nil
}

func (f *sshFS) MkdirAll(dir string) error {
	if err := f.sftp.MkdirAll(cleanRemotePath(dir)); err != nil {
		return errno.Wrap(errno.CodeConnFailed, "创建远程目录失败", err)
	}
	return nil
}

func (f *sshFS) Rename(oldPath, newPath string) error {
	if err := f.sftp.Rename(cleanRemotePath(oldPath), cleanRemotePath(newPath)); err != nil {
		return errno.Wrap(errno.CodeConnFailed, "重命名远程路径失败", err)
	}
	return nil
}

func (f *sshFS) Remove(p string) error {
	p = cleanRemotePath(p)
	info, err := f.sftp.Stat(p)
	if err != nil {
		return errno.Wrap(errno.CodeConnFailed, "读取远程路径失败", err)
	}
	if info.IsDir() {
		if err := f.sftp.RemoveDirectory(p); err != nil {
			return errno.Wrap(errno.CodeConnFailed, "删除远程目录失败", err)
		}
		return nil
	}
	if err := f.sftp.Remove(p); err != nil {
		return errno.Wrap(errno.CodeConnFailed, "删除远程文件失败", err)
	}
	return nil
}

func (f *sshFS) RemoveAll(remotePath string) error {
	remotePath = cleanRemotePath(remotePath)
	info, err := f.sftp.Stat(remotePath)
	if err != nil {
		return errno.Wrap(errno.CodeConnFailed, "读取远程路径失败", err)
	}
	if !info.IsDir() {
		return f.Remove(remotePath)
	}
	var dirs []string
	if err := f.Walk(remotePath, func(rPath string, isDir bool) error {
		if isDir {
			dirs = append(dirs, rPath)
			return nil
		}
		return f.sftp.Remove(rPath)
	}); err != nil {
		return err
	}
	for i := len(dirs) - 1; i >= 0; i-- {
		if err := f.sftp.RemoveDirectory(dirs[i]); err != nil {
			return errno.Wrap(errno.CodeConnFailed, "删除远程目录失败", err)
		}
	}
	return nil
}

func (f *sshFS) Walk(dir string, fn func(path string, isDir bool) error) error {
	entries, err := f.sftp.ReadDir(dir)
	if err != nil {
		return err
	}
	for _, ent := range entries {
		name := ent.Name()
		if name == "." || name == ".." {
			continue
		}
		full := path.Join(dir, name)
		isDir := ent.IsDir()
		if isDir {
			if err := f.Walk(full, fn); err != nil {
				return err
			}
		}
		if err := fn(full, isDir); err != nil {
			return err
		}
	}
	return nil
}

func (f *sshFS) OpenTransfer() (remoteFS, error) {
	client, err := pkgsftp.NewClient(f.ssh)
	if err != nil {
		return nil, errno.Wrap(errno.CodeConnFailed, "创建传输 SFTP 客户端失败", err)
	}
	return &sshFS{ssh: nil, sftp: client}, nil
}

func (f *sshFS) UploadFile(ctx context.Context, localPath, remotePath string, onProgress func(done, total int64)) error {
	src, err := os.Open(localPath)
	if err != nil {
		return errno.Wrap(errno.CodeInvalidArg, "打开本地文件失败", err)
	}
	defer src.Close()
	info, err := src.Stat()
	if err != nil {
		return err
	}
	total := info.Size()
	if onProgress != nil {
		onProgress(0, total)
	}
	if err := f.MkdirAll(path.Dir(remotePath)); err != nil {
		return err
	}
	dst, err := f.sftp.Create(cleanRemotePath(remotePath))
	if err != nil {
		return errno.Wrap(errno.CodeConnFailed, "创建远程文件失败", err)
	}
	defer dst.Close()
	done, err := copyWithProgress(ctx, dst, src, func(n int64) {
		if onProgress != nil {
			onProgress(n, total)
		}
	})
	if err != nil {
		if ctx.Err() != nil {
			return errno.Wrap(errno.CodeInvalidArg, "上传已取消", ctx.Err())
		}
		return errno.Wrap(errno.CodeConnFailed, "上传文件失败", err)
	}
	_ = done
	if onProgress != nil {
		onProgress(total, total)
	}
	return nil
}

func (f *sshFS) DownloadFile(ctx context.Context, remotePath, localPath string, onProgress func(done, total int64)) error {
	src, err := f.sftp.Open(cleanRemotePath(remotePath))
	if err != nil {
		return errno.Wrap(errno.CodeConnFailed, "打开远程文件失败", err)
	}
	defer src.Close()
	info, err := src.Stat()
	if err != nil {
		return err
	}
	total := info.Size()
	if onProgress != nil {
		onProgress(0, total)
	}
	if err := os.MkdirAll(filepath.Dir(localPath), 0o755); err != nil {
		return errno.Wrap(errno.CodeStoreFailed, "创建本地目录失败", err)
	}
	dst, err := os.Create(localPath)
	if err != nil {
		return errno.Wrap(errno.CodeStoreFailed, "创建本地文件失败", err)
	}
	defer dst.Close()
	done, err := copyWithProgress(ctx, dst, src, func(n int64) {
		if onProgress != nil {
			onProgress(n, total)
		}
	})
	if err != nil {
		if ctx.Err() != nil {
			return errno.Wrap(errno.CodeInvalidArg, "下载已取消", ctx.Err())
		}
		return errno.Wrap(errno.CodeConnFailed, "下载文件失败", err)
	}
	_ = done
	if onProgress != nil {
		onProgress(total, total)
	}
	return nil
}

// keep io import used for interface satisfaction in copy
var _ io.Reader = (*os.File)(nil)
