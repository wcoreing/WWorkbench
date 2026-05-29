package sftp

import (
	"context"
	"io"
	"os"
	"path"
	"path/filepath"
	"sort"
	"strings"
	"sync"

	"WNavicat/internal/errno"
	"WNavicat/internal/model"
	"WNavicat/internal/terminal"
	"WNavicat/internal/tunnel"

	"github.com/google/uuid"
	pkgsftp "github.com/pkg/sftp"
	"golang.org/x/crypto/ssh"
)

// Manager SFTP 会话管理器。
type Manager struct {
	sessions   map[string]*Session
	hosts      *terminal.HostService
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
func NewManager(hosts *terminal.HostService) *Manager {
	return &Manager{
		sessions: make(map[string]*Session),
		hosts:    hosts,
		cancels:  make(map[string]context.CancelFunc),
	}
}

// Open 建立 SFTP 会话。
func (m *Manager) Open(ctx context.Context, hostID string) (*model.SFTPSessionInfoDO, error) {
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
	m.sessions[sid] = &Session{
		ID:     sid,
		HostID: hostID,
		Title:  title,
		ssh:    client,
		sftp:   sftpClient,
	}
	return &model.SFTPSessionInfoDO{
		SessionID: sid,
		HostID:    hostID,
		Title:     title,
	}, nil
}

// Close 关闭 SFTP 会话。
func (m *Manager) Close(sessionID string) error {
	s, ok := m.sessions[sessionID]
	if !ok {
		return errno.New(errno.CodeNotFound, "SFTP 会话不存在", sessionID)
	}
	delete(m.sessions, sessionID)
	s.cleanup()
	return nil
}

// CloseAll 关闭全部 SFTP 会话。
func (m *Manager) CloseAll() {
	for id, s := range m.sessions {
		delete(m.sessions, id)
		s.cleanup()
	}
}

// GetHome 获取远程初始目录。
func (m *Manager) GetHome(sessionID string) (string, error) {
	s, err := m.get(sessionID)
	if err != nil {
		return "", err
	}
	wd, err := s.sftp.Getwd()
	if err == nil && wd != "" {
		return cleanRemotePath(wd), nil
	}
	home, err := s.sftp.RealPath(".")
	if err != nil {
		return "/", errno.Wrap(errno.CodeConnFailed, "获取远程目录失败", err)
	}
	return cleanRemotePath(home), nil
}

// ListDir 列出远程目录。
func (m *Manager) ListDir(sessionID, dir string) ([]model.FileEntryDO, error) {
	s, err := m.get(sessionID)
	if err != nil {
		return nil, err
	}
	dir = cleanRemotePath(dir)
	entries, err := s.sftp.ReadDir(dir)
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

// Download 下载远程文件到本地路径。
func (m *Manager) Download(sessionID, remotePath, localPath string) error {
	s, err := m.get(sessionID)
	if err != nil {
		return err
	}
	remotePath = cleanRemotePath(remotePath)
	src, err := s.sftp.Open(remotePath)
	if err != nil {
		return errno.Wrap(errno.CodeConnFailed, "打开远程文件失败", err)
	}
	defer src.Close()
	if err := os.MkdirAll(filepath.Dir(localPath), 0o755); err != nil {
		return errno.Wrap(errno.CodeStoreFailed, "创建本地目录失败", err)
	}
	dst, err := os.Create(localPath)
	if err != nil {
		return errno.Wrap(errno.CodeStoreFailed, "创建本地文件失败", err)
	}
	defer dst.Close()
	if _, err := io.Copy(dst, src); err != nil {
		return errno.Wrap(errno.CodeConnFailed, "下载文件失败", err)
	}
	return nil
}

// Upload 上传本地文件到远程路径。
func (m *Manager) Upload(sessionID, localPath, remotePath string) error {
	s, err := m.get(sessionID)
	if err != nil {
		return err
	}
	src, err := os.Open(localPath)
	if err != nil {
		return errno.Wrap(errno.CodeInvalidArg, "打开本地文件失败", err)
	}
	defer src.Close()
	remotePath = cleanRemotePath(remotePath)
	if err := s.sftp.MkdirAll(path.Dir(remotePath)); err != nil {
		return errno.Wrap(errno.CodeConnFailed, "创建远程目录失败", err)
	}
	dst, err := s.sftp.Create(remotePath)
	if err != nil {
		return errno.Wrap(errno.CodeConnFailed, "创建远程文件失败", err)
	}
	defer dst.Close()
	if _, err := io.Copy(dst, src); err != nil {
		return errno.Wrap(errno.CodeConnFailed, "上传文件失败", err)
	}
	return nil
}

// DownloadToFile 下载远程文件到指定本地路径。
func (m *Manager) DownloadToFile(ctx context.Context, sessionID, taskID, remotePath, localPath string) error {
	s, err := m.get(sessionID)
	if err != nil {
		return err
	}
	client, err := s.openTransferClient()
	if err != nil {
		return err
	}
	defer client.Close()
	ctx, done := m.bindTransferCtx(ctx, taskID)
	defer done()
	return m.downloadFile(ctx, client, sessionID, taskID, cleanRemotePath(remotePath), filepath.Clean(localPath), m.progress())
}

// DeletePath 删除远程文件或空目录。
func (m *Manager) DeletePath(sessionID, remotePath string) error {
	s, err := m.get(sessionID)
	if err != nil {
		return err
	}
	remotePath = cleanRemotePath(remotePath)
	info, err := s.sftp.Stat(remotePath)
	if err != nil {
		return errno.Wrap(errno.CodeConnFailed, "读取远程路径失败", err)
	}
	if info.IsDir() {
		if err := s.sftp.RemoveDirectory(remotePath); err != nil {
			return errno.Wrap(errno.CodeConnFailed, "删除远程目录失败", err)
		}
		return nil
	}
	if err := s.sftp.Remove(remotePath); err != nil {
		return errno.Wrap(errno.CodeConnFailed, "删除远程文件失败", err)
	}
	return nil
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

// Session SFTP 会话。
type Session struct {
	ID     string
	HostID string
	Title  string
	ssh    *ssh.Client
	sftp   *pkgsftp.Client
}

// cleanup 释放 SFTP 会话资源。
func (s *Session) cleanup() {
	if s.sftp != nil {
		_ = s.sftp.Close()
	}
	if s.ssh != nil {
		_ = s.ssh.Close()
	}
}

// openTransferClient 为并发传输创建独立 SFTP 客户端（共享 SSH 连接）。
func (s *Session) openTransferClient() (*pkgsftp.Client, error) {
	client, err := pkgsftp.NewClient(s.ssh)
	if err != nil {
		return nil, errno.Wrap(errno.CodeConnFailed, "创建传输 SFTP 客户端失败", err)
	}
	return client, nil
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
	}
	return ctx, func() {
		cancel()
		if taskID != "" {
			m.unregisterCancel(taskID)
		}
	}
}
