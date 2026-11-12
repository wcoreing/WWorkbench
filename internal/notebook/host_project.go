package notebook

import (
	"fmt"
	"os"
	"path/filepath"
	"strings"

	"WWorkbench/internal/errno"
	"WWorkbench/internal/model"
)

const (
	// MemoryProjectsDirName 主机册下的项目目录名。
	MemoryProjectsDirName = "项目"
	// ProjectBindingNoteFile 项目绑定约定笔记（localPath/remotePath）。
	ProjectBindingNoteFile = "约定.md"
)

// IsMemoryProjectDir 是否为 记忆区/{主机}/项目/{名}（恰好四级）。
func IsMemoryProjectDir(rel string) bool {
	rel = strings.Trim(filepath.ToSlash(strings.TrimSpace(rel)), "/")
	parts := strings.Split(rel, "/")
	if len(parts) != 4 {
		return false
	}
	return parts[0] == MemoryGroupName && parts[2] == MemoryProjectsDirName && parts[1] != "" && parts[3] != ""
}

// ProjectBindingNoteID 项目约定笔记相对路径。
func ProjectBindingNoteID(projectDirRel string) string {
	projectDirRel = strings.Trim(filepath.ToSlash(strings.TrimSpace(projectDirRel)), "/")
	if projectDirRel == "" {
		return ""
	}
	return projectDirRel + "/" + ProjectBindingNoteFile
}

// HostProjectFromNote 从约定笔记解析项目绑定。
func HostProjectFromNote(dirRel string, n *model.NoteDO) model.HostProjectDO {
	dirRel = strings.Trim(filepath.ToSlash(strings.TrimSpace(dirRel)), "/")
	out := model.HostProjectDO{
		DirRel: dirRel,
		Name:   filepath.Base(dirRel),
		NoteID: ProjectBindingNoteID(dirRel),
	}
	if n == nil {
		return out
	}
	out.NoteID = n.ID
	out.SSHHostID = strings.TrimSpace(n.SSHHostID)
	fm, _, ok := splitFrontmatterMap(n.Content)
	if ok {
		if out.SSHHostID == "" {
			out.SSHHostID = fmString(fm, "sshHostId")
		}
		out.LocalPath = fmString(fm, "localPath")
		out.RemotePath = fmString(fm, "remotePath")
	}
	if skillID := SkillNoteID(dirRel); skillID != "" {
		out.SkillNoteID = skillID
	}
	return out
}

// GetHostProject 读取项目绑定（无约定笔记则返回空路径的壳）。
func (s *Service) GetHostProject(dirRel string) (*model.HostProjectDO, error) {
	dirRel = strings.Trim(filepath.ToSlash(strings.TrimSpace(dirRel)), "/")
	if !IsMemoryProjectDir(dirRel) {
		return nil, errno.New(errno.CodeInvalidArg, "不是记忆区项目目录（记忆区/{主机}/项目/{名}）", dirRel)
	}
	noteID := ProjectBindingNoteID(dirRel)
	n, err := s.GetNote(noteID)
	if err != nil {
		// 目录在但还没约定笔记
		p := HostProjectFromNote(dirRel, nil)
		if skillPath := filepath.Join(s.workspaceRoot(), filepath.FromSlash(dirRel), SkillEntryFile); fileExists(skillPath) {
			p.SkillNoteID = dirRel + "/" + SkillEntryFile
		}
		return &p, nil
	}
	p := HostProjectFromNote(dirRel, n)
	if fileExists(filepath.Join(s.workspaceRoot(), filepath.FromSlash(dirRel), SkillEntryFile)) {
		p.SkillNoteID = dirRel + "/" + SkillEntryFile
	} else {
		p.SkillNoteID = ""
	}
	return &p, nil
}

// ListHostProjects 列出记忆区下全部项目绑定；sshHostId 非空时按主机过滤。
func (s *Service) ListHostProjects(sshHostID string) ([]model.HostProjectDO, error) {
	if err := s.EnsureFSNotebook(); err != nil {
		return nil, err
	}
	sshHostID = strings.TrimSpace(sshHostID)
	root := filepath.Join(s.workspaceRoot(), MemoryGroupName)
	hostEntries, err := os.ReadDir(root)
	if err != nil {
		if os.IsNotExist(err) {
			return []model.HostProjectDO{}, nil
		}
		return nil, errno.Wrap(errno.CodeStoreFailed, "读取记忆区失败", err)
	}
	var out []model.HostProjectDO
	for _, he := range hostEntries {
		if !he.IsDir() || strings.HasPrefix(he.Name(), ".") {
			continue
		}
		projRoot := filepath.Join(root, he.Name(), MemoryProjectsDirName)
		projEntries, err := os.ReadDir(projRoot)
		if err != nil {
			continue
		}
		for _, pe := range projEntries {
			if !pe.IsDir() || strings.HasPrefix(pe.Name(), ".") {
				continue
			}
			dirRel := MemoryGroupName + "/" + he.Name() + "/" + MemoryProjectsDirName + "/" + pe.Name()
			p, err := s.GetHostProject(dirRel)
			if err != nil || p == nil {
				continue
			}
			if sshHostID != "" && p.SSHHostID != "" && p.SSHHostID != sshHostID {
				continue
			}
			out = append(out, *p)
		}
	}
	return out, nil
}

// SaveHostProject 写入/更新项目约定笔记的 localPath/remotePath/sshHostId。
func (s *Service) SaveHostProject(in model.HostProjectDO) (*model.HostProjectDO, error) {
	dirRel := strings.Trim(filepath.ToSlash(strings.TrimSpace(in.DirRel)), "/")
	if !IsMemoryProjectDir(dirRel) {
		return nil, errno.New(errno.CodeInvalidArg, "不是记忆区项目目录（记忆区/{主机}/项目/{名}）", dirRel)
	}
	if err := s.EnsureFSNotebook(); err != nil {
		return nil, err
	}
	absDir := filepath.Join(s.workspaceRoot(), filepath.FromSlash(dirRel))
	if err := os.MkdirAll(absDir, 0o700); err != nil {
		return nil, errno.Wrap(errno.CodeStoreFailed, "创建项目目录失败", err)
	}

	noteID := ProjectBindingNoteID(dirRel)
	existing, _ := s.GetNote(noteID)
	// 读-改-写：调用方传入完整绑定；空串表示清除该字段
	localPath := strings.TrimSpace(in.LocalPath)
	remotePath := strings.TrimSpace(in.RemotePath)
	sshHostID := strings.TrimSpace(in.SSHHostID)
	title := "约定"
	var body string
	fmMap := map[string]interface{}{}
	if existing != nil {
		title = existing.Title
		if title == "" {
			title = "约定"
		}
		var has bool
		fmMap, body, has = splitFrontmatterMap(existing.Content)
		if !has {
			fmMap = map[string]interface{}{}
			body = strings.TrimLeft(existing.Content, " \t\r\n")
		}
		if sshHostID == "" {
			sshHostID = strings.TrimSpace(existing.SSHHostID)
			if sshHostID == "" {
				sshHostID = fmString(fmMap, "sshHostId")
			}
		}
	} else if sshHostID == "" {
		parts := strings.Split(dirRel, "/")
		if len(parts) >= 2 {
			if idx, err := s.GetNote(MemoryGroupName + "/" + parts[1] + "/" + MemoryBookIndexFile); err == nil && idx != nil {
				sshHostID = strings.TrimSpace(idx.SSHHostID)
			}
		}
	}
	fmMap["role"] = model.NoteRoleMemory
	if sshHostID != "" {
		fmMap["sshHostId"] = sshHostID
	} else {
		delete(fmMap, "sshHostId")
	}
	if localPath != "" {
		fmMap["localPath"] = localPath
	} else {
		delete(fmMap, "localPath")
	}
	if remotePath != "" {
		fmMap["remotePath"] = remotePath
	} else {
		delete(fmMap, "remotePath")
	}
	if strings.TrimSpace(body) == "" || !strings.Contains(body, "本地目录") {
		body = defaultProjectBindingBody(dirRel, localPath, remotePath)
	} else {
		body = rewriteProjectBindingBodyPaths(body, localPath, remotePath)
	}
	content := joinFrontmatterMap(fmMap, body)

	note := model.NoteDO{
		ID:        noteID,
		GroupID:   dirRel,
		Title:     title,
		Content:   content,
		Language:  "markdown",
		Role:      model.NoteRoleMemory,
		SSHHostID: sshHostID,
	}
	if existing != nil {
		note.SortOrder = existing.SortOrder
		note.CreatedAt = existing.CreatedAt
		note.ConnectionID = existing.ConnectionID
	}
	saved, err := s.SaveNote(note)
	if err != nil {
		return nil, err
	}
	p := HostProjectFromNote(dirRel, saved)
	if fileExists(filepath.Join(absDir, SkillEntryFile)) {
		p.SkillNoteID = dirRel + "/" + SkillEntryFile
	}
	return &p, nil
}

func defaultProjectBindingBody(dirRel, localPath, remotePath string) string {
	name := filepath.Base(dirRel)
	var b strings.Builder
	fmt.Fprintf(&b, "# %s 约定\n\n", name)
	b.WriteString(projectPathBullet("本地目录", localPath))
	b.WriteString(projectPathBullet("远端目录", remotePath))
	b.WriteString("- 发版：同目录 `SKILL.md` → `get_skill`\n")
	return b.String()
}

func projectPathBullet(label, path string) string {
	if strings.TrimSpace(path) != "" {
		return fmt.Sprintf("- %s：`%s`\n", label, path)
	}
	return fmt.Sprintf("- %s：（未设置；侧栏右键「设置%s」）\n", label, label)
}

func rewriteProjectBindingBodyPaths(body, localPath, remotePath string) string {
	lines := strings.Split(body, "\n")
	var out []string
	seenLocal, seenRemote := false, false
	for _, ln := range lines {
		trim := strings.TrimSpace(ln)
		if strings.HasPrefix(trim, "- 本地目录") {
			out = append(out, strings.TrimSuffix(projectPathBullet("本地目录", localPath), "\n"))
			seenLocal = true
			continue
		}
		if strings.HasPrefix(trim, "- 远端目录") {
			out = append(out, strings.TrimSuffix(projectPathBullet("远端目录", remotePath), "\n"))
			seenRemote = true
			continue
		}
		out = append(out, ln)
	}
	if !seenLocal || !seenRemote {
		var inject []string
		if !seenLocal {
			inject = append(inject, strings.TrimSuffix(projectPathBullet("本地目录", localPath), "\n"))
		}
		if !seenRemote {
			inject = append(inject, strings.TrimSuffix(projectPathBullet("远端目录", remotePath), "\n"))
		}
		// 插在首个标题后
		inserted := false
		var merged []string
		for i, ln := range out {
			merged = append(merged, ln)
			if !inserted && strings.HasPrefix(strings.TrimSpace(ln), "#") {
				merged = append(merged, "")
				merged = append(merged, inject...)
				inserted = true
				_ = i
			}
		}
		if !inserted {
			merged = append(inject, merged...)
		}
		out = merged
	}
	return strings.TrimRight(strings.Join(out, "\n"), "\n") + "\n"
}

func fileExists(path string) bool {
	st, err := os.Stat(path)
	return err == nil && !st.IsDir()
}
