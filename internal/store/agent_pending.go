package store

import (
	"database/sql"
	"strings"
	"time"

	"WWorkbench/internal/errno"
	"WWorkbench/internal/model"

	"github.com/google/uuid"
)

// ensureAgentPendingSchema 待确认表（产品侧；会话/历史已迁 ningharness）。
func (s *Store) ensureAgentPendingSchema() error {
	// 旧 agentmem 形态（project_id/session_key）直接丢弃重建，不兼容迁移。
	var hasProject int
	_ = s.db.QueryRow(`SELECT COUNT(*) FROM pragma_table_info('agent_pending') WHERE name='project_id'`).Scan(&hasProject)
	if hasProject > 0 {
		_, _ = s.db.Exec(`DROP TABLE IF EXISTS agent_pending`)
	}
	_, err := s.db.Exec(`
CREATE TABLE IF NOT EXISTS agent_pending (
  id TEXT PRIMARY KEY,
  thread_id TEXT NOT NULL,
  task_id TEXT NOT NULL DEFAULT '',
  tool_name TEXT NOT NULL,
  args_json TEXT NOT NULL,
  summary TEXT NOT NULL DEFAULT '',
  created_at_ms INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_agent_pending_thread ON agent_pending(thread_id);
`)
	if err != nil {
		return errno.Wrap(errno.CodeStoreFailed, "创建 agent_pending 失败", err)
	}
	return nil
}

// SaveAgentPending 保存待确认工具调用。
func (s *Store) SaveAgentPending(p model.AgentPendingDO) error {
	if p.ID == "" {
		p.ID = uuid.NewString()
	}
	now := time.Now().UnixMilli()
	_, err := s.db.Exec(`INSERT INTO agent_pending(id, thread_id, task_id, tool_name, args_json, summary, created_at_ms)
		VALUES(?,?,?,?,?,?,?)
		ON CONFLICT(id) DO UPDATE SET
			thread_id=excluded.thread_id, task_id=excluded.task_id, tool_name=excluded.tool_name,
			args_json=excluded.args_json, summary=excluded.summary, created_at_ms=excluded.created_at_ms`,
		p.ID, p.ThreadID, "", p.ToolName, p.ArgsJSON, p.Summary, now)
	if err != nil {
		return errno.Wrap(errno.CodeStoreFailed, "保存待确认失败", err)
	}
	return nil
}

// GetAgentPending 获取待确认项。
func (s *Store) GetAgentPending(id string) (*model.AgentPendingDO, error) {
	var p model.AgentPendingDO
	var taskID string
	var created int64
	err := s.db.QueryRow(`SELECT id, thread_id, task_id, tool_name, args_json, summary, created_at_ms
		FROM agent_pending WHERE id=?`, id).
		Scan(&p.ID, &p.ThreadID, &taskID, &p.ToolName, &p.ArgsJSON, &p.Summary, &created)
	if err == sql.ErrNoRows {
		return nil, errno.New(errno.CodeNotFound, "待确认操作不存在", id)
	}
	if err != nil {
		return nil, errno.Wrap(errno.CodeStoreFailed, "读取待确认失败", err)
	}
	p.CreatedAt = created / 1000
	_ = taskID
	return &p, nil
}

// GetAgentPendingTaskID 读取 pending 关联 task（续跑用）。
func (s *Store) GetAgentPendingTaskID(id string) string {
	var taskID string
	_ = s.db.QueryRow(`SELECT task_id FROM agent_pending WHERE id=?`, id).Scan(&taskID)
	return taskID
}

// SaveAgentPendingFull 含 task_id。
func (s *Store) SaveAgentPendingFull(id, threadID, taskID, toolName, argsJSON, summary string) error {
	if id == "" {
		id = uuid.NewString()
	}
	now := time.Now().UnixMilli()
	_, err := s.db.Exec(`INSERT INTO agent_pending(id, thread_id, task_id, tool_name, args_json, summary, created_at_ms)
		VALUES(?,?,?,?,?,?,?)
		ON CONFLICT(id) DO UPDATE SET
			thread_id=excluded.thread_id, task_id=excluded.task_id, tool_name=excluded.tool_name,
			args_json=excluded.args_json, summary=excluded.summary, created_at_ms=excluded.created_at_ms`,
		id, threadID, taskID, toolName, argsJSON, summary, now)
	return err
}

// DeleteAgentPending 删除待确认项。
func (s *Store) DeleteAgentPending(id string) error {
	_, err := s.db.Exec(`DELETE FROM agent_pending WHERE id=?`, id)
	return err
}

// ListAgentPendingByThread 按创建时间列出线程上全部待确认（同批确认用）。
func (s *Store) ListAgentPendingByThread(threadID string) ([]model.AgentPendingDO, error) {
	threadID = strings.TrimSpace(threadID)
	if threadID == "" {
		return nil, nil
	}
	rows, err := s.db.Query(`SELECT id, thread_id, tool_name, args_json, summary, created_at_ms
		FROM agent_pending WHERE thread_id=? ORDER BY created_at_ms ASC, id ASC`, threadID)
	if err != nil {
		return nil, errno.Wrap(errno.CodeStoreFailed, "读取待确认失败", err)
	}
	defer rows.Close()
	var out []model.AgentPendingDO
	for rows.Next() {
		var p model.AgentPendingDO
		var created int64
		if err := rows.Scan(&p.ID, &p.ThreadID, &p.ToolName, &p.ArgsJSON, &p.Summary, &created); err != nil {
			return nil, errno.Wrap(errno.CodeStoreFailed, "读取待确认失败", err)
		}
		p.CreatedAt = created / 1000
		out = append(out, p)
	}
	return out, rows.Err()
}

// ListAgentPendingSameTask 列出同线程同 task 的待确认；task 空则仅返回 seed。
func (s *Store) ListAgentPendingSameTask(threadID, taskID, seedID string) ([]model.AgentPendingDO, error) {
	threadID = strings.TrimSpace(threadID)
	taskID = strings.TrimSpace(taskID)
	seedID = strings.TrimSpace(seedID)
	if threadID == "" {
		return nil, nil
	}
	if taskID == "" {
		if seedID == "" {
			return nil, nil
		}
		p, err := s.GetAgentPending(seedID)
		if err != nil {
			return nil, err
		}
		return []model.AgentPendingDO{*p}, nil
	}
	rows, err := s.db.Query(`SELECT id, thread_id, tool_name, args_json, summary, created_at_ms
		FROM agent_pending WHERE thread_id=? AND task_id=? ORDER BY created_at_ms ASC, id ASC`, threadID, taskID)
	if err != nil {
		return nil, errno.Wrap(errno.CodeStoreFailed, "读取待确认失败", err)
	}
	defer rows.Close()
	var out []model.AgentPendingDO
	for rows.Next() {
		var p model.AgentPendingDO
		var created int64
		if err := rows.Scan(&p.ID, &p.ThreadID, &p.ToolName, &p.ArgsJSON, &p.Summary, &created); err != nil {
			return nil, errno.Wrap(errno.CodeStoreFailed, "读取待确认失败", err)
		}
		p.CreatedAt = created / 1000
		out = append(out, p)
	}
	if err := rows.Err(); err != nil {
		return nil, err
	}
	if len(out) == 0 && seedID != "" {
		p, err := s.GetAgentPending(seedID)
		if err != nil {
			return nil, err
		}
		return []model.AgentPendingDO{*p}, nil
	}
	return out, nil
}

// FirstPendingByThread 返回线程上最早一条待确认 id（无则空串）。
func (s *Store) FirstPendingByThread(threadID string) (string, error) {
	threadID = strings.TrimSpace(threadID)
	if threadID == "" {
		return "", nil
	}
	var id string
	err := s.db.QueryRow(`SELECT id FROM agent_pending WHERE thread_id=? ORDER BY created_at_ms ASC LIMIT 1`, threadID).Scan(&id)
	if err == sql.ErrNoRows {
		return "", nil
	}
	if err != nil {
		return "", errno.Wrap(errno.CodeStoreFailed, "读取待确认失败", err)
	}
	return id, nil
}
