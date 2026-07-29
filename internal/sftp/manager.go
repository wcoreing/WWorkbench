package sftp

import (
	"context"
	"os"
	"path"
	"path/filepath"
	"sort"
	"strings"
	"sync"

	"WWorkbench/internal/docker"
	"WWorkbench/internal/errno"
	"WWorkbench/internal/model"
	"WWorkbench/internal/terminal"
	"WWorkbench/internal/tunnel"

	"github.com/google/uuid"
	pkgsftp "github.com/pkg/sftp"
)

// Manager SFTP 会话管理器。
type Manager struct {
	mu         sync.RWMutex
	sessions   map[string]*Session
	hosts      *terminal.HostService
	docker     *docker.Manager
	onProgress ProgressHandler
	cancelMu   sync.Mutex
	cancels    map[string]context.CancelFunc
}

// SetProgressHandler 设置传输进度回调。
func (m *Manager) SetProgressHandler(h ProgressHandler) {
	m.onProgress = h
}

// progress 返回进度回调。
func (m *Manager) progress() ProgressHandler {
	return m.onProgress
}

// Progress 返回进度回调（供 app 层调用）。
func (m *Manager) Progress() ProgressHandler {
	return m.onProgress
}

// NewManager 创建 SFTP 会话管理器。
func NewManager(hosts *terminal.HostService, dockerMgr *docker.Manager) *Manager {
	return &Manager{
		sessions: make(map[string]*Session),
		hosts:    hosts,
		docker:   dockerMgr,
		cancels:  make(map[string]context.CancelFunc),
	}
}

// Open 建立 SFTP / 容器文件会话。
func (m *Manager) Open(ctx context.Context, hostID string) (*model.SFTPSessionInfoDO, error) {
	if docker.IsDockerHostID(hostID) {
		return m.openDocker(ctx, hostID)
	}
	host, err := m.hosts.Get(hostID)
	if err != nil {
		return nil, err
	}
	client, err := tunnel.DialSSH(ctx, terminal.HostToSpec(*host))
	if err != nil {
		return nil, err
	}
	sftpClient, err := pkgsftp.NewClient(client)
	if err != nil {
		_ = client.Close()
		return nil, errno.Wrap(errno.CodeConnFailed, "创建 SFTP 客户端失败", err)
	}
	sid := uuid.NewString()
	title := host.User + "@" + host.Host
	m.mu.Lock()
	m.sessions[sid] = &Session{
		ID:     sid,
		HostID: hostID,
		Title:  title,
		fs:     newSSHFS(client, sftpClient),
	}
	m.mu.Unlock()
	return &model.SFTPSessionInfoDO{
		SessionID: sid,
		HostID:    hostID,
		Title:     title,
	}, nil
}

func (m *Manager) openDocker(ctx context.Context, hostID string) (*model.SFTPSessionInfoDO, error) {
	if m.docker == nil {
		return nil, errno.New(errno.CodeInvalidArg, "Docker 管理器未初始化", "")
	}
	host, err := m.docker.GetShellHost(hostID)
	if err != nil {
		return nil, err
	}
	fs, err := openDockerFS(ctx, m.docker, host.ContextID, host.ContainerID)
	if err != nil {
		return nil, err
	}
	sid := uuid.NewString()
	title := docker.ResolveShellTitle(host.ContainerName, host.ContainerID)
	m.mu.Lock()
	m.sessions[sid] = &Session{
		ID:     sid,
		HostID: hostID,
		Title:  title,
		fs:     fs,
	}
	m.mu.Unlock()
	return &model.SFTPSessionInfoDO{
		SessionID: sid,
		HostID:    hostID,
		Title:     title,
	}, nil
}

// Close 关闭 SFTP 会话。
func (m *Manager) Close(sessionID string) error {
	m.mu.Lock()
	s, ok := m.sessions[sessionID]
	if ok {
		delete(m.sessions, sessionID)
	}
	m.mu.Unlock()
	if !ok {
		return errno.New(errno.CodeNotFound, "SFTP 会话不存在", sessionID)
	}
	s.cleanup()
	return nil
}

// CloseAll 关闭全部 SFTP 会话。
func (m *Manager) CloseAll() {
	m.mu.Lock()
	list := make([]*Session, 0, len(m.sessions))
	for id, s := range m.sessions {
		delete(m.sessions, id)
		list = append(list, s)
	}
	m.mu.Unlock()
	for _, s := range list {
		s.cleanup()
	}
}

// GetHome 获取远程初始目录。
func (m *Manager) GetHome(sessionID string) (string, error) {
	s, err := m.get(sessionID)
	if err != nil {
		return "", err
	}
	return s.fs.Home()
}

// ListDir 列出远程目录。
func (m *Manager) ListDir(sessionID, dir string) ([]model.FileEntryDO, error) {
	s, err := m.get(sessionID)
	if err != nil {
		return nil, err
	}
	return s.fs.ListDir(dir)
}

// Download 下载远程文件到本地路径。
func (m *Manager) Download(sessionID, remotePath, localPath string) error {
	s, err := m.get(sessionID)
	if err != nil {
		return err
	}
	return s.fs.DownloadFile(context.Background(), cleanRemotePath(remotePath), localPath, nil)
}

// Upload 上传本地文件到远程路径。
func (m *Manager) Upload(sessionID, localPath, remotePath string) error {
	s, err := m.get(sessionID)
	if err != nil {
		return err
	}
	return s.fs.UploadFile(context.Background(), localPath, cleanRemotePath(remotePath), nil)
}

// DownloadToFile 下载远程文件到指定本地路径。
func (m *Manager) DownloadToFile(ctx context.Context, sessionID, taskID, remotePath, localPath string) error {
	s, err := m.get(sessionID)
	if err != nil {
		return err
	}
	fs, err := s.fs.OpenTransfer()
	if err != nil {
		return err
	}
	defer fs.Close()
	ctx, done := m.bindTransferCtx(ctx, taskID)
	defer done()
	name := filepath.Base(remotePath)
	return fs.DownloadFile(ctx, cleanRemotePath(remotePath), filepath.Clean(localPath), func(doneBytes, total int64) {
		state := "running"
		if doneBytes >= total && total > 0 {
			state = "done"
		}
		m.emitProgress(m.progress(), taskID, sessionID, "download", name, doneBytes, total, state)
	})
}

// DeletePath 删除远程文件或空目录。
func (m *Manager) DeletePath(sessionID, remotePath string) error {
	s, err := m.get(sessionID)
	if err != nil {
		return err
	}
	return s.fs.Remove(cleanRemotePath(remotePath))
}

// ListLocalDir 列出本地目录。
func ListLocalDir(dir string) ([]model.FileEntryDO, string, error) {
	if strings.TrimSpace(dir) == "" {
		home, err := os.UserHomeDir()
		if err != nil {
			return nil, "", errno.Wrap(errno.CodeStoreFailed, "获取用户目录失败", err)
		}
		dir = home
	}
	dir = filepath.Clean(dir)
	entries, err := os.ReadDir(dir)
	if err != nil {
		return nil, "", errno.Wrap(errno.CodeInvalidArg, "读取本地目录失败", err)
	}
	out := make([]model.FileEntryDO, 0, len(entries))
	for _, ent := range entries {
		name := ent.Name()
		info, err := ent.Info()
		if err != nil {
			continue
		}
		out = append(out, model.FileEntryDO{
			Name:    name,
			Path:    filepath.Join(dir, name),
			IsDir:   ent.IsDir(),
			Size:    info.Size(),
			ModTime: info.ModTime().Unix(),
		})
	}
	sortFileEntries(out)
	return out, dir, nil
}

// get 获取 SFTP 会话。
func (m *Manager) get(sessionID string) (*Session, error) {
	m.mu.RLock()
	defer m.mu.RUnlock()
	s, ok := m.sessions[sessionID]
	if !ok {
		return nil, errno.New(errno.CodeSessionClosed, "SFTP 会话已关闭", sessionID)
	}
	return s, nil
}

// cleanRemotePath 规范化远程 Unix 路径。
func cleanRemotePath(p string) string {
	p = strings.ReplaceAll(p, "\\", "/")
	if p == "" {
		return "/"
	}
	if !strings.HasPrefix(p, "/") {
		p = "/" + strings.TrimPrefix(p, "/")
	}
	return path.Clean(p)
}

// sortFileEntries 目录优先按名称排序。
func sortFileEntries(entries []model.FileEntryDO) {
	sort.Slice(entries, func(i, j int) bool {
		if entries[i].IsDir != entries[j].IsDir {
			return entries[i].IsDir
		}
		return strings.ToLower(entries[i].Name) < strings.ToLower(entries[j].Name)
	})
}

// Session SFTP / 容器文件会话。
type Session struct {
	ID     string
	HostID string
	Title  string
	fs     remoteFS
}

// cleanup 释放会话资源。
func (s *Session) cleanup() {
	if s.fs != nil {
		s.fs.Close()
		s.fs = nil
	}
}

// registerCancel 注册传输任务取消函数。
func (m *Manager) registerCancel(taskID string, cancel context.CancelFunc) {
	m.cancelMu.Lock()
	defer m.cancelMu.Unlock()
	m.cancels[taskID] = cancel
}

// unregisterCancel 移除传输任务取消函数。
func (m *Manager) unregisterCancel(taskID string) {
	m.cancelMu.Lock()
	delete(m.cancels, taskID)
	m.cancelMu.Unlock()
}

// CancelTransfer 取消进行中的传输任务。
func (m *Manager) CancelTransfer(taskID string) bool {
	m.cancelMu.Lock()
	cancel, ok := m.cancels[taskID]
	m.cancelMu.Unlock()
	if !ok {
		return false
	}
	cancel()
	return true
}

// bindTransferCtx 绑定可取消的传输上下文。
func (m *Manager) bindTransferCtx(ctx context.Context, taskID string) (context.Context, context.CancelFunc) {
	ctx, cancel := context.WithCancel(ctx)
	if taskID != "" {
		m.registerCancel(taskID, cancel)
		return ctx, func() {
			cancel()
			m.unregisterCancel(taskID)
		}
	}
	return ctx, cancel
}
