package session

import (
	"context"
	"sync"
	"time"

	"WNavicat/internal/adapter"
	"WNavicat/internal/errno"
	"WNavicat/internal/model"
	"WNavicat/internal/store"
	"WNavicat/internal/tunnel"

	"database/sql"

	"github.com/google/uuid"
)

// Session 数据库会话。
type Session struct {
	ID           string
	ConnectionID string
	Database     string
	DB           *sql.DB
	DbType       string
	Tunnel       tunnel.Tunnel
}

// Manager 会话管理器。
type Manager struct {
	mu       sync.RWMutex
	sessions map[string]*Session
	registry *adapter.Registry
	store    *store.Store
	tunnel   tunnel.Provider
}

// NewManager 创建会话管理器。
func NewManager(registry *adapter.Registry, st *store.Store, tp tunnel.Provider) *Manager {
	return &Manager{
		sessions: make(map[string]*Session),
		registry: registry,
		store:    st,
		tunnel:   tp,
	}
}

// Open 打开会话。
func (m *Manager) Open(ctx context.Context, connectionID, database string) (*model.SessionInfoDO, error) {
	conn, err := m.store.GetConnection(connectionID)
	if err != nil {
		return nil, err
	}
	if err := tunnel.ValidateConnectionSSH(*conn); err != nil {
		return nil, err
	}
	if err := tunnel.ResolveConnection(m.store, conn); err != nil {
		return nil, err
	}
	ad, err := m.registry.Get(conn.DbType)
	if err != nil {
		return nil, err
	}
	spec := tunnel.SpecFromConnection(*conn)
	tun, err := m.tunnel.Dial(ctx, spec, conn.Host, conn.Port)
	if err != nil {
		return nil, err
	}
	cfg := model.ConnectionConfigDO{
		DbType:   conn.DbType,
		Host:     conn.Host,
		Port:     conn.Port,
		User:     conn.User,
		Password: conn.Password,
		Database: database,
		Charset:  conn.Charset,
		Tunnel:   spec,
	}
	if cfg.Database == "" {
		cfg.Database = conn.Database
	}
	db, err := ad.Open(ctx, cfg, tun)
	if err != nil {
		_ = tun.Close()
		return nil, err
	}
	sid := uuid.NewString()
	s := &Session{
		ID:           sid,
		ConnectionID: connectionID,
		Database:     cfg.Database,
		DB:           db,
		DbType:       conn.DbType,
		Tunnel:       tun,
	}
	m.mu.Lock()
	m.sessions[sid] = s
	m.mu.Unlock()
	return &model.SessionInfoDO{
		SessionID:    sid,
		ConnectionID: connectionID,
		Database:     cfg.Database,
	}, nil
}

// Close 关闭会话。
func (m *Manager) Close(sessionID string) error {
	m.mu.Lock()
	defer m.mu.Unlock()
	s, ok := m.sessions[sessionID]
	if !ok {
		return errno.New(errno.CodeNotFound, "会话不存在", sessionID)
	}
	delete(m.sessions, sessionID)
	err := s.DB.Close()
	if s.Tunnel != nil {
		if e := s.Tunnel.Close(); e != nil && err == nil {
			err = e
		}
	}
	return err
}

// Get 获取会话。
func (m *Manager) Get(sessionID string) (*Session, error) {
	m.mu.RLock()
	defer m.mu.RUnlock()
	s, ok := m.sessions[sessionID]
	if !ok {
		return nil, errno.New(errno.CodeSessionClosed, "会话已关闭", sessionID)
	}
	return s, nil
}

// WithTimeout 返回带超时的上下文。
func WithTimeout(parent context.Context, seconds int) (context.Context, context.CancelFunc) {
	if seconds <= 0 {
		seconds = 30
	}
	return context.WithTimeout(parent, time.Duration(seconds)*time.Second)
}

// Adapter 获取会话对应适配器。
func (m *Manager) Adapter(s *Session) (adapter.DatabaseAdapter, error) {
	return m.registry.Get(s.DbType)
}
