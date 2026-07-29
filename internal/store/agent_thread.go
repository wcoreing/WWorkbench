package store

import (
	"database/sql"
	"encoding/json"
	"time"

	"WWorkbench/internal/errno"
	"WWorkbench/internal/model"

	"github.com/google/uuid"
)

// SaveAgentThread 创建或更新对话线程元数据。
func (s *Store) SaveAgentThread(th model.AgentThreadDO, contextJSON string) error {
	now := time.Now().Unix()
	updated := th.UpdatedAt
	if updated == 0 {
		updated = now
	}
	_, err := s.db.Exec(`INSERT INTO agent_threads (id, title, context_json, updated_at, created_at)
		VALUES (?, ?, ?, ?, ?)
		ON CONFLICT(id) DO UPDATE SET title=excluded.title, context_json=excluded.context_json, updated_at=excluded.updated_at`,
		th.ID, th.Title, contextJSON, updated, now)
	if err != nil {
		return errno.Wrap(errno.CodeStoreFailed, "保存对话线程失败", err)
	}
	return nil
}

// TouchAgentThread 更新线程标题与时间。
func (s *Store) TouchAgentThread(id, title string) error {
	now := time.Now().Unix()
	_, err := s.db.Exec(`UPDATE agent_threads SET title=?, updated_at=? WHERE id=?`, title, now, id)
	if err != nil {
		return errno.Wrap(errno.CodeStoreFailed, "更新对话线程失败", err)
	}
	return nil
}

// GetAgentThread 读取线程元数据。
func (s *Store) GetAgentThread(id string) (*model.AgentThreadDO, string, error) {
	var th model.AgentThreadDO
	var ctxJSON string
	var createdAt int64
	err := s.db.QueryRow(`SELECT id, title, context_json, updated_at, created_at FROM agent_threads WHERE id=?`, id).
		Scan(&th.ID, &th.Title, &ctxJSON, &th.UpdatedAt, &createdAt)
	_ = createdAt
	if err == sql.ErrNoRows {
		return nil, "", errno.New(errno.CodeNotFound, "对话不存在", id)
	}
	if err != nil {
		return nil, "", errno.Wrap(errno.CodeStoreFailed, "读取对话线程失败", err)
	}
	return &th, ctxJSON, nil
}

// ListAgentThreads 列出最近对话线程。
func (s *Store) ListAgentThreads(limit int) ([]model.AgentThreadDO, error) {
	if limit <= 0 {
		limit = 50
	}
	rows, err := s.db.Query(`SELECT id, title, updated_at FROM agent_threads ORDER BY updated_at DESC LIMIT ?`, limit)
	if err != nil {
		return nil, errno.Wrap(errno.CodeStoreFailed, "列出对话线程失败", err)
	}
	defer rows.Close()
	var out []model.AgentThreadDO
	for rows.Next() {
		var th model.AgentThreadDO
		if err := rows.Scan(&th.ID, &th.Title, &th.UpdatedAt); err != nil {
			return nil, err
		}
		out = append(out, th)
	}
	return out, rows.Err()
}

// AppendAgentMessage 追加一条对话消息（payload 为完整 LLM 消息 JSON）。
func (s *Store) AppendAgentMessage(threadID, role, displayContent, payloadJSON string) error {
	id := uuid.NewString()
	now := time.Now().Unix()
	_, err := s.db.Exec(`INSERT INTO agent_messages (id, thread_id, role, content, payload_json, created_at)
		VALUES (?, ?, ?, ?, ?, ?)`, id, threadID, role, displayContent, payloadJSON, now)
	if err != nil {
		return errno.Wrap(errno.CodeStoreFailed, "保存对话消息失败", err)
	}
	_, _ = s.db.Exec(`UPDATE agent_threads SET updated_at=? WHERE id=?`, now, threadID)
	return nil
}

// ListAgentMessagesUI 列出用于 UI 展示的消息（不含 tool 角色）。
func (s *Store) ListAgentMessagesUI(threadID string) ([]model.AgentMessageDO, error) {
	rows, err := s.db.Query(`SELECT role, content FROM agent_messages
		WHERE thread_id=? AND role IN ('user','assistant','system') ORDER BY created_at ASC`, threadID)
	if err != nil {
		return nil, errno.Wrap(errno.CodeStoreFailed, "读取对话消息失败", err)
	}
	defer rows.Close()
	var out []model.AgentMessageDO
	for rows.Next() {
		var m model.AgentMessageDO
		if err := rows.Scan(&m.Role, &m.Content); err != nil {
			return nil, err
		}
		out = append(out, m)
	}
	return out, rows.Err()
}

// ListAgentMessagePayloads 读取完整消息 JSON 列表（恢复 LLM 上下文）。
func (s *Store) ListAgentMessagePayloads(threadID string) ([]json.RawMessage, error) {
	rows, err := s.db.Query(`SELECT payload_json FROM agent_messages WHERE thread_id=? ORDER BY created_at ASC`, threadID)
	if err != nil {
		return nil, errno.Wrap(errno.CodeStoreFailed, "读取对话载荷失败", err)
	}
	defer rows.Close()
	var out []json.RawMessage
	for rows.Next() {
		var raw string
		if err := rows.Scan(&raw); err != nil {
			return nil, err
		}
		if raw == "" {
			continue
		}
		out = append(out, json.RawMessage(raw))
	}
	return out, rows.Err()
}
