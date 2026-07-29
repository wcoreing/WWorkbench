package session

import (
	"context"
	"strings"
	"sync"
	"time"

	"WWorkbench/internal/adapter"
	redisadapter "WWorkbench/internal/adapter/redis"
	"WWorkbench/internal/errno"
	"WWorkbench/internal/model"
	"WWorkbench/internal/store"
	"WWorkbench/internal/tunnel"

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
	if conn.DbType == "sqlite" {
		conn.SSHEnabled = false
	}
	spec := tunnel.SpecFromConnection(*conn)
	var tun tunnel.Tunnel
	if conn.DbType == "sqlite" {
		tun = tunnel.Nop()
	} else {
		tun, err = m.tunnel.Dial(ctx, spec, conn.Host, conn.Port)
		if err != nil {
			return nil, err
		}
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
	dbName := strings.TrimSpace(database)
	if conn.DbType == "sqlite" && dbName == "" {
		dbName = "main"
	}
	s := &Session{
		ID:           sid,
		ConnectionID: connectionID,
		Database:     dbName,
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

// SwitchDatabase 切换会话当前库。
// MySQL/SQLite/Redis 仅更新会话状态（查询路径会带 database）；PostgreSQL 需重开连接。
func (m *Manager) SwitchDatabase(ctx context.Context, sessionID, database string) (*model.SessionInfoDO, error) {
	database = strings.TrimSpace(database)
	if database == "" {
		return nil, errno.New(errno.CodeInvalidArg, "数据库名不能为空", "")
	}
	m.mu.Lock()
	s, ok := m.sessions[sessionID]
	if !ok {
		m.mu.Unlock()
		return nil, errno.New(errno.CodeSessionClosed, "会话已关闭", sessionID)
	}
	if s.Database == database {
		info := &model.SessionInfoDO{SessionID: s.ID, ConnectionID: s.ConnectionID, Database: s.Database}
		m.mu.Unlock()
		return info, nil
	}
	dbType := s.DbType
	connID := s.ConnectionID
	m.mu.Unlock()

	if dbType != "postgresql" {
		m.mu.Lock()
		if cur, ok := m.sessions[sessionID]; ok {
			cur.Database = database
		}
		m.mu.Unlock()
		return &model.SessionInfoDO{SessionID: sessionID, ConnectionID: connID, Database: database}, nil
	}

	conn, err := m.store.GetConnection(connID)
	if err != nil {
		return nil, err
	}
	if err := tunnel.ResolveConnection(m.store, conn); err != nil {
		return nil, err
	}
	m.mu.RLock()
	s, ok = m.sessions[sessionID]
	if !ok {
		m.mu.RUnlock()
		return nil, errno.New(errno.CodeSessionClosed, "会话已关闭", sessionID)
	}
	tun := s.Tunnel
	m.mu.RUnlock()

	ad, err := m.registry.Get(dbType)
	if err != nil {
		return nil, err
	}
	cfg := model.ConnectionConfigDO{
		DbType: dbType, Host: conn.Host, Port: conn.Port, User: conn.User,
		Password: conn.Password, Database: database, Charset: conn.Charset,
	}
	newDB, err := ad.Open(ctx, cfg, tun)
	if err != nil {
		return nil, err
	}

	m.mu.Lock()
	defer m.mu.Unlock()
	s, ok = m.sessions[sessionID]
	if !ok {
		_ = newDB.Close()
		return nil, errno.New(errno.CodeSessionClosed, "会话已关闭", sessionID)
	}
	old := s.DB
	s.DB = newDB
	s.Database = database
	if old != nil {
		_ = old.Close()
	}
	return &model.SessionInfoDO{SessionID: s.ID, ConnectionID: s.ConnectionID, Database: database}, nil
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
