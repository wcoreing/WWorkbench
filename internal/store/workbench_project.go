package store

import (
	"database/sql"
	"encoding/json"
	"path/filepath"
	"strings"
	"time"

	"WWorkbench/internal/errno"
	"WWorkbench/internal/model"

	"github.com/google/uuid"
)

const workbenchProjectSelectSQL = `SELECT id, name, local_path, git_remote, links_json, created_at, updated_at FROM workbench_projects`

func normalizeProjectLinks(links []model.WorkbenchProjectLinkDO) []model.WorkbenchProjectLinkDO {
	seen := map[string]bool{}
	out := make([]model.WorkbenchProjectLinkDO, 0, len(links))
	for _, l := range links {
		kind := strings.TrimSpace(l.Kind)
		id := strings.TrimSpace(l.ID)
		if kind == "" || id == "" {
			continue
		}
		key := kind + ":" + id
		if seen[key] {
			continue
		}
		seen[key] = true
		out = append(out, model.WorkbenchProjectLinkDO{
			Kind:  kind,
			ID:    id,
			Label: strings.TrimSpace(l.Label),
		})
	}
	return out
}

func encodeProjectLinks(links []model.WorkbenchProjectLinkDO) string {
	links = normalizeProjectLinks(links)
	if len(links) == 0 {
		return "[]"
	}
	b, err := json.Marshal(links)
	if err != nil {
		return "[]"
	}
	return string(b)
}

func decodeProjectLinks(raw string) []model.WorkbenchProjectLinkDO {
	raw = strings.TrimSpace(raw)
	if raw == "" || raw == "[]" {
		return []model.WorkbenchProjectLinkDO{}
	}
	var links []model.WorkbenchProjectLinkDO
	if err := json.Unmarshal([]byte(raw), &links); err != nil {
		return []model.WorkbenchProjectLinkDO{}
	}
	return normalizeProjectLinks(links)
}

func scanWorkbenchProject(scanner interface {
	Scan(dest ...any) error
}) (model.WorkbenchProjectDO, error) {
	var p model.WorkbenchProjectDO
	err := scanner.Scan(&p.ID, &p.Name, &p.LocalPath, &p.GitRemote, &p.LinksJSON, &p.CreatedAt, &p.UpdatedAt)
	if err != nil {
		return p, err
	}
	p.Links = decodeProjectLinks(p.LinksJSON)
	return p, nil
}

// ListWorkbenchProjects 列出项目组合（更新时间倒序）。
func (s *Store) ListWorkbenchProjects() ([]model.WorkbenchProjectDO, error) {
	rows, err := s.db.Query(workbenchProjectSelectSQL + ` ORDER BY updated_at DESC`)
	if err != nil {
		return nil, errno.Wrap(errno.CodeStoreFailed, "读取项目失败", err)
	}
	defer rows.Close()
	var out []model.WorkbenchProjectDO
	for rows.Next() {
		p, err := scanWorkbenchProject(rows)
		if err != nil {
			return nil, errno.Wrap(errno.CodeStoreFailed, "读取项目失败", err)
		}
		out = append(out, p)
	}
	return out, rows.Err()
}

// GetWorkbenchProject 按 id 取项目。
func (s *Store) GetWorkbenchProject(id string) (model.WorkbenchProjectDO, error) {
	row := s.db.QueryRow(workbenchProjectSelectSQL+` WHERE id = ?`, strings.TrimSpace(id))
	p, err := scanWorkbenchProject(row)
	if err == sql.ErrNoRows {
		return p, errno.New(errno.CodeNotFound, "项目不存在", id)
	}
	if err != nil {
		return p, errno.Wrap(errno.CodeStoreFailed, "读取项目失败", err)
	}
	return p, nil
}

// SaveWorkbenchProject 保存项目组合。
func (s *Store) SaveWorkbenchProject(p model.WorkbenchProjectDO) (model.WorkbenchProjectDO, error) {
	now := time.Now().Unix()
	p.Name = strings.TrimSpace(p.Name)
	p.LocalPath = strings.TrimSpace(p.LocalPath)
	p.GitRemote = strings.TrimSpace(p.GitRemote)
	p.Links = normalizeProjectLinks(p.Links)
	p.LinksJSON = encodeProjectLinks(p.Links)
	if p.Name == "" {
		if p.LocalPath != "" {
			p.Name = filepath.Base(p.LocalPath)
		}
		if p.Name == "" || p.Name == "." || p.Name == string(filepath.Separator) {
			p.Name = "未命名项目"
		}
	}
	if strings.TrimSpace(p.ID) == "" {
		p.ID = uuid.NewString()
		p.CreatedAt = now
	} else if p.CreatedAt == 0 {
		p.CreatedAt = now
	}
	p.UpdatedAt = now
	_, err := s.db.Exec(`INSERT INTO workbench_projects (
		id, name, local_path, git_remote, links_json, created_at, updated_at
	) VALUES (?, ?, ?, ?, ?, ?, ?)
	ON CONFLICT(id) DO UPDATE SET
		name=excluded.name, local_path=excluded.local_path, git_remote=excluded.git_remote,
		links_json=excluded.links_json, updated_at=excluded.updated_at`,
		p.ID, p.Name, p.LocalPath, p.GitRemote, p.LinksJSON, p.CreatedAt, p.UpdatedAt)
	if err != nil {
		return p, errno.Wrap(errno.CodeStoreFailed, "保存项目失败", err)
	}
	return p, nil
}

// DeleteWorkbenchProject 删除项目组合。
func (s *Store) DeleteWorkbenchProject(id string) error {
	id = strings.TrimSpace(id)
	if id == "" {
		return errno.New(errno.CodeInvalidArg, "id 不能为空", "")
	}
	res, err := s.db.Exec(`DELETE FROM workbench_projects WHERE id = ?`, id)
	if err != nil {
		return errno.Wrap(errno.CodeStoreFailed, "删除项目失败", err)
	}
	n, _ := res.RowsAffected()
	if n == 0 {
		return errno.New(errno.CodeNotFound, "项目不存在", id)
	}
	return nil
}
