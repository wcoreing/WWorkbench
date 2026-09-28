package app

import (
	"path"
	"path/filepath"
	"strings"

	"WWorkbench/internal/model"
	"WWorkbench/internal/session"
	sftpsvc "WWorkbench/internal/sftp"
	"WWorkbench/internal/workbench"

	"github.com/wailsapp/wails/v2/pkg/runtime"
)

// OpenSFTPSession 打开 SFTP 会话。
func (s *Service) OpenSFTPSession(hostID string) ApiResult[model.SFTPSessionInfoDO] {
	ctx, cancel := session.WithTimeout(s.ctx, 30)
	defer cancel()
	info, err := s.sftp.Open(ctx, hostID)
	if err != nil {
		return ErrResult[model.SFTPSessionInfoDO](err)
	}
	return OkResult(*info)
}

// CloseSFTPSession 关闭 SFTP 会话。
func (s *Service) CloseSFTPSession(sessionID string) ApiResult[bool] {
	if err := s.sftp.Close(sessionID); err != nil {
		return ErrResult[bool](err)
	}
	return OkResult(true)
}

// GetSFTPHome 获取远程初始目录。
func (s *Service) GetSFTPHome(sessionID string) ApiResult[string] {
	home, err := s.sftp.GetHome(sessionID)
	if err != nil {
		return ErrResult[string](err)
	}
	return OkResult(home)
}

// ListSFTPDir 列出远程目录。
func (s *Service) ListSFTPDir(sessionID, dir string) ApiResult[[]model.FileEntryDO] {
	list, err := s.sftp.ListDir(sessionID, dir)
	if err != nil {
		return ErrResult[[]model.FileEntryDO](err)
	}
	if list == nil {
		list = []model.FileEntryDO{}
	}
	return OkResult(list)
}

// ListLocalDir 列出本地目录。
func (s *Service) ListLocalDir(dir string) ApiResult[model.LocalDirResultDO] {
	list, resolved, err := sftpsvc.ListLocalDir(dir)
	if err != nil {
		return ErrResult[model.LocalDirResultDO](err)
	}
	if list == nil {
		list = []model.FileEntryDO{}
	}
	return OkResult(model.LocalDirResultDO{Path: resolved, Entries: list})
}

// TransferSFTPUpload 上传本地路径到远程目录（支持目录递归）。
func (s *Service) TransferSFTPUpload(sessionID, taskID, localPath, remoteDir string) ApiResult[model.TransferResultDO] {
	if err := s.sftp.UploadPath(s.ctx, sessionID, taskID, localPath, remoteDir, s.sftp.Progress()); err != nil {
		return ErrResult[model.TransferResultDO](err)
	}
	name := filepath.Base(localPath)
	return OkResult(model.TransferResultDO{Path: path.Join(strings.TrimSuffix(remoteDir, "/"), name)})
}

// TransferSFTPDownload 下载远程路径到本地目录（支持目录递归）。
func (s *Service) TransferSFTPDownload(sessionID, taskID, remotePath, localDir string) ApiResult[model.TransferResultDO] {
	if err := s.sftp.DownloadPath(s.ctx, sessionID, taskID, remotePath, localDir, s.sftp.Progress()); err != nil {
		return ErrResult[model.TransferResultDO](err)
	}
	name := filepath.Base(strings.ReplaceAll(remotePath, "\\", "/"))
	return OkResult(model.TransferResultDO{Path: filepath.Join(localDir, name)})
}

// CheckSFTPUploadConflict 检查上传冲突。
func (s *Service) CheckSFTPUploadConflict(sessionID, localPath, remoteDir string) ApiResult[model.TransferConflictDO] {
	out, err := s.sftp.CheckUploadConflict(sessionID, localPath, remoteDir)
	if err != nil {
		return ErrResult[model.TransferConflictDO](err)
	}
	return OkResult(*out)
}

// CheckSFTPDownloadConflict 检查下载冲突。
func (s *Service) CheckSFTPDownloadConflict(sessionID, remotePath, localDir string) ApiResult[model.TransferConflictDO] {
	out, err := s.sftp.CheckDownloadConflict(sessionID, remotePath, localDir)
	if err != nil {
		return ErrResult[model.TransferConflictDO](err)
	}
	return OkResult(*out)
}

// CancelSFTPTask 取消传输任务。
func (s *Service) CancelSFTPTask(taskID string) ApiResult[bool] {
	return OkResult(s.sftp.CancelTransfer(taskID))
}

// DownloadSFTPFile 下载远程文件到用户选择路径。
func (s *Service) DownloadSFTPFile(sessionID, remotePath string) ApiResult[model.TransferResultDO] {
	name := filepath.Base(strings.ReplaceAll(remotePath, "\\", "/"))
	savePath, err := runtime.SaveFileDialog(s.ctx, runtime.SaveDialogOptions{
		Title:           "另存为",
		DefaultFilename: name,
	})
	if err != nil {
		return ErrResult[model.TransferResultDO](err)
	}
	if savePath == "" {
		return OkResult(model.TransferResultDO{Path: ""})
	}
	if err := s.sftp.DownloadToFile(s.ctx, sessionID, "", remotePath, savePath); err != nil {
		return ErrResult[model.TransferResultDO](err)
	}
	return OkResult(model.TransferResultDO{Path: savePath})
}

// PickSFTPUploadPaths 多选本地文件供上传队列使用（取消返回空切片）。
func (s *Service) PickSFTPUploadPaths() ApiResult[[]string] {
	paths, err := runtime.OpenMultipleFilesDialog(s.ctx, runtime.OpenDialogOptions{
		Title: "选择要上传的文件",
	})
	if err != nil {
		return ErrResult[[]string](err)
	}
	if paths == nil {
		paths = []string{}
	}
	return OkResult(paths)
}

// PickSFTPUploadDir 选择本地文件夹整夹上传（取消返回空串）。
func (s *Service) PickSFTPUploadDir() ApiResult[string] {
	dir, err := runtime.OpenDirectoryDialog(s.ctx, runtime.OpenDialogOptions{
		Title: "选择要上传的文件夹",
	})
	if err != nil {
		return ErrResult[string](err)
	}
	return OkResult(dir)
}

// PickSFTPDownloadDir 选择本地下载保存目录（取消返回空串；defaultDir 非空时作为初始目录）。
func (s *Service) PickSFTPDownloadDir(defaultDir string) ApiResult[string] {
	dir, err := runtime.OpenDirectoryDialog(s.ctx, runtime.OpenDialogOptions{
		Title:            "选择下载保存目录",
		DefaultDirectory: defaultDir,
	})
	if err != nil {
		return ErrResult[string](err)
	}
	return OkResult(dir)
}

// UploadSFTPFile 选择本地文件上传到远程目录。
func (s *Service) UploadSFTPFile(sessionID, remoteDir string) ApiResult[model.TransferResultDO] {
	localPath, err := runtime.OpenFileDialog(s.ctx, runtime.OpenDialogOptions{
		Title: "选择要上传的文件或文件夹",
	})
	if err != nil {
		return ErrResult[model.TransferResultDO](err)
	}
	if localPath == "" {
		return OkResult(model.TransferResultDO{Path: ""})
	}
	return s.TransferSFTPUpload(sessionID, "", localPath, remoteDir)
}

// ReadSFTPText 读取远程文本文件（在线编辑）。
func (s *Service) ReadSFTPText(sessionID, remotePath string) ApiResult[model.SFTPTextFileDO] {
	out, err := s.sftp.ReadTextFile(sessionID, remotePath)
	if err != nil {
		return ErrResult[model.SFTPTextFileDO](err)
	}
	return OkResult(*out)
}

// ReadSFTPBinary 读取远程二进制文件（图片等预览，content 为 base64）。
func (s *Service) ReadSFTPBinary(sessionID, remotePath string) ApiResult[model.SFTPBinaryFileDO] {
	out, err := s.sftp.ReadBinaryFile(sessionID, remotePath)
	if err != nil {
		return ErrResult[model.SFTPBinaryFileDO](err)
	}
	return OkResult(*out)
}

// WriteSFTPText 写回远程文本文件。
func (s *Service) WriteSFTPText(sessionID, remotePath, content string) ApiResult[bool] {
	if err := s.sftp.WriteTextFile(sessionID, remotePath, content); err != nil {
		return ErrResult[bool](err)
	}
	return OkResult(true)
}

// MkdirSFTPRemote 创建远程目录。
func (s *Service) MkdirSFTPRemote(sessionID, dir string) ApiResult[bool] {
	if err := s.sftp.MkdirRemote(sessionID, dir); err != nil {
		return ErrResult[bool](err)
	}
	return OkResult(true)
}

// RenameSFTPRemote 重命名远程路径。
func (s *Service) RenameSFTPRemote(sessionID, oldPath, newPath string) ApiResult[bool] {
	if err := s.sftp.RenameRemote(sessionID, oldPath, newPath); err != nil {
		return ErrResult[bool](err)
	}
	return OkResult(true)
}

// MkdirLocalPath 创建本地目录。
func (s *Service) MkdirLocalPath(dir string) ApiResult[bool] {
	if err := sftpsvc.MkdirLocal(dir); err != nil {
		return ErrResult[bool](err)
	}
	return OkResult(true)
}

// RenameLocalPath 重命名本地路径。
func (s *Service) RenameLocalPath(oldPath, newPath string) ApiResult[bool] {
	if err := sftpsvc.RenameLocal(oldPath, newPath); err != nil {
		return ErrResult[bool](err)
	}
	return OkResult(true)
}

// DeleteLocalPath 删除本地文件或空目录。
func (s *Service) DeleteLocalPath(target string) ApiResult[bool] {
	if err := sftpsvc.DeleteLocal(target); err != nil {
		return ErrResult[bool](err)
	}
	return OkResult(true)
}

// DeleteSFTPPath 递归删除远程路径。
func (s *Service) DeleteSFTPPath(sessionID, remotePath string) ApiResult[bool] {
	if err := s.sftp.DeletePathRecursive(sessionID, remotePath); err != nil {
		return ErrResult[bool](err)
	}
	return OkResult(true)
}

// wireSftpEvents 注册 SFTP 传输进度事件。
func (s *Service) wireSftpEvents() {
	s.sftp.SetProgressHandler(func(evt model.SftpProgressDO) {
		runtime.EventsEmit(s.ctx, "sftp:progress", evt)
	})
}

// ListSFTPBookmarks 列出 SFTP 路径书签。
func (s *Service) ListSFTPBookmarks(side, hostID string) ApiResult[[]model.SftpBookmarkDO] {
	list, err := s.store.ListSFTPBookmarks(side, hostID)
	if err != nil {
		return ErrResult[[]model.SftpBookmarkDO](err)
	}
	if list == nil {
		list = []model.SftpBookmarkDO{}
	}
	return OkResult(list)
}

// SaveSFTPBookmark 保存 SFTP 路径书签。
func (s *Service) SaveSFTPBookmark(b model.SftpBookmarkDO) ApiResult[model.SftpBookmarkDO] {
	op := workbench.RadarOpUpdate
	if b.ID == "" {
		op = workbench.RadarOpCreate
	}
	if b.Name == "" {
		b.Name = path.Base(strings.TrimSuffix(b.Path, "/"))
		if b.Name == "" || b.Name == "." {
			b.Name = b.Path
		}
	}
	out, err := s.store.SaveSFTPBookmark(b)
	if err != nil {
		return ErrResult[model.SftpBookmarkDO](err)
	}
	if s.radar != nil {
		s.radar.EmitSFTPBookmark(op, out.ID, "ui-sftp-bookmark-save", out.Name, false)
	}
	return OkResult(*out)
}

// DeleteSFTPBookmark 删除 SFTP 路径书签。
func (s *Service) DeleteSFTPBookmark(id string) ApiResult[bool] {
	if err := s.store.DeleteSFTPBookmark(id); err != nil {
		return ErrResult[bool](err)
	}
	if s.radar != nil {
		s.radar.EmitSFTPBookmark(workbench.RadarOpDelete, id, "ui-sftp-bookmark-delete", "", false)
	}
	return OkResult(true)
}
