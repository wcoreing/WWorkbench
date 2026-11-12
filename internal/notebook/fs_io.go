package notebook

import (
	"encoding/json"
	"os"
	"path/filepath"
	"sort"
	"strings"
	"time"
	"unicode"

	"WWorkbench/internal/errno"
	"WWorkbench/internal/model"

	"github.com/google/uuid"
)

func (s *Service) listGroupsFS() ([]model.NotebookGroupDO, error) {
	root := s.workspaceRoot()
	entries, err := os.ReadDir(root)
	if err != nil {
		if os.IsNotExist(err) {
			return []model.NotebookGroupDO{}, nil
		}
		return nil, errno.Wrap(errno.CodeStoreFailed, "读取笔记本工作区失败", err)
	}
	order := s.readOrder(root)
	var list []model.NotebookGroupDO
	seen := map[string]struct{}{}
	addGroup := func(id, name, parent string, sortHint int, mt int64) {
		id = filepath.ToSlash(strings.TrimSpace(id))
		if id == "" || strings.HasPrefix(filepath.Base(id), ".") {
			return
		}
		if _, ok := seen[id]; ok {
			return
		}
		seen[id] = struct{}{}
		if mt == 0 {
			mt = time.Now().Unix()
		}
		list = append(list, model.NotebookGroupDO{
			ID: id, Name: name, ParentID: parent,
			SortOrder: sortHint, CreatedAt: mt, UpdatedAt: mt,
		})
	}
	for i, name := range order {
		abs := filepath.Join(root, name)
		info, err := os.Stat(abs)
		if err != nil || !info.IsDir() || strings.HasPrefix(name, ".") {
			continue
		}
		addGroup(name, name, "", i, info.ModTime().Unix())
	}
	var rest []string
	for _, e := range entries {
		if !e.IsDir() || strings.HasPrefix(e.Name(), ".") {
			continue
		}
		if _, ok := seen[filepath.ToSlash(e.Name())]; ok {
			continue
		}
		rest = append(rest, e.Name())
	}
	sort.Strings(rest)
	base := len(order)
	for i, name := range rest {
		info, _ := os.Stat(filepath.Join(root, name))
		mt := time.Now().Unix()
		if info != nil {
			mt = info.ModTime().Unix()
		}
		addGroup(name, name, "", base+i, mt)
	}
	// 如实递归子目录（含 Skill 的 assets/、scripts/、*.assets）
	err = filepath.WalkDir(root, func(path string, d os.DirEntry, err error) error {
		if err != nil || path == root {
			return nil
		}
		if !d.IsDir() {
			return nil
		}
		name := d.Name()
		if strings.HasPrefix(name, ".") {
			return filepath.SkipDir
		}
		rel, relErr := filepath.Rel(root, path)
		if relErr != nil {
			return nil
		}
		rel = filepath.ToSlash(rel)
		if _, ok := seen[rel]; ok {
			return nil // 根下一层已加过
		}
		parent := filepath.ToSlash(filepath.Dir(rel))
		if parent == "." {
			parent = ""
		}
		info, _ := d.Info()
		mt := time.Now().Unix()
		if info != nil {
			mt = info.ModTime().Unix()
		}
		addGroup(rel, name, parent, 0, mt)
		return nil
	})
	if err != nil {
		return nil, errno.Wrap(errno.CodeStoreFailed, "扫描笔记本目录失败", err)
	}
	return list, nil
}

func (s *Service) saveGroupFS(g model.NotebookGroupDO) (*model.NotebookGroupDO, error) {
	name := strings.TrimSpace(g.Name)
	if name == "" {
		return nil, errno.New(errno.CodeInvalidArg, "分组名称不能为空", "")
	}
	if strings.ContainsAny(name, `/\`) || name == "." || name == ".." || strings.HasPrefix(name, ".") {
		return nil, errno.New(errno.CodeInvalidArg, "分组名非法", name)
	}
	parent := strings.TrimSpace(g.ParentID)
	var abs string
	if parent == "" {
		g.ID = filepath.ToSlash(name)
		abs = filepath.Join(s.workspaceRoot(), name)
	} else {
		parentDir, err := s.groupDirAbs(parent)
		if err != nil {
			return nil, err
		}
		abs = filepath.Join(parentDir, name)
		g.ID = filepath.ToSlash(filepath.Join(parent, name))
	}
	if err := os.MkdirAll(abs, 0o700); err != nil {
		return nil, errno.Wrap(errno.CodeStoreFailed, "创建分组目录失败", err)
	}
	now := time.Now().Unix()
	if g.CreatedAt == 0 {
		g.CreatedAt = now
	}
	g.UpdatedAt = now
	g.Name = name
	return &g, nil
}

func (s *Service) deleteGroupFS(id string) error {
	id = strings.TrimSpace(id)
	if IsSystemTopDir(id) {
		return errno.New(errno.CodeInvalidArg, "不能删除系统分组", id)
	}
	dir, err := s.groupDirAbs(id)
	if err != nil {
		return err
	}
	root := s.workspaceRoot()
	if dir == root {
		return errno.New(errno.CodeInvalidArg, "不能删除工作区根", "")
	}
	// 笔记上提到父目录：把 .md 与 skill 目录移到父
	parent := filepath.Dir(dir)
	entries, err := os.ReadDir(dir)
	if err != nil {
		if os.IsNotExist(err) {
			return errno.New(errno.CodeNotFound, "笔记本目录不存在", id)
		}
		return errno.Wrap(errno.CodeStoreFailed, "读取分组失败", err)
	}
	for _, e := range entries {
		src := filepath.Join(dir, e.Name())
		dst := filepath.Join(parent, e.Name())
		if _, err := os.Stat(dst); err == nil {
			dst = filepath.Join(parent, e.Name()+"_moved")
		}
		_ = os.Rename(src, dst)
	}
	if err := os.Remove(dir); err != nil {
		_ = os.RemoveAll(dir)
	}
	return nil
}

func (s *Service) listNotesFS() ([]model.NoteSummaryDO, error) {
	root := s.workspaceRoot()
	var out []model.NoteSummaryDO
	err := filepath.WalkDir(root, func(path string, d os.DirEntry, err error) error {
		if err != nil {
			return nil
		}
		name := d.Name()
		if d.IsDir() {
			if path != root && strings.HasPrefix(name, ".") {
				return filepath.SkipDir
			}
			return nil
		}
		if !isNotebookContentFile(name) {
			return nil
		}
		rel, _ := filepath.Rel(root, path)
		rel = filepath.ToSlash(rel)
		groupID := groupIDFromRelDir(filepath.ToSlash(filepath.Dir(rel)))
		n, e2 := s.readNoteFile(rel, path, groupID)
		if e2 == nil && n != nil {
			out = append(out, toSummary(*n))
		}
		return nil
	})
	if err != nil {
		return nil, errno.Wrap(errno.CodeStoreFailed, "扫描笔记本失败", err)
	}
	sort.SliceStable(out, func(i, j int) bool {
		if out[i].SortOrder != out[j].SortOrder {
			return out[i].SortOrder < out[j].SortOrder
		}
		return out[i].Title < out[j].Title
	})
	return out, nil
}

func (s *Service) getNoteFS(id string) (*model.NoteDO, error) {
	contentPath, _, err := s.notePaths(id)
	if err != nil {
		return nil, err
	}
	if _, err := os.Stat(contentPath); err == nil {
		rel, _ := filepath.Rel(s.workspaceRoot(), contentPath)
		rel = filepath.ToSlash(rel)
		canonicalID := rel
		if isSkillPathID(rel) {
			canonicalID = rel
		} else if isSkillPathID(id) {
			canonicalID = filepath.ToSlash(id)
		}
		groupID := groupIDFromRelDir(filepath.ToSlash(filepath.Dir(rel)))
		return s.readNoteFile(canonicalID, contentPath, groupID)
	}
	if strings.Contains(id, "/") || strings.HasSuffix(strings.ToLower(id), ".md") {
		abs := filepath.Join(s.workspaceRoot(), filepath.FromSlash(id))
		if st, e := os.Stat(abs); e == nil && !st.IsDir() {
			relDir := filepath.ToSlash(filepath.Dir(id))
			return s.readNoteFile(filepath.ToSlash(id), abs, groupIDFromRelDir(relDir))
		}
	}
	// 短名优先直达 SKILL.md，避免扫描时误命中同目录 log.md
	if !strings.Contains(id, "/") {
		if skillID := SkillNoteID(id); skillID != "" && skillID != id {
			if n, e := s.getNoteFS(skillID); e == nil && n != nil {
				return n, nil
			}
		}
	}
	list, err := s.listNotesFS()
	if err != nil {
		return nil, err
	}
	var basenameHits []string
	for _, sum := range list {
		if sum.ID == id || SkillNameFromNoteID(sum.ID) == id {
			return s.getNoteFS(sum.ID)
		}
		if SkillBasename(sum.ID) == id {
			basenameHits = append(basenameHits, sum.ID)
		}
	}
	if len(basenameHits) == 1 {
		return s.getNoteFS(basenameHits[0])
	}
	// 同名时优先任务默认落点 工作流/{id}
	for _, hit := range basenameHits {
		if SkillNameFromNoteID(hit) == id && strings.HasPrefix(hit, SkillGroupName+"/") {
			return s.getNoteFS(hit)
		}
	}
	if len(basenameHits) > 0 {
		return s.getNoteFS(basenameHits[0])
	}
	return nil, errno.New(errno.CodeNotFound, "笔记不存在", id)
}

func (s *Service) readNoteFile(id, path, groupID string) (*model.NoteDO, error) {
	raw, err := os.ReadFile(path)
	if err != nil {
		return nil, errno.Wrap(errno.CodeStoreFailed, "读取笔记失败", err)
	}
	info, _ := os.Stat(path)
	mt := time.Now().Unix()
	ct := mt
	if info != nil {
		mt = info.ModTime().Unix()
		ct = mt
	}
	base := filepath.Base(path)
	n := &model.NoteDO{
		ID:        id,
		GroupID:   groupID,
		Content:   string(raw),
		Language:  languageFromFilename(base),
		CreatedAt: ct,
		UpdatedAt: mt,
	}
	SyncNoteMeta(n)
	// 标题=去扩展名；侧栏展示用磁盘 basename（id），此处不改写
	n.Title = titleFromFilename(base)
	if isSkillPathID(id) || strings.EqualFold(base, SkillEntryFile) {
		n.Role = model.NoteRoleSkill
		n.Language = "markdown"
		if n.GroupID == "" {
			n.GroupID = filepath.ToSlash(filepath.Dir(id))
		}
	}
	return n, nil
}

func (s *Service) saveNoteFS(n model.NoteDO) (*model.NoteDO, error) {
	if strings.TrimSpace(n.Title) == "" {
		return nil, errno.New(errno.CodeInvalidArg, "笔记标题不能为空", "")
	}
	SyncNoteMeta(&n)
	if n.Language == "" {
		n.Language = "markdown"
	}

	var oldContent, oldAssets string
	if n.ID != "" {
		oldContent, oldAssets, _ = s.notePaths(n.ID)
	}

	if n.Role == model.NoteRoleSkill || isSkillPathID(n.ID) {
		n.Role = model.NoteRoleSkill
		// 已在任意业务根下的 SKILL.md：就地保存，不迁回「工作流/」
		if !isSkillPathID(n.ID) {
			ref := ""
			if g := strings.TrimSpace(filepath.ToSlash(n.GroupID)); g != "" && g != SkillGroupName {
				// 落在指定分组目录下
				ref = g
			}
			if ref == "" {
				ref = SkillNameFromNoteID(n.ID)
			}
			if ref == "" {
				ref = ReadLinkedSkillID(n.Content)
			}
			if ref == "" {
				if fm, _, ok := PeekFrontmatter(n.Content); ok {
					ref = FrontmatterString(fm, "name")
					if ref == "" {
						ref = FrontmatterString(fm, "skillId")
					}
				}
			}
			if ref == "" {
				ref = SuggestSkillID(n.Title, n.ID)
			}
			n.ID = SkillNoteID(ref)
		}
		if dirRel := SkillDirFromNoteID(n.ID); dirRel != "" {
			n.GroupID = dirRel
		}
		dir, _, ok := s.skillDirAbs(n.ID)
		if !ok {
			return nil, errno.New(errno.CodeInvalidArg, "非法 Skill 路径", n.ID)
		}
		if err := os.MkdirAll(filepath.Join(dir, SkillAssetsDir), 0o700); err != nil {
			return nil, errno.Wrap(errno.CodeStoreFailed, "创建 Skill 目录失败", err)
		}
		_ = os.MkdirAll(filepath.Join(dir, SkillScriptsDir), 0o700)
		path := filepath.Join(dir, SkillEntryFile)
		if err := os.WriteFile(path, []byte(n.Content), 0o600); err != nil {
			return nil, errno.Wrap(errno.CodeStoreFailed, "写入 Skill 失败", err)
		}
		if oldContent != "" && !sameFile(oldContent, path) {
			_ = os.Remove(oldContent)
			newAssets := filepath.Join(dir, SkillAssetsDir)
			if oldAssets != "" && !sameFile(oldAssets, newAssets) {
				if entries, err := os.ReadDir(oldAssets); err == nil {
					for _, e := range entries {
						_ = os.Rename(filepath.Join(oldAssets, e.Name()), filepath.Join(newAssets, e.Name()))
					}
					_ = os.RemoveAll(oldAssets)
				}
			}
		}
	} else {
		path, err := s.plainNoteSavePath(&n)
		if err != nil {
			return nil, err
		}
		if err := os.MkdirAll(filepath.Dir(path), 0o700); err != nil {
			return nil, errno.Wrap(errno.CodeStoreFailed, "创建笔记目录失败", err)
		}
		if err := os.WriteFile(path, []byte(n.Content), 0o600); err != nil {
			return nil, errno.Wrap(errno.CodeStoreFailed, "写入笔记失败", err)
		}
		rel, _ := filepath.Rel(s.workspaceRoot(), path)
		n.ID = filepath.ToSlash(rel)
		if oldContent != "" && !sameFile(oldContent, path) {
			_ = os.Remove(oldContent)
			newAssets := strings.TrimSuffix(path, filepath.Ext(path)) + PlainAssetsSuffix
			if oldAssets != "" && !sameFile(oldAssets, newAssets) {
				if _, err := os.Stat(oldAssets); err == nil {
					_ = os.Rename(oldAssets, newAssets)
				}
			}
		}
	}
	now := time.Now().Unix()
	if n.CreatedAt == 0 {
		n.CreatedAt = now
	}
	n.UpdatedAt = now
	return s.getNoteFS(n.ID)
}

func (s *Service) plainNoteSavePath(n *model.NoteDO) (string, error) {
	if n.ID == SeedMemoryNoteID {
		n.GroupID = MemoryGroupName
		n.ID = SeedMemoryNoteID
		return filepath.Join(s.workspaceRoot(), MemoryGroupName, "怎么用记忆区.md"), nil
	}
	id := strings.TrimSpace(n.ID)
	// 已有带扩展名的磁盘路径：尊重真源（.md / .js / …）
	if id != "" && !strings.Contains(id, "..") && filepath.Ext(id) != "" {
		return filepath.Join(s.workspaceRoot(), filepath.FromSlash(id)), nil
	}
	dir, err := s.groupDirAbs(n.GroupID)
	if err != nil {
		return "", err
	}
	stem := sanitizeFileStem(n.Title)
	if stem == "" {
		stem = "未命名"
	}
	// 标题误带扩展名时剥掉，并以该扩展为准
	if e := filepath.Ext(stem); e != "" {
		n.Language = languageFromFilename(stem)
		stem = sanitizeFileStem(titleFromFilename(stem))
		if stem == "" {
			stem = "未命名"
		}
	}
	ext := extForLanguage(n.Language)
	path := filepath.Join(dir, stem+ext)
	if _, err := os.Stat(path); err == nil {
		if cur := filepath.Join(s.workspaceRoot(), filepath.FromSlash(n.ID)); n.ID != "" && sameFile(cur, path) {
			return path, nil
		}
		path = filepath.Join(dir, stem+"-"+shortID()+ext)
	}
	return path, nil
}

func (s *Service) deleteNoteFS(id string) error {
	contentPath, assetsDir, err := s.notePaths(id)
	if err != nil {
		return err
	}
	if dir, _, ok := s.skillDirAbs(id); ok {
		if err := os.RemoveAll(dir); err != nil {
			return errno.Wrap(errno.CodeStoreFailed, "删除 Skill 失败", err)
		}
		return nil
	}
	_ = os.Remove(contentPath)
	_ = os.RemoveAll(assetsDir)
	return nil
}

func (s *Service) searchNotesFS(keyword string) ([]model.NoteSummaryDO, error) {
	keyword = strings.TrimSpace(strings.ToLower(keyword))
	all, err := s.listNotesFS()
	if err != nil {
		return nil, err
	}
	if keyword == "" {
		return all, nil
	}
	var out []model.NoteSummaryDO
	for _, sum := range all {
		if strings.Contains(strings.ToLower(sum.Title), keyword) {
			out = append(out, sum)
			continue
		}
		n, err := s.getNoteFS(sum.ID)
		if err != nil || n == nil {
			continue
		}
		if strings.Contains(strings.ToLower(n.Content), keyword) {
			out = append(out, sum)
		}
	}
	return out, nil
}

func (s *Service) applyLayoutFS(layout model.NotebookLayoutDO) error {
	// 组顺序：写根 .wwb-order.json（目录名）
	var names []string
	for _, gid := range layout.GroupOrder {
		gid = strings.TrimSpace(gid)
		if gid == "" || strings.Contains(gid, "/") {
			continue // 只排根目录
		}
		names = append(names, filepath.Base(filepath.FromSlash(gid)))
	}
	if err := s.writeOrder(s.workspaceRoot(), names); err != nil {
		return err
	}
	// 笔记归属：按目标组移动文件/目录
	for gid, ids := range layout.NotesByGroup {
		targetDir, err := s.groupDirAbs(gid)
		if err != nil {
			continue
		}
		_ = os.MkdirAll(targetDir, 0o700)
		var orderIDs []string
		for i, id := range ids {
			id = strings.TrimSpace(id)
			if id == "" {
				continue
			}
			orderIDs = append(orderIDs, id)
			n, err := s.getNoteFS(id)
			if err != nil || n == nil {
				continue
			}
			if n.GroupID == gid && n.SortOrder == i {
				continue
			}
			n.GroupID = gid
			n.SortOrder = i
			if _, err := s.saveNoteFS(*n); err != nil {
				return err
			}
		}
		_ = s.writeOrder(targetDir, orderIDs)
	}
	return nil
}

func (s *Service) readOrder(dir string) []string {
	raw, err := os.ReadFile(filepath.Join(dir, GroupOrderFile))
	if err != nil {
		return nil
	}
	var list []string
	if json.Unmarshal(raw, &list) != nil {
		return nil
	}
	return list
}

func (s *Service) writeOrder(dir string, names []string) error {
	if err := os.MkdirAll(dir, 0o700); err != nil {
		return err
	}
	raw, err := json.MarshalIndent(names, "", "  ")
	if err != nil {
		return err
	}
	return os.WriteFile(filepath.Join(dir, GroupOrderFile), raw, 0o600)
}

func toSummary(n model.NoteDO) model.NoteSummaryDO {
	return model.NoteSummaryDO{
		ID: n.ID, GroupID: n.GroupID, Title: n.Title, Language: n.Language,
		Role: n.Role, SSHHostID: n.SSHHostID, ConnectionID: n.ConnectionID,
		SortOrder: n.SortOrder, UpdatedAt: n.UpdatedAt,
	}
}

func sanitizeFileStem(title string) string {
	title = strings.TrimSpace(title)
	var b strings.Builder
	for _, r := range title {
		switch {
		case r == '/' || r == '\\' || r == 0 || r == ':' || r == '*' || r == '?' || r == '"' || r == '<' || r == '>' || r == '|':
			continue
		case unicode.IsControl(r):
			continue
		default:
			b.WriteRune(r)
		}
	}
	out := strings.TrimSpace(b.String())
	out = strings.Trim(out, ". ")
	if len([]rune(out)) > 80 {
		out = string([]rune(out)[:80])
	}
	return out
}

func shortID() string {
	return strings.ReplaceAll(uuid.NewString(), "-", "")[:8]
}

func sameFile(a, b string) bool {
	a, _ = filepath.Abs(a)
	b, _ = filepath.Abs(b)
	return a == b
}
