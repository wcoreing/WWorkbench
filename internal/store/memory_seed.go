package store

import (
	"strings"

	"WWorkbench/internal/errno"
	"WWorkbench/internal/model"
)

const (
	memoryGroupID = "记忆区"
)

// MemoryGroupID 记忆区分组固定 id（供外部引用）。
func MemoryGroupID() string { return memoryGroupID }

// EnsureMemoryZone 记忆区已迁到磁盘工作区（~/.wworkbench/notebook/记忆区），SQLite 不再种子。
func (s *Store) EnsureMemoryZone() error {
	return nil
}

// ListMemoryNotes 列出 role=memory 的笔记摘要。
func (s *Store) ListMemoryNotes(limit int) ([]model.NoteSummaryDO, error) {
	if limit <= 0 {
		limit = 40
	}
	rows, err := s.db.Query(noteSummarySelectSQL+` WHERE role = ? ORDER BY updated_at DESC LIMIT ?`,
		model.NoteRoleMemory, limit)
	if err != nil {
		return nil, errno.Wrap(errno.CodeStoreFailed, "查询记忆笔记失败", err)
	}
	defer rows.Close()
	var list []model.NoteSummaryDO
	for rows.Next() {
		item, err := scanNoteSummary(rows.Scan)
		if err != nil {
			return nil, err
		}
		list = append(list, item)
	}
	if err := rows.Err(); err != nil {
		return nil, errno.Wrap(errno.CodeStoreFailed, "查询记忆笔记失败", err)
	}
	if list == nil {
		list = []model.NoteSummaryDO{}
	}
	return list, nil
}

// ListMemoryNotesForContext 按当前 SSH/连接匹配记忆笔记（绑定优先，再全局）。
func (s *Store) ListMemoryNotesForContext(sshHostIDs []string, connectionID string, limit int) ([]model.NoteSummaryDO, error) {
	if limit <= 0 {
		limit = 5
	}
	all, err := s.ListMemoryNotes(80)
	if err != nil {
		return nil, err
	}
	hostSet := map[string]struct{}{}
	for _, id := range sshHostIDs {
		id = strings.TrimSpace(id)
		if id != "" {
			hostSet[id] = struct{}{}
		}
	}
	connID := strings.TrimSpace(connectionID)

	var bound, global []model.NoteSummaryDO
	for _, n := range all {
		hostHit := false
		if n.SSHHostID != "" {
			_, hostHit = hostSet[n.SSHHostID]
		}
		connHit := connID != "" && n.ConnectionID != "" && n.ConnectionID == connID
		if hostHit || connHit {
			bound = append(bound, n)
			continue
		}
		if n.SSHHostID == "" && n.ConnectionID == "" {
			global = append(global, n)
		}
	}
	out := make([]model.NoteSummaryDO, 0, limit)
	out = append(out, bound...)
	if len(out) < limit {
		out = append(out, global...)
	}
	if len(out) > limit {
		out = out[:limit]
	}
	return out, nil
}
