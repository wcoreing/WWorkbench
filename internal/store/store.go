package store

import (
	"database/sql"
	"fmt"
	"os"
	"path/filepath"
	"strings"
	"time"

	"WWorkbench/internal/crypto"
	"WWorkbench/internal/errno"
	"WWorkbench/internal/model"

	_ "modernc.org/sqlite"
)

// Store 本地持久化。
type Store struct {
	db        *sql.DB
	encryptor *crypto.Encryptor
	dataDir   string
}

// New 创建 Store。
func New(dataDir string) (*Store, error) {
	if err := os.MkdirAll(dataDir, 0o700); err != nil {
		return nil, errno.Wrap(errno.CodeStoreFailed, "创建数据目录失败", err)
	}
	enc, err := crypto.NewEncryptor(dataDir)
	if err != nil {
		return nil, errno.Wrap(errno.CodeStoreFailed, "初始化加密模块失败", err)
	}
	dbPath := filepath.Join(dataDir, "wworkbench.db")
	db, err := sql.Open("sqlite", dbPath)
	if err != nil {
		return nil, errno.Wrap(errno.CodeStoreFailed, "打开本地数据库失败", err)
	}
	s := &Store{db: db, encryptor: enc, dataDir: dataDir}
	if err := s.migrate(); err != nil {
		_ = db.Close()
		return nil, err
	}
	return s, nil
}

// migrate 初始化表结构。
func (s *Store) migrate() error {
	_, err := s.db.Exec(`
CREATE TABLE IF NOT EXISTS connections (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  db_type TEXT NOT NULL,
  host TEXT NOT NULL,
  port INTEGER NOT NULL,
  user_name TEXT NOT NULL,
  password_enc TEXT NOT NULL,
  database_name TEXT,
  charset TEXT,
  ssh_enabled INTEGER DEFAULT 0,
  ssh_host TEXT,
  ssh_port INTEGER DEFAULT 22,
  ssh_user TEXT,
  ssh_key_path TEXT,
  ssh_password_enc TEXT NOT NULL DEFAULT '',
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS query_history (
  id TEXT PRIMARY KEY,
  connection_id TEXT NOT NULL,
  database_name TEXT,
  sql_text TEXT NOT NULL,
  executed_at INTEGER NOT NULL,
  elapsed_ms INTEGER,
  success INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS ssh_hosts (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  host TEXT NOT NULL,
  port INTEGER NOT NULL DEFAULT 22,
  user_name TEXT NOT NULL,
  password_enc TEXT NOT NULL DEFAULT '',
  key_path TEXT,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS sftp_bookmarks (
  id TEXT PRIMARY KEY,
  side TEXT NOT NULL,
  host_id TEXT,
  name TEXT NOT NULL,
  path TEXT NOT NULL,
  created_at INTEGER NOT NULL
);
`)
	if err != nil {
		return errno.Wrap(errno.CodeStoreFailed, "迁移数据库失败", err)
	}
	if err := s.ensureColumn("connections", "ssh_password_enc", "TEXT NOT NULL DEFAULT ''"); err != nil {
		return err
	}
	if err := s.ensureColumn("connections", "conn_group", "TEXT NOT NULL DEFAULT ''"); err != nil {
		return err
	}
	if err := s.ensureColumn("connections", "ssh_host_id", "TEXT NOT NULL DEFAULT ''"); err != nil {
		return err
	}
	_, err = s.db.Exec(`
CREATE TABLE IF NOT EXISTS docker_contexts (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  kind TEXT NOT NULL DEFAULT 'ssh',
  ssh_host_id TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);`)
	if err != nil {
		return errno.Wrap(errno.CodeStoreFailed, "迁移 Docker 上下文表失败", err)
	}
	_, err = s.db.Exec(`
CREATE TABLE IF NOT EXISTS http_requests (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  method TEXT NOT NULL DEFAULT 'GET',
  url TEXT NOT NULL,
  headers_json TEXT NOT NULL DEFAULT '[]',
  body TEXT NOT NULL DEFAULT '',
  sort_order INTEGER NOT NULL DEFAULT 0,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS ssh_forward_presets (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  ssh_host_id TEXT NOT NULL,
  local_port INTEGER NOT NULL DEFAULT 0,
  remote_host TEXT NOT NULL,
  remote_port INTEGER NOT NULL,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS http_environments (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  vars_json TEXT NOT NULL DEFAULT '{}',
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS log_sources (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  source_type TEXT NOT NULL,
  path TEXT NOT NULL DEFAULT '',
  ssh_host_id TEXT NOT NULL DEFAULT '',
  docker_context_id TEXT NOT NULL DEFAULT '',
  container_id TEXT NOT NULL DEFAULT '',
  compose_dir TEXT NOT NULL DEFAULT '',
  compose_service TEXT NOT NULL DEFAULT '',
  tail_lines INTEGER NOT NULL DEFAULT 200,
  sort_order INTEGER NOT NULL DEFAULT 0,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS app_settings (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL
);`)
	if err != nil {
		return errno.Wrap(errno.CodeStoreFailed, "迁移应用设置表失败", err)
	}
	if err := s.ensureAgentPendingSchema(); err != nil {
		return err
	}
	_, err = s.db.Exec(`
CREATE TABLE IF NOT EXISTS env_presets (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  active INTEGER NOT NULL DEFAULT 0,
  runtimes_json TEXT NOT NULL DEFAULT '{}',
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);`)
	if err != nil {
		return errno.Wrap(errno.CodeStoreFailed, "迁移环境预设表失败", err)
	}
	_, err = s.db.Exec(`
CREATE TABLE IF NOT EXISTS notebook_groups (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  parent_id TEXT NOT NULL DEFAULT '',
  sort_order INTEGER NOT NULL DEFAULT 0,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS notes (
  id TEXT PRIMARY KEY,
  group_id TEXT NOT NULL DEFAULT '',
  title TEXT NOT NULL,
  content TEXT NOT NULL DEFAULT '',
  language TEXT NOT NULL DEFAULT 'plaintext',
  ssh_host_id TEXT NOT NULL DEFAULT '',
  connection_id TEXT NOT NULL DEFAULT '',
  sort_order INTEGER NOT NULL DEFAULT 0,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);`)
	if err != nil {
		return errno.Wrap(errno.CodeStoreFailed, "迁移笔记本表失败", err)
	}
	if err := s.ensureColumn("http_requests", "params_json", "TEXT NOT NULL DEFAULT '[]'"); err != nil {
		return errno.Wrap(errno.CodeStoreFailed, "迁移 HTTP 请求 params_json 失败", err)
	}
	if err := s.ensureColumn("http_requests", "notes", "TEXT NOT NULL DEFAULT ''"); err != nil {
		return errno.Wrap(errno.CodeStoreFailed, "迁移 HTTP 请求 notes 失败", err)
	}
	if err := s.ensureColumn("http_requests", "folder_id", "TEXT NOT NULL DEFAULT ''"); err != nil {
		return errno.Wrap(errno.CodeStoreFailed, "迁移 HTTP 请求 folder_id 失败", err)
	}
	if err := s.ensureColumn("http_requests", "cookies_json", "TEXT NOT NULL DEFAULT '[]'"); err != nil {
		return errno.Wrap(errno.CodeStoreFailed, "迁移 HTTP 请求 cookies_json 失败", err)
	}
	_, err = s.db.Exec(`
CREATE TABLE IF NOT EXISTS http_folders (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  parent_id TEXT NOT NULL DEFAULT '',
  sort_order INTEGER NOT NULL DEFAULT 0,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);`)
	if err != nil {
		return errno.Wrap(errno.CodeStoreFailed, "迁移 HTTP 目录表失败", err)
	}
	_, err = s.db.Exec(`
CREATE TABLE IF NOT EXISTS docker_shell_hosts (
  id TEXT PRIMARY KEY,
  context_id TEXT NOT NULL,
  container_id TEXT NOT NULL,
  name TEXT NOT NULL,
  image TEXT NOT NULL DEFAULT '',
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);
CREATE UNIQUE INDEX IF NOT EXISTS idx_docker_shell_hosts_ctx_ctr
  ON docker_shell_hosts(context_id, container_id);`)
	if err != nil {
		return errno.Wrap(errno.CodeStoreFailed, "迁移 Docker Shell 主机表失败", err)
	}
	return nil
}

func (s *Store) ensureColumn(table, column, colType string) error {
	_, err := s.db.Exec(fmt.Sprintf("ALTER TABLE %s ADD COLUMN %s %s", table, column, colType))
	if err != nil && strings.Contains(strings.ToLower(err.Error()), "duplicate column") {
		return nil
	}
	return err
}

// Close 关闭存储。
func (s *Store) Close() error {
	return s.db.Close()
}

const connectionSelectSQL = `SELECT id, name, conn_group, db_type, host, port, user_name, password_enc, database_name, charset,
	ssh_enabled, ssh_host_id, ssh_host, ssh_port, ssh_user, ssh_key_path, ssh_password_enc, created_at, updated_at FROM connections`

// scanConnection 扫描一行连接并解密敏感字段。
func (s *Store) scanConnection(
	id, name, group, dbType, host string, port int, user, pwdEnc, database, charset string,
	sshEnabled int, sshHostID, sshHost string, sshPort int, sshUser, sshKeyPath, sshPwdEnc string,
	createdAt, updatedAt int64,
) (model.ConnectionDO, error) {
	c := model.ConnectionDO{
		ID: id, Name: name, Group: group, DbType: dbType, Host: host, Port: port, User: user,
		Database: database, Charset: charset, SSHHostID: sshHostID, SSHHost: sshHost, SSHPort: sshPort,
		SSHUser: sshUser, SSHKeyPath: sshKeyPath, CreatedAt: createdAt, UpdatedAt: updatedAt,
	}
	c.SSHEnabled = sshEnabled == 1
	pwd, err := s.encryptor.Decrypt(pwdEnc)
	if err != nil {
		return c, errno.Wrap(errno.CodeStoreFailed, "解密密码失败", err)
	}
	c.Password = pwd
	if sshPwdEnc != "" {
		sshPwd, err := s.encryptor.Decrypt(sshPwdEnc)
		if err != nil {
			return c, errno.Wrap(errno.CodeStoreFailed, "解密 SSH 密码失败", err)
		}
		c.SSHPassword = sshPwd
	}
	return c, nil
}

// ListConnections 列出连接。
func (s *Store) ListConnections() ([]model.ConnectionDO, error) {
	rows, err := s.db.Query(connectionSelectSQL + ` ORDER BY updated_at DESC`)
	if err != nil {
		return nil, errno.Wrap(errno.CodeStoreFailed, "查询连接失败", err)
	}
	defer rows.Close()
	var list []model.ConnectionDO
	for rows.Next() {
		var id, name, group, dbType, host, user, pwdEnc, database, charset string
		var sshHostID, sshHost, sshUser, sshKeyPath, sshPwdEnc string
		var port, sshEnabled, sshPort int
		var createdAt, updatedAt int64
		if err := rows.Scan(&id, &name, &group, &dbType, &host, &port, &user, &pwdEnc, &database, &charset,
			&sshEnabled, &sshHostID, &sshHost, &sshPort, &sshUser, &sshKeyPath, &sshPwdEnc, &createdAt, &updatedAt); err != nil {
			return nil, errno.Wrap(errno.CodeStoreFailed, "读取连接失败", err)
		}
		c, err := s.scanConnection(id, name, group, dbType, host, port, user, pwdEnc, database, charset,
			sshEnabled, sshHostID, sshHost, sshPort, sshUser, sshKeyPath, sshPwdEnc, createdAt, updatedAt)
		if err != nil {
			return nil, err
		}
		list = append(list, c)
	}
	if err := rows.Err(); err != nil {
		return nil, errno.Wrap(errno.CodeStoreFailed, "查询连接失败", err)
	}
	return list, nil
}

// GetConnection 按 ID 获取连接。
func (s *Store) GetConnection(id string) (*model.ConnectionDO, error) {
	row := s.db.QueryRow(connectionSelectSQL+` WHERE id = ?`, id)
	var cid, name, group, dbType, host, user, pwdEnc, database, charset string
	var sshHostID, sshHost, sshUser, sshKeyPath, sshPwdEnc string
	var port, sshEnabled, sshPort int
	var createdAt, updatedAt int64
	if err := row.Scan(&cid, &name, &group, &dbType, &host, &port, &user, &pwdEnc, &database, &charset,
		&sshEnabled, &sshHostID, &sshHost, &sshPort, &sshUser, &sshKeyPath, &sshPwdEnc, &createdAt, &updatedAt); err != nil {
		if err == sql.ErrNoRows {
			return nil, errno.New(errno.CodeNotFound, "连接不存在", id)
		}
		return nil, errno.Wrap(errno.CodeStoreFailed, "读取连接失败", err)
	}
	c, err := s.scanConnection(cid, name, group, dbType, host, port, user, pwdEnc, database, charset,
		sshEnabled, sshHostID, sshHost, sshPort, sshUser, sshKeyPath, sshPwdEnc, createdAt, updatedAt)
	if err != nil {
		return nil, err
	}
	return &c, nil
}

// SaveConnection 保存连接。
func (s *Store) SaveConnection(c model.ConnectionDO) error {
	if strings.TrimSpace(c.Name) == "" || strings.TrimSpace(c.Host) == "" {
		return errno.New(errno.CodeInvalidArg, "连接名称与主机不能为空", "")
	}
	dbType := strings.ToLower(strings.TrimSpace(c.DbType))
	if dbType == "" {
		dbType = "mysql"
	}
	c.DbType = dbType
	// SQLite / Redis 用户名可空；MySQL / PostgreSQL 必填。
	if dbType != "sqlite" && dbType != "redis" && strings.TrimSpace(c.User) == "" {
		return errno.New(errno.CodeInvalidArg, "连接名称、主机、用户名不能为空", "")
	}
	switch dbType {
	case "sqlite":
		c.Port = 0
	case "postgresql":
		if c.Port <= 0 {
			c.Port = 5432
		}
	case "redis":
		if c.Port <= 0 {
			c.Port = 6379
		}
	default:
		if c.Port <= 0 {
			c.Port = 3306
		}
	}
	if c.Charset == "" && dbType == "mysql" {
		c.Charset = "utf8mb4"
	}
	now := time.Now().Unix()
	if c.ID == "" {
		return errno.New(errno.CodeInvalidArg, "连接 ID 不能为空", "")
	}
	pwdEnc, err := s.encryptor.Encrypt(c.Password)
	if err != nil {
		return errno.Wrap(errno.CodeStoreFailed, "加密密码失败", err)
	}
	sshPwdEnc, err := s.encryptor.Encrypt(c.SSHPassword)
	if err != nil {
		return errno.Wrap(errno.CodeStoreFailed, "加密 SSH 密码失败", err)
	}
	ssh := 0
	if c.SSHEnabled {
		ssh = 1
	}
	if c.CreatedAt == 0 {
		c.CreatedAt = now
	}
	c.UpdatedAt = now
	_, err = s.db.Exec(`INSERT INTO connections (id, name, conn_group, db_type, host, port, user_name, password_enc, database_name, charset,
		ssh_enabled, ssh_host_id, ssh_host, ssh_port, ssh_user, ssh_key_path, ssh_password_enc, created_at, updated_at)
		VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
		ON CONFLICT(id) DO UPDATE SET
		name=excluded.name, conn_group=excluded.conn_group, db_type=excluded.db_type, host=excluded.host, port=excluded.port,
		user_name=excluded.user_name, password_enc=excluded.password_enc, database_name=excluded.database_name,
		charset=excluded.charset, ssh_enabled=excluded.ssh_enabled, ssh_host_id=excluded.ssh_host_id,
		ssh_host=excluded.ssh_host, ssh_port=excluded.ssh_port, ssh_user=excluded.ssh_user,
		ssh_key_path=excluded.ssh_key_path, ssh_password_enc=excluded.ssh_password_enc, updated_at=excluded.updated_at`,
		c.ID, c.Name, c.Group, c.DbType, c.Host, c.Port, c.User, pwdEnc, c.Database, c.Charset,
		ssh, c.SSHHostID, c.SSHHost, c.SSHPort, c.SSHUser, c.SSHKeyPath, sshPwdEnc, c.CreatedAt, c.UpdatedAt)
	if err != nil {
		return errno.Wrap(errno.CodeStoreFailed, "保存连接失败", err)
	}
	return nil
}

// DeleteConnection 删除连接。
func (s *Store) DeleteConnection(id string) error {
	_, err := s.db.Exec(`DELETE FROM connections WHERE id = ?`, id)
	if err != nil {
		return errno.Wrap(errno.CodeStoreFailed, "删除连接失败", err)
	}
	_, _ = s.db.Exec(`DELETE FROM query_history WHERE connection_id = ?`, id)
	return nil
}

// AddQueryHistory 记录查询历史。
func (s *Store) AddQueryHistory(h model.QueryHistoryDO) error {
	_, err := s.db.Exec(`INSERT INTO query_history (id, connection_id, database_name, sql_text, executed_at, elapsed_ms, success)
		VALUES (?, ?, ?, ?, ?, ?, ?)`,
		h.ID, h.ConnectionID, h.Database, h.SQL, h.ExecutedAt, h.ElapsedMs, boolToInt(h.Success))
	if err != nil {
		return errno.Wrap(errno.CodeStoreFailed, "保存查询历史失败", err)
	}
	return nil
}

// ListQueryHistory 列出查询历史。
func (s *Store) ListQueryHistory(connectionID string, limit int) ([]model.QueryHistoryDO, error) {
	if limit <= 0 {
		limit = 50
	}
	rows, err := s.db.Query(`SELECT id, connection_id, database_name, sql_text, executed_at, elapsed_ms, success
		FROM query_history WHERE connection_id = ? ORDER BY executed_at DESC LIMIT ?`, connectionID, limit)
	if err != nil {
		return nil, errno.Wrap(errno.CodeStoreFailed, "查询历史失败", err)
	}
	defer rows.Close()
	var list []model.QueryHistoryDO
	for rows.Next() {
		var h model.QueryHistoryDO
		var ok int
		if err := rows.Scan(&h.ID, &h.ConnectionID, &h.Database, &h.SQL, &h.ExecutedAt, &h.ElapsedMs, &ok); err != nil {
			return nil, errno.Wrap(errno.CodeStoreFailed, "读取历史失败", err)
		}
		h.Success = ok == 1
		list = append(list, h)
	}
	if err := rows.Err(); err != nil {
		return nil, errno.Wrap(errno.CodeStoreFailed, "查询历史失败", err)
	}
	return list, nil
}

func boolToInt(v bool) int {
	if v {
		return 1
	}
	return 0
}

// DataDir 返回默认数据目录。
func DataDir() (string, error) {
	home, err := os.UserHomeDir()
	if err != nil {
		return "", err
	}
	return filepath.Join(home, ".wworkbench"), nil
}
