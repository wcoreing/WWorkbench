package session

import (
	"context"
	"strings"
	"sync"
	"time"

	"WNavicat/internal/adapter"
	redisadapter "WNavicat/internal/adapter/redis"
	"WNavicat/internal/errno"
	"WNavicat/internal/model"
	"WNavicat/internal/store"
	"WNavicat/internal/tunnel"

	"database/sql"

	goredis "github.com/redis/go-redis/v9"
	"github.com/google/uuid"
)

// Session 数据库会话。
type Session struct {
	ID           string
	ConnectionID string
	Database     string
	DB           *sql.DB
	Redis        *goredis.Client
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
	conn.DbType = strings.ToLower(strings.TrimSpace(conn.DbType))
	if conn.DbType == "postgres" {
		conn.DbType = "postgresql"
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
	sid := uuid.NewString()
	s := &Session{
		ID:           sid,
		ConnectionID: connectionID,
		Database:     strings.TrimSpace(database),
		DbType:       conn.DbType,
		Tunnel:       tun,
	}
	if conn.DbType == "redis" {
		client, err := redisadapter.OpenClient(ctx, cfg, tun)
		if err != nil {
			_ = tun.Close()
			return nil, err
		}
		s.Redis = client
	} else {
		ad, err := m.registry.Get(conn.DbType)
		if err != nil {
			_ = tun.Close()
			return nil, err
		}
		db, err := ad.Open(ctx, cfg, tun)
		if err != nil {
			_ = tun.Close()
			return nil, err
		}
		s.DB = db
	}
	m.mu.Lock()
	m.sessions[sid] = s
	m.mu.Unlock()
	return &model.SessionInfoDO{
		SessionID:    sid,
		ConnectionID: connectionID,
		Database:     s.Database,
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
	var err error
	if s.Redis != nil {
		err = s.Redis.Close()
	}
	if s.DB != nil {
		if e := s.DB.Close(); e != nil && err == nil {
			err = e
		}
	}
	if s.Tunnel != nil {
		if e := s.Tunnel.Close(); e != nil && err == nil {
			err = e
		}
	}
	return err
}

// ListOpen 列出已打开会话摘要。
func (m *Manager) ListOpen() []model.SessionInfoDO {
	m.mu.RLock()
	defer m.mu.RUnlock()
	out := make([]model.SessionInfoDO, 0, len(m.sessions))
	for _, s := range m.sessions {
		out = append(out, model.SessionInfoDO{
			SessionID:    s.ID,
			ConnectionID: s.ConnectionID,
			Database:     s.Database,
		})
	}
	return out
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
