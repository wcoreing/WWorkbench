package sftp

import (
	"os"
	"path"
	"path/filepath"
	"strings"

	"WNavicat/internal/errno"
	"WNavicat/internal/model"
)

// CheckUploadConflict 检查上传是否与远程已有文件冲突。
func (m *Manager) CheckUploadConflict(sessionID, localPath, remoteDir string) (*model.TransferConflictDO, error) {
	info, err := os.Stat(localPath)
	if err != nil {
		return nil, errno.Wrap(errno.CodeInvalidArg, "本地路径不存在", err)
	}
	name := filepath.Base(localPath)
	remotePath := path.Join(cleanRemotePath(remoteDir), name)
	out := &model.TransferConflictDO{
		Name:          name,
		SourcePath:    localPath,
		SourceSize:    info.Size(),
		SourceModTime: info.ModTime().Unix(),
		SourceIsDir:   info.IsDir(),
		TargetPath:    remotePath,
	}
	s, err := m.get(sessionID)
	if err != nil {
		return nil, err
	}
	remoteInfo, err := s.sftp.Stat(remotePath)
	if err != nil {
		if isNotExist(err) {
			return out, nil
		}
		return nil, errno.Wrap(errno.CodeConnFailed, "读取远程路径失败", err)
	}
	out.HasConflict = true
	out.TargetSize = remoteInfo.Size()
	out.TargetModTime = remoteInfo.ModTime().Unix()
	out.TargetIsDir = remoteInfo.IsDir()
	return out, nil
}

// CheckDownloadConflict 检查下载是否与本地已有文件冲突。
func (m *Manager) CheckDownloadConflict(sessionID, remotePath, localDir string) (*model.TransferConflictDO, error) {
	s, err := m.get(sessionID)
	if err != nil {
		return nil, err
	}
	remotePath = cleanRemotePath(remotePath)
	remoteInfo, err := s.sftp.Stat(remotePath)
	if err != nil {
		return nil, errno.Wrap(errno.CodeConnFailed, "读取远程路径失败", err)
	}
	name := filepath.Base(strings.ReplaceAll(remotePath, "\\", "/"))
	localPath := filepath.Join(filepath.Clean(localDir), name)
	out := &model.TransferConflictDO{
		Name:          name,
		SourcePath:    remotePath,
		SourceSize:    remoteInfo.Size(),
		SourceModTime: remoteInfo.ModTime().Unix(),
		SourceIsDir:   remoteInfo.IsDir(),
		TargetPath:    localPath,
	}
	localInfo, err := os.Stat(localPath)
	if err != nil {
		if os.IsNotExist(err) {
			return out, nil
		}
		return nil, errno.Wrap(errno.CodeStoreFailed, "读取本地路径失败", err)
	}
	out.HasConflict = true
	out.TargetSize = localInfo.Size()
	out.TargetModTime = localInfo.ModTime().Unix()
	out.TargetIsDir = localInfo.IsDir()
	return out, nil
}

// isNotExist 判断 SFTP 路径不存在错误。
func isNotExist(err error) bool {
	if err == nil {
		return false
	}
	if os.IsNotExist(err) {
		return true
	}
	msg := strings.ToLower(err.Error())
	return strings.Contains(msg, "no such file") || strings.Contains(msg, "not found")
}