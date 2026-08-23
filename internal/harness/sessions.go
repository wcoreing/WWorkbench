package harness

import (
	"database/sql"
	"encoding/json"
	"fmt"
	"strings"
	"time"

	"WWorkbench/internal/model"

	nhstore "github.com/wcoreing/ningharness/store"
)

// SessionInfo 侧栏会话壳。
type SessionInfo struct {
	ID        string
	Title     string
	UpdatedAt int64 // unix 秒
}

type sessionBindings struct {
	Mentions  []model.AgentMentionDO `json:"mentions"`
	FocusRef  string                 `json:"focusRef"`
	SkillIDs  []string               `json:"skillIds,omitempty"`
}

func bindKey(sessionID string) string {
	return "ww_bind:" + strings.TrimSpace(sessionID)
}

// EnsureSession 确保 ningharness sessions 行存在。
func (h *Host) EnsureSession(id, title string) error {
	if h == nil || h.RT == nil || h.RT.Session == nil {
		return fmt.Errorf("harness: not open")
	}
	id = strings.TrimSpace(id)
	if id == "" {
		return fmt.Errorf("harness: empty session id")
	}
	t := strings.TrimSpace(title)
	if t == "" {
		t = id
	}
	return h.RT.Session.Ensure(h.Root, "", id, t)
}

// TouchSession 更新标题与时间；title 空则只刷新时间。
func (h *Host) TouchSession(id, title string) error {
	if h == nil || h.Root == "" {
		return fmt.Errorf("harness: not open")
	}
	id = strings.TrimSpace(id)
	title = strings.TrimSpace(title)
	db, err := nhstore.OpenProject(h.Root)
	if err != nil {
		return err
	}
	pid := nhstore.ProjectID(h.Root)
	now := time.Now().UnixMilli()
	if title == "" {
		_, err = db.Exec(nhstore.R(`UPDATE sessions SET updated_at_ms=? WHERE project_id=? AND id=?`), now, pid, id)
		return err
	}
	_, err = db.Exec(nhstore.R(`UPDATE sessions SET title=?, updated_at_ms=? WHERE project_id=? AND id=?`), title, now, pid, id)
	return err
}

// ListSessions 最近可见会话（按更新时间倒序）。
func (h *Host) ListSessions(limit int) ([]SessionInfo, error) {
	if h == nil || h.Root == "" {
		return nil, fmt.Errorf("harness: not open")
	}
	if limit <= 0 {
		limit = 50
	}
	db, err := nhstore.OpenProject(h.Root)
	if err != nil {
		return nil, err
	}
	pid := nhstore.ProjectID(h.Root)
	rows, err := db.Query(nhstore.R(`SELECT id, title, updated_at_ms FROM sessions WHERE project_id=? ORDER BY updated_at_ms DESC LIMIT ?`), pid, limit)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	var out []SessionInfo
	for rows.Next() {
		var s SessionInfo
		var ms int64
		if err := rows.Scan(&s.ID, &s.Title, &ms); err != nil {
			return nil, err
		}
		if strings.HasPrefix(s.ID, "once:") || strings.HasPrefix(s.ID, "skill-reflect:") {
			continue
		}
		s.UpdatedAt = ms / 1000
		out = append(out, s)
	}
	return out, rows.Err()
}

// GetSession 读会话壳 + bindings（@ 与 skill）。
func (h *Host) GetSession(id string) (*SessionInfo, []model.AgentMentionDO, string, []string, error) {
	if h == nil || h.Root == "" {
		return nil, nil, "", nil, fmt.Errorf("harness: not open")
	}
	id = strings.TrimSpace(id)
	db, err := nhstore.OpenProject(h.Root)
	if err != nil {
		return nil, nil, "", nil, err
	}
	pid := nhstore.ProjectID(h.Root)
	var title string
	var updated int64
	err = db.QueryRow(nhstore.R(`SELECT title, updated_at_ms FROM sessions WHERE project_id=? AND id=?`), pid, id).
		Scan(&title, &updated)
	if err == sql.ErrNoRows {
		return nil, nil, "", nil, fmt.Errorf("对话不存在")
	}
	if err != nil {
		return nil, nil, "", nil, err
	}
	mentions, focus, skillIDs := loadBindings(db, pid, id)
	return &SessionInfo{ID: id, Title: title, UpdatedAt: updated / 1000}, mentions, focus, skillIDs, nil
}

// SetBindings 写入 @ 绑定（meta）；保留已绑 skill。
func (h *Host) SetBindings(id string, mentions []model.AgentMentionDO, focusRef string) error {
	if h == nil || h.Root == "" {
		return fmt.Errorf("harness: not open")
	}
	db, err := nhstore.OpenProject(h.Root)
	if err != nil {
		return err
	}
	pid := nhstore.ProjectID(h.Root)
	_, _, skillIDs := loadBindings(db, pid, id)
	return h.saveBindingsAndTouch(id, sessionBindings{Mentions: mentions, FocusRef: focusRef, SkillIDs: skillIDs})
}

func (h *Host) saveBindingsAndTouch(id string, b sessionBindings) error {
	if h == nil || h.Root == "" {
		return fmt.Errorf("harness: not open")
	}
	db, err := nhstore.OpenProject(h.Root)
	if err != nil {
		return err
	}
	pid := nhstore.ProjectID(h.Root)
	if err := saveBindings(db, pid, id, b); err != nil {
		return err
	}
	return h.TouchSession(id, "")
}

// SetSessionSkillIDs 写入本对话绑定的 skill id（meta）。
func (h *Host) SetSessionSkillIDs(id string, skillIDs []string) error {
	if h == nil || h.Root == "" {
		return fmt.Errorf("harness: not open")
	}
	db, err := nhstore.OpenProject(h.Root)
	if err != nil {
		return err
	}
	pid := nhstore.ProjectID(h.Root)
	mentions, focus, _ := loadBindings(db, pid, id)
	out := make([]string, 0, len(skillIDs))
	seen := map[string]struct{}{}
	for _, s := range skillIDs {
		s = strings.TrimSpace(s)
		if s == "" {
			continue
		}
		if _, ok := seen[s]; ok {
			continue
		}
		seen[s] = struct{}{}
		out = append(out, s)
	}
	return h.saveBindingsAndTouch(id, sessionBindings{Mentions: mentions, FocusRef: focus, SkillIDs: out})
}

func saveBindings(db *sql.DB, pid, id string, b sessionBindings) error {
	raw, _ := json.Marshal(b)
	if err := nhstore.MetaSet(db, pid, bindKey(id), string(raw)); err != nil {
		return err
	}
	return nil
}

func loadBindings(db *sql.DB, pid, id string) ([]model.AgentMentionDO, string, []string) {
	raw, err := nhstore.MetaGet(db, pid, bindKey(id))
	if err != nil || strings.TrimSpace(raw) == "" {
		return nil, "", nil
	}
	var b sessionBindings
	if json.Unmarshal([]byte(raw), &b) != nil {
		return nil, "", nil
	}
	return b.Mentions, b.FocusRef, b.SkillIDs
}
