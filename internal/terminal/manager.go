package terminal

import (
	"context"
	"io"
	"sync"

	"WWorkbench/internal/errno"
	"WWorkbench/internal/model"
	"WWorkbench/internal/tunnel"

	"github.com/google/uuid"
	"golang.org/x/crypto/ssh"
)

// OutputHandler 终端输出回调。
type OutputHandler func(sessionID string, data string)

// CloseHandler 终端关闭回调。
type CloseHandler func(sessionID string)

// Manager 终端会话管理器。
type Manager struct {
	mu       sync.RWMutex
	sessions map[string]*Session
	hosts    *HostService
	onOutput OutputHandler
	onClose  CloseHandler
}

// NewManager 创建终端会话管理器。
func NewManager(hosts *HostService) *Manager {
	return &Manager{
		sessions: make(map[string]*Session),
		hosts:    hosts,
	}
}

// SetHandlers 设置输出与关闭回调。
func (m *Manager) SetHandlers(onOutput OutputHandler, onClose CloseHandler) {
	m.mu.Lock()
	defer m.mu.Unlock()
	m.onOutput = onOutput
	m.onClose = onClose
}

// Open 打开 SSH 终端会话。
func (m *Manager) Open(ctx context.Context, hostID string, cols, rows int) (*model.TerminalSessionInfoDO, error) {
	if cols <= 0 {
		cols = 80
	}
	if rows <= 0 {
		rows = 24
	}
	host, err := m.hosts.Get(hostID)
	if err != nil {
		return nil, err
	}
	client, err := tunnel.DialSSH(ctx, HostToSpec(*host))
	if err != nil {
		return nil, err
	}
	sess, err := client.NewSession()
	if err != nil {
		_ = client.Close()
		return nil, errno.Wrap(errno.CodeConnFailed, "创建 SSH 会话失败", err)
	}
	modes := ssh.TerminalModes{
		ssh.ECHO:          1,
		ssh.TTY_OP_ISPEED: 14400,
		ssh.TTY_OP_OSPEED: 14400,
	}
	if err := sess.RequestPty("xterm-256color", rows, cols, modes); err != nil {
		_ = sess.Close()
		_ = client.Close()
		return nil, errno.Wrap(errno.CodeConnFailed, "请求 PTY 失败", err)
	}
	stdin, err := sess.StdinPipe()
	if err != nil {
		_ = sess.Close()
		_ = client.Close()
		return nil, errno.Wrap(errno.CodeConnFailed, "打开 stdin 失败", err)
	}
	stdout, err := sess.StdoutPipe()
	if err != nil {
		_ = sess.Close()
		_ = client.Close()
		return nil, errno.Wrap(errno.CodeConnFailed, "打开 stdout 失败", err)
	}
	stderr, err := sess.StderrPipe()
	if err != nil {
		_ = sess.Close()
		_ = client.Close()
		return nil, errno.Wrap(errno.CodeConnFailed, "打开 stderr 失败", err)
	}
	if err := sess.Shell(); err != nil {
		_ = sess.Close()
		_ = client.Close()
		return nil, errno.Wrap(errno.CodeConnFailed, "启动 Shell 失败", err)
	}

	sid := uuid.NewString()
	title := host.User + "@" + host.Host
	ts := &Session{
		ID:      sid,
		Kind:    kindSSH,
		HostID:  hostID,
		Title:   title,
		stdin:   stdin,
		client:  client,
		sshSess: sess,
	}
	m.registerSession(ts, stdout, func() { m.finish(sid) })
	go m.pump(stderr, m.emitter(sid), nil)

	return &model.TerminalSessionInfoDO{
		SessionID: sid,
		HostID:    hostID,
		Title:     title,
		Kind:      string(kindSSH),
	}, nil
}

// registerSession 注册会话并启动输出泵。
func (m *Manager) registerSession(ts *Session, reader io.Reader, onDone func()) {
	m.mu.Lock()
	m.sessions[ts.ID] = ts
	m.mu.Unlock()
	go m.pump(reader, m.emitter(ts.ID), onDone)
}

// emitter 创建会话输出回调。
func (m *Manager) emitter(sessionID string) func([]byte) {
	return func(data []byte) {
		m.mu.RLock()
		onOutput := m.onOutput
		m.mu.RUnlock()
		if onOutput != nil && len(data) > 0 {
			onOutput(sessionID, string(data))
		}
	}
}

// pump 读取终端输出流。
func (m *Manager) pump(r io.Reader, emit func([]byte), onDone func()) {
	buf := make([]byte, 32*1024)
	for {
		n, err := r.Read(buf)
		if n > 0 {
			emit(buf[:n])
		}
		if err != nil {
			if onDone != nil {
				onDone()
			}
			return
		}
	}
}

// finish 会话结束时清理资源并通知前端。
func (m *Manager) finish(sessionID string) {
	m.mu.Lock()
	s, ok := m.sessions[sessionID]
	if ok {
		delete(m.sessions, sessionID)
	}
	onClose := m.onClose
	m.mu.Unlock()
	if !ok {
		return
	}
	s.cleanup()
	if onClose != nil {
		onClose(sessionID)
	}
}

// Write 向终端写入数据。
func (m *Manager) Write(sessionID, data string) error {
	s, err := m.get(sessionID)
	if err != nil {
		return err
	}
	if data == "" {
		return nil
	}
	_, err = s.stdin.Write([]byte(data))
	return err
}

// Resize 调整终端尺寸。
func (m *Manager) Resize(sessionID string, cols, rows int) error {
	s, err := m.get(sessionID)
	if err != nil {
		return err
	}
	if cols <= 0 {
		cols = 80
	}
	if rows <= 0 {
		rows = 24
	}
	if s.Kind == kindLocal {
		if s.localPty == nil {
			return errno.New(errno.CodeSessionClosed, "终端已关闭", sessionID)
		}
		return s.localPty.Resize(cols, rows)
	}
	if s.Kind == kindDocker {
		if s.dockerExec == nil || s.dockerMgr == nil {
			return errno.New(errno.CodeSessionClosed, "终端已关闭", sessionID)
		}
		return s.dockerMgr.ResizeExec(context.Background(), s.dockerExec.Handle, s.dockerExec.ExecID, cols, rows)
	}
	if s.sshSess == nil {
		return errno.New(errno.CodeSessionClosed, "终端已关闭", sessionID)
	}
	return s.sshSess.WindowChange(rows, cols)
}

// Close 关闭终端会话。
func (m *Manager) Close(sessionID string) error {
	m.mu.Lock()
	s, ok := m.sessions[sessionID]
	if ok {
		delete(m.sessions, sessionID)
	}
	m.mu.Unlock()
	if !ok {
		return errno.New(errno.CodeNotFound, "终端会话不存在", sessionID)
	}
	s.cleanup()
	return nil
}

// CloseAll 关闭全部终端会话。
func (m *Manager) CloseAll() {
	m.mu.Lock()
	ids := make([]string, 0, len(m.sessions))
	for id := range m.sessions {
		ids = append(ids, id)
	}
	m.mu.Unlock()
	for _, id := range ids {
		_ = m.Close(id)
	}
}

// get 获取终端会话。
func (m *Manager) get(sessionID string) (*Session, error) {
	m.mu.RLock()
	defer m.mu.RUnlock()
	s, ok := m.sessions[sessionID]
	if !ok {
		return nil, errno.New(errno.CodeSessionClosed, "终端会话已关闭", sessionID)
	}
	return s, nil
}
