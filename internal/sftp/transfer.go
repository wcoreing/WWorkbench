package sftp

import (
	"context"
	"io"
	"os"
	"path"
	"path/filepath"
	"strings"

	"WWorkbench/internal/errno"
	"WWorkbench/internal/model"
)

// UploadPath 上传本地文件或目录到远程目录。
func (m *Manager) UploadPath(ctx context.Context, sessionID, taskID, localPath, remoteDir string, emit ProgressHandler) error {
	ctx, done := m.bindTransferCtx(ctx, taskID)
	defer done()

	s, err := m.get(sessionID)
	if err != nil {
		return err
	}
	fs, err := s.fs.OpenTransfer()
	if err != nil {
		return err
	}
	defer fs.Close()

	info, err := os.Stat(localPath)
	if err != nil {
		return errno.Wrap(errno.CodeInvalidArg, "本地路径不存在", err)
	}
	remoteDir = cleanRemotePath(remoteDir)
	if !info.IsDir() {
		remotePath := path.Join(remoteDir, filepath.Base(localPath))
		return m.uploadFile(ctx, fs, sessionID, taskID, localPath, remotePath, emit)
	}
	base := filepath.Base(localPath)
	remoteBase := path.Join(remoteDir, base)
	if err := fs.MkdirAll(remoteBase); err != nil {
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
			return fs.MkdirAll(path.Join(remoteBase, filepath.ToSlash(rel)))
		}
		rel, err := filepath.Rel(localPath, p)
		if err != nil {
			return err
		}
		return m.uploadFile(ctx, fs, sessionID, taskID, p, path.Join(remoteBase, filepath.ToSlash(rel)), emit)
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
	fs, err := s.fs.OpenTransfer()
	if err != nil {
		return err
	}
	defer fs.Close()

	remotePath = cleanRemotePath(remotePath)
	st, err := fs.Stat(remotePath)
	if err != nil {
		return errno.Wrap(errno.CodeConnFailed, "读取远程路径失败", err)
	}
	name := filepath.Base(strings.ReplaceAll(remotePath, "\\", "/"))
	localBase := filepath.Join(filepath.Clean(localDir), name)
	if !st.IsDir {
		return m.downloadFile(ctx, fs, sessionID, taskID, remotePath, localBase, emit)
	}
	if err := os.MkdirAll(localBase, 0o755); err != nil {
		return errno.Wrap(errno.CodeStoreFailed, "创建本地目录失败", err)
	}
	return fs.Walk(remotePath, func(rPath string, isDir bool) error {
		if err := ctx.Err(); err != nil {
			return err
		}
		if isDir {
			rel := strings.TrimPrefix(rPath, remotePath)
			rel = strings.TrimPrefix(rel, "/")
			return os.MkdirAll(filepath.Join(localBase, filepath.FromSlash(rel)), 0o755)
		}
		rel := strings.TrimPrefix(rPath, remotePath)
		rel = strings.TrimPrefix(rel, "/")
		localPath := filepath.Join(localBase, filepath.FromSlash(rel))
		return m.downloadFile(ctx, fs, sessionID, taskID, rPath, localPath, emit)
	})
}

func (m *Manager) uploadFile(ctx context.Context, fs remoteFS, sessionID, taskID, localPath, remotePath string, emit ProgressHandler) error {
	name := filepath.Base(localPath)
	info, err := os.Stat(localPath)
	if err != nil {
		return err
	}
	total := info.Size()
	m.emitProgress(emit, taskID, sessionID, "upload", name, 0, total, "running")
	err = fs.UploadFile(ctx, localPath, remotePath, func(done, tot int64) {
		m.emitProgress(emit, taskID, sessionID, "upload", name, done, tot, "running")
	})
	if err != nil {
		m.emitProgress(emit, taskID, sessionID, "upload", name, 0, total, "error")
		return err
	}
	m.emitProgress(emit, taskID, sessionID, "upload", name, total, total, "done")
	return nil
}

func (m *Manager) downloadFile(ctx context.Context, fs remoteFS, sessionID, taskID, remotePath, localPath string, emit ProgressHandler) error {
	name := filepath.Base(remotePath)
	m.emitProgress(emit, taskID, sessionID, "download", name, 0, 0, "running")
	err := fs.DownloadFile(ctx, remotePath, localPath, func(done, total int64) {
		m.emitProgress(emit, taskID, sessionID, "download", name, done, total, "running")
	})
	if err != nil {
		m.emitProgress(emit, taskID, sessionID, "download", name, 0, 0, "error")
		return err
	}
	m.emitProgress(emit, taskID, sessionID, "download", name, 1, 1, "done")
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
	return s.fs.MkdirAll(cleanRemotePath(dir))
}

// RenameRemote 重命名远程路径。
func (m *Manager) RenameRemote(sessionID, oldPath, newPath string) error {
	s, err := m.get(sessionID)
	if err != nil {
		return err
	}
	return s.fs.Rename(cleanRemotePath(oldPath), cleanRemotePath(newPath))
}

// DeletePathRecursive 递归删除远程路径。
func (m *Manager) DeletePathRecursive(sessionID, remotePath string) error {
	s, err := m.get(sessionID)
	if err != nil {
		return err
	}
	return s.fs.RemoveAll(cleanRemotePath(remotePath))
}
