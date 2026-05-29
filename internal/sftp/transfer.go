package sftp

import (
	"context"
	"io"
	"os"
	"path"
	"path/filepath"
	"strings"

	"WNavicat/internal/errno"
	"WNavicat/internal/model"

	pkgsftp "github.com/pkg/sftp"
)

// UploadPath 上传本地文件或目录到远程目录。
func (m *Manager) UploadPath(ctx context.Context, sessionID, taskID, localPath, remoteDir string, emit ProgressHandler) error {
	ctx, done := m.bindTransferCtx(ctx, taskID)
	defer done()

	s, err := m.get(sessionID)
	if err != nil {
		return err
	}
	client, err := s.openTransferClient()
	if err != nil {
		return err
	}
	defer client.Close()

	info, err := os.Stat(localPath)
	if err != nil {
		return errno.Wrap(errno.CodeInvalidArg, "本地路径不存在", err)
	}
	remoteDir = cleanRemotePath(remoteDir)
	if !info.IsDir() {
		remotePath := path.Join(remoteDir, filepath.Base(localPath))
		return m.uploadFile(ctx, client, sessionID, taskID, localPath, remotePath, emit)
	}
	base := filepath.Base(localPath)
	remoteBase := path.Join(remoteDir, base)
	if err := mkdirRemote(client, remoteBase); err != nil {
		return err
	}
	return filepath.Walk(localPath, func(p string, fi os.FileInfo, walkErr error) error {
		if walkErr != nil {
			return walkErr
		}
		if err := ctx.Err(); err != nil {
			return err
		}
		if fi.IsDir() {
			rel, err := filepath.Rel(localPath, p)
			if err != nil {
				return err
			}
			if rel == "." {
				return nil
			}
			return mkdirRemote(client, path.Join(remoteBase, filepath.ToSlash(rel)))
		}
		rel, err := filepath.Rel(localPath, p)
		if err != nil {
			return err
		}
		return m.uploadFile(ctx, client, sessionID, taskID, p, path.Join(remoteBase, filepath.ToSlash(rel)), emit)
	})
}

// DownloadPath 下载远程文件或目录到本地目录。
func (m *Manager) DownloadPath(ctx context.Context, sessionID, taskID, remotePath, localDir string, emit ProgressHandler) error {
	ctx, done := m.bindTransferCtx(ctx, taskID)
	defer done()

	s, err := m.get(sessionID)
	if err != nil {
		return err
	}
	client, err := s.openTransferClient()
	if err != nil {
		return err
	}
	defer client.Close()

	remotePath = cleanRemotePath(remotePath)
	info, err := client.Stat(remotePath)
	if err != nil {
		return errno.Wrap(errno.CodeConnFailed, "读取远程路径失败", err)
	}
	localDir = filepath.Clean(localDir)
	if !info.IsDir() {
		localPath := filepath.Join(localDir, filepath.Base(remotePath))
		return m.downloadFile(ctx, client, sessionID, taskID, remotePath, localPath, emit)
	}
	localBase := filepath.Join(localDir, filepath.Base(remotePath))
	if err := os.MkdirAll(localBase, 0o755); err != nil {
		return errno.Wrap(errno.CodeStoreFailed, "创建本地目录失败", err)
	}
	return walkRemote(client, remotePath, func(rPath string, isDir bool) error {
		if err := ctx.Err(); err != nil {
			return err
		}
		if isDir {
			return nil
		}
		rel := strings.TrimPrefix(rPath, remotePath)
		rel = strings.TrimPrefix(rel, "/")
		localPath := filepath.Join(localBase, filepath.FromSlash(rel))
		return m.downloadFile(ctx, client, sessionID, taskID, rPath, localPath, emit)
	})
}

// uploadFile 上传单个文件。
func (m *Manager) uploadFile(ctx context.Context, client *pkgsftp.Client, sessionID, taskID, localPath, remotePath string, emit ProgressHandler) error {
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
	name := filepath.Base(localPath)
	m.emitProgress(emit, taskID, sessionID, "upload", name, 0, total, "running")
	if err := mkdirRemote(client, path.Dir(remotePath)); err != nil {
		m.emitProgress(emit, taskID, sessionID, "upload", name, 0, total, "error")
		return errno.Wrap(errno.CodeConnFailed, "创建远程目录失败", err)
	}
	dst, err := client.Create(remotePath)
	if err != nil {
		m.emitProgress(emit, taskID, sessionID, "upload", name, 0, total, "error")
		return errno.Wrap(errno.CodeConnFailed, "创建远程文件失败", err)
	}
	defer dst.Close()
	done, err := copyWithProgress(ctx, dst, src, func(n int64) {
		m.emitProgress(emit, taskID, sessionID, "upload", name, n, total, "running")
	})
	if err != nil {
		if ctx.Err() != nil {
			m.emitProgress(emit, taskID, sessionID, "upload", name, done, total, "error")
			return errno.Wrap(errno.CodeInvalidArg, "上传已取消", ctx.Err())
		}
		m.emitProgress(emit, taskID, sessionID, "upload", name, done, total, "error")
		return errno.Wrap(errno.CodeConnFailed, "上传文件失败", err)
	}
	m.emitProgress(emit, taskID, sessionID, "upload", name, total, total, "done")
	return nil
}

// downloadFile 下载单个文件。
func (m *Manager) downloadFile(ctx context.Context, client *pkgsftp.Client, sessionID, taskID, remotePath, localPath string, emit ProgressHandler) error {
	src, err := client.Open(remotePath)
	if err != nil {
		return errno.Wrap(errno.CodeConnFailed, "打开远程文件失败", err)
	}
	defer src.Close()
	info, err := src.Stat()
	if err != nil {
		return err
	}
	total := info.Size()
	name := filepath.Base(remotePath)
	m.emitProgress(emit, taskID, sessionID, "download", name, 0, total, "running")
	if err := os.MkdirAll(filepath.Dir(localPath), 0o755); err != nil {
		m.emitProgress(emit, taskID, sessionID, "download", name, 0, total, "error")
		return errno.Wrap(errno.CodeStoreFailed, "创建本地目录失败", err)
	}
	dst, err := os.Create(localPath)
	if err != nil {
		m.emitProgress(emit, taskID, sessionID, "download", name, 0, total, "error")
		return errno.Wrap(errno.CodeStoreFailed, "创建本地文件失败", err)
	}
	defer dst.Close()
	done, err := copyWithProgress(ctx, dst, src, func(n int64) {
		m.emitProgress(emit, taskID, sessionID, "download", name, n, total, "running")
	})
	if err != nil {
		if ctx.Err() != nil {
			m.emitProgress(emit, taskID, sessionID, "download", name, done, total, "error")
			return errno.Wrap(errno.CodeInvalidArg, "下载已取消", ctx.Err())
		}
		m.emitProgress(emit, taskID, sessionID, "download", name, done, total, "error")
		return errno.Wrap(errno.CodeConnFailed, "下载文件失败", err)
	}
	m.emitProgress(emit, taskID, sessionID, "download", name, total, total, "done")
	return nil
}

// mkdirRemote 在指定客户端上创建远程目录。
func mkdirRemote(client *pkgsftp.Client, dir string) error {
	dir = cleanRemotePath(dir)
	if err := client.MkdirAll(dir); err != nil {
		return errno.Wrap(errno.CodeConnFailed, "创建远程目录失败", err)
	}
	return nil
}

// walkRemote 递归遍历远程目录。
func walkRemote(client *pkgsftp.Client, dir string, fn func(path string, isDir bool) error) error {
	entries, err := client.ReadDir(dir)
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
			if err := walkRemote(client, full, fn); err != nil {
				return err
			}
		}
		if err := fn(full, isDir); err != nil {
			return err
		}
	}
	return nil
}

// copyWithProgress 带进度复制的 io.Copy。
func copyWithProgress(ctx context.Context, dst io.Writer, src io.Reader, onProgress func(int64)) (int64, error) {
	buf := make([]byte, 32*1024)
	var written int64
	for {
		if err := ctx.Err(); err != nil {
			return written, err
		}
		nr, er := src.Read(buf)
		if nr > 0 {
			nw, ew := dst.Write(buf[:nr])
			if nw > 0 {
				written += int64(nw)
				onProgress(written)
			}
			if ew != nil {
				return written, ew
			}
			if nr != nw {
				return written, io.ErrShortWrite
			}
		}
		if er != nil {
			if er == io.EOF {
				return written, nil
			}
			return written, er
		}
	}
}

// emitProgress 发送传输进度事件。
func (m *Manager) emitProgress(emit ProgressHandler, taskID, sessionID, kind, name string, done, total int64, state string) {
	if emit == nil {
		return
	}
	emit(model.SftpProgressDO{
		TaskID:    taskID,
		SessionID: sessionID,
		Kind:      kind,
		Name:      name,
		Done:      done,
		Total:     total,
		State:     state,
	})
}

// ProgressHandler 传输进度回调。
type ProgressHandler func(evt model.SftpProgressDO)

// MkdirRemote 创建远程目录。
func (m *Manager) MkdirRemote(sessionID, dir string) error {
	s, err := m.get(sessionID)
	if err != nil {
		return err
	}
	dir = cleanRemotePath(dir)
	if err := s.sftp.MkdirAll(dir); err != nil {
		return errno.Wrap(errno.CodeConnFailed, "创建远程目录失败", err)
	}
	return nil
}

// RenameRemote 重命名远程路径。
func (m *Manager) RenameRemote(sessionID, oldPath, newPath string) error {
	s, err := m.get(sessionID)
	if err != nil {
		return err
	}
	oldPath = cleanRemotePath(oldPath)
	newPath = cleanRemotePath(newPath)
	if err := s.sftp.Rename(oldPath, newPath); err != nil {
		return errno.Wrap(errno.CodeConnFailed, "重命名远程路径失败", err)
	}
	return nil
}

// DeletePathRecursive 递归删除远程路径。
func (m *Manager) DeletePathRecursive(sessionID, remotePath string) error {
	s, err := m.get(sessionID)
	if err != nil {
		return err
	}
	remotePath = cleanRemotePath(remotePath)
	info, err := s.sftp.Stat(remotePath)
	if err != nil {
		return errno.Wrap(errno.CodeConnFailed, "读取远程路径失败", err)
	}
	if !info.IsDir() {
		if err := s.sftp.Remove(remotePath); err != nil {
			return errno.Wrap(errno.CodeConnFailed, "删除远程文件失败", err)
		}
		return nil
	}
	var dirs []string
	if err := walkRemote(s.sftp, remotePath, func(rPath string, isDir bool) error {
		if isDir {
			dirs = append(dirs, rPath)
		} else if err := s.sftp.Remove(rPath); err != nil {
			return err
		}
		return nil
	}); err != nil {
		return err
	}
	for i := len(dirs) - 1; i >= 0; i-- {
		if err := s.sftp.RemoveDirectory(dirs[i]); err != nil {
			return errno.Wrap(errno.CodeConnFailed, "删除远程目录失败", err)
		}
	}
	return nil
}
