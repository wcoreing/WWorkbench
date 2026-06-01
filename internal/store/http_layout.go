package store

import (
	"strings"
	"time"

	"WNavicat/internal/errno"
	"WNavicat/internal/model"
)

const (
	httpLayoutKindFolder = "folder"
	httpLayoutKindAPI    = "api"
)

// ApplyHTTPApiTreeLayout 批量应用目录/接口的父级归属与同级排序。
func (s *Store) ApplyHTTPApiTreeLayout(layout model.HTTPApiTreeLayoutDO) error {
	if len(layout.ChildrenByParent) == 0 {
		return errno.New(errno.CodeInvalidArg, "布局不能为空", "")
	}
	allFolders, err := s.ListHTTPFolders()
	if err != nil {
		return err
	}
	allReqs, err := s.ListHTTPRequests()
	if err != nil {
		return err
	}
	folderSet := make(map[string]struct{}, len(allFolders))
	for _, f := range allFolders {
		folderSet[f.ID] = struct{}{}
	}
	reqSet := make(map[string]struct{}, len(allReqs))
	for _, r := range allReqs {
		reqSet[r.ID] = struct{}{}
	}
	seenFolder := make(map[string]struct{})
	seenAPI := make(map[string]struct{})

	tx, err := s.db.Begin()
	if err != nil {
		return errno.Wrap(errno.CodeStoreFailed, "保存 HTTP 树布局失败", err)
	}
	defer tx.Rollback()
	now := time.Now().Unix()

	for parentKey, entries := range layout.ChildrenByParent {
		parentID := strings.TrimSpace(parentKey)
		if parentID != "" {
			if _, ok := folderSet[parentID]; !ok {
				return errno.New(errno.CodeNotFound, "HTTP 目录不存在", parentID)
			}
		}
		for i, raw := range entries {
			kind, id, err := parseHTTPApiLayoutEntry(raw)
			if err != nil {
				return err
			}
			if kind == httpLayoutKindFolder {
				if _, ok := seenFolder[id]; ok {
					return errno.New(errno.CodeInvalidArg, "目录在布局中重复", id)
				}
				seenFolder[id] = struct{}{}
				if _, ok := folderSet[id]; !ok {
					return errno.New(errno.CodeNotFound, "HTTP 目录不存在", id)
				}
				if parentID != "" && isHTTPFolderDescendant(allFolders, id, parentID) {
					return errno.New(errno.CodeInvalidArg, "不能将目录移入其子目录", id)
				}
				res, err := tx.Exec(
					`UPDATE http_folders SET parent_id = ?, sort_order = ?, updated_at = ? WHERE id = ?`,
					parentID, i, now, id,
				)
				if err != nil {
					return errno.Wrap(errno.CodeStoreFailed, "保存 HTTP 树布局失败", err)
				}
				n, _ := res.RowsAffected()
				if n == 0 {
					return errno.New(errno.CodeNotFound, "HTTP 目录不存在", id)
				}
				for j := range allFolders {
					if allFolders[j].ID == id {
						allFolders[j].ParentID = parentID
						allFolders[j].SortOrder = i
						break
					}
				}
			} else {
				if _, ok := seenAPI[id]; ok {
					return errno.New(errno.CodeInvalidArg, "接口在布局中重复", id)
				}
				seenAPI[id] = struct{}{}
				if _, ok := reqSet[id]; !ok {
					return errno.New(errno.CodeNotFound, "HTTP 请求不存在", id)
				}
				res, err := tx.Exec(
					`UPDATE http_requests SET folder_id = ?, sort_order = ?, updated_at = ? WHERE id = ?`,
					parentID, i, now, id,
				)
				if err != nil {
					return errno.Wrap(errno.CodeStoreFailed, "保存 HTTP 树布局失败", err)
				}
				n, _ := res.RowsAffected()
				if n == 0 {
					return errno.New(errno.CodeNotFound, "HTTP 请求不存在", id)
				}
			}
		}
	}
	if err := tx.Commit(); err != nil {
		return errno.Wrap(errno.CodeStoreFailed, "保存 HTTP 树布局失败", err)
	}
	return nil
}

// parseHTTPApiLayoutEntry 解析布局项（folder:id / api:id）。
func parseHTTPApiLayoutEntry(raw string) (kind, id string, err error) {
	parts := strings.SplitN(strings.TrimSpace(raw), ":", 2)
	if len(parts) != 2 || parts[1] == "" {
		return "", "", errno.New(errno.CodeInvalidArg, "无效的布局项", raw)
	}
	switch parts[0] {
	case httpLayoutKindFolder, httpLayoutKindAPI:
		return parts[0], parts[1], nil
	default:
		return "", "", errno.New(errno.CodeInvalidArg, "无效的布局项", raw)
	}
}

// isHTTPFolderDescendant 判断 target 是否为 folderID 自身或其子目录。
func isHTTPFolderDescendant(all []model.HTTPFolderDO, folderID, target string) bool {
	if folderID == "" || target == "" {
		return false
	}
	if folderID == target {
		return true
	}
	children := make(map[string][]string)
	for _, f := range all {
		pid := f.ParentID
		children[pid] = append(children[pid], f.ID)
	}
	seen := make(map[string]struct{})
	var walk func(id string) bool
	walk = func(id string) bool {
		if id == target {
			return true
		}
		if _, ok := seen[id]; ok {
			return false
		}
		seen[id] = struct{}{}
		for _, cid := range children[id] {
			if walk(cid) {
				return true
			}
		}
		return false
	}
	return walk(folderID)
}
