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
	// MemoryBookIndexFile 主机册索引笔记文件名。
	MemoryBookIndexFile = "主机记忆.md"
)

// MemoryBookDirName 把主机显示名收成安全目录名。
func MemoryBookDirName(hostName string) string {
	name := sanitizeFileStem(hostName)
	name = strings.TrimLeft(name, ".")
	name = strings.TrimSpace(name)
	if name == "" {
		return "未命名主机"
	}
	return name
}

// MemoryBookDirRel 主机册目录相对路径：记忆区/{主机名}。
func MemoryBookDirRel(hostName string) string {
	return MemoryGroupName + "/" + MemoryBookDirName(hostName)
}

// MemoryBookIndexNoteID 主机册索引笔记 id。
func MemoryBookIndexNoteID(hostName string) string {
	return MemoryBookDirRel(hostName) + "/" + MemoryBookIndexFile
}

// NoteUnderBooklet 笔记是否落在任一主机册目录下。
func NoteUnderBooklet(noteID string, bookletPrefixes []string) bool {
	id := strings.TrimSpace(filepath.ToSlash(noteID))
	if id == "" {
		return false
	}
	for _, p := range bookletPrefixes {
		p = strings.TrimSpace(filepath.ToSlash(p))
		if p == "" {
			continue
		}
		if id == p || strings.HasPrefix(id, p+"/") {
			return true
		}
	}
	return false
}

// EnsureHostMemoryBook 幂等创建记忆区/{主机名}/ 与索引记忆笔记（role=memory + sshHostId）。
// 若该主机已有册（按 sshHostId 找到），复用旧目录，避免改名后重复成册。
func (s *Service) EnsureHostMemoryBook(hostID, hostName, user, host string, port int) (dirRel, noteID string, created bool, err error) {
	hostID = strings.TrimSpace(hostID)
	if hostID == "" {
		return "", "", false, errno.New(errno.CodeInvalidArg, "sshHostId 为空", "")
	}
	if err := s.EnsureFSNotebook(); err != nil {
		return "", "", false, err
	}
	if existingDir, existingNote, ok := s.findMemoryBookByHostID(hostID); ok {
		return existingDir, existingNote, false, nil
	}

	dirRel = MemoryBookDirRel(hostName)
	noteID = MemoryBookIndexNoteID(hostName)
	absDir := filepath.Join(s.workspaceRoot(), filepath.FromSlash(dirRel))
	if err := os.MkdirAll(absDir, 0o700); err != nil {
		return "", "", false, errno.Wrap(errno.CodeStoreFailed, "创建主机记忆册失败", err)
	}

	absNote := filepath.Join(s.workspaceRoot(), filepath.FromSlash(noteID))
	if _, statErr := os.Stat(absNote); statErr == nil {
		if n, getErr := s.GetNote(noteID); getErr == nil && n != nil {
			changed := false
			if n.SSHHostID != hostID {
				n.SSHHostID = hostID
				changed = true
			}
			if n.Role != model.NoteRoleMemory {
				n.Role = model.NoteRoleMemory
				changed = true
			}
			if changed {
				_, _ = s.SaveNote(*n)
			}
		}
		return dirRel, noteID, false, nil
	}

	if port <= 0 {
		port = 22
	}
	display := MemoryBookDirName(hostName)
	endpoint := strings.TrimSpace(host)
	if user != "" && endpoint != "" {
		endpoint = fmt.Sprintf("%s@%s:%d", user, host, port)
	} else if endpoint != "" {
		endpoint = fmt.Sprintf("%s:%d", host, port)
	} else {
		endpoint = hostID
	}
	content := fmt.Sprintf(
		"---\nrole: memory\nsshHostId: %s\n---\n\n# %s 主机记忆\n\n绑定：`%s`\n\n"+
			"把这台机的坑、约定、路径、口令位置写在本册（同目录可再加笔记）。\n\n"+
			"项目部署等方法：建 `项目/{名}/SKILL.md`（工作流协议，get_skill 传完整路径）。\n\n"+
			"Agent 开跑优先注入本册；动手前 get_note；要发布再 get_skill。\n",
		hostID, display, endpoint,
	)
	n := model.NoteDO{
		ID:        noteID,
		GroupID:   dirRel,
		Title:     "主机记忆",
		Content:   content,
		Language:  "markdown",
		Role:      model.NoteRoleMemory,
		SSHHostID: hostID,
	}
	if _, saveErr := s.SaveNote(n); saveErr != nil {
		return "", "", false, saveErr
	}
	return dirRel, noteID, true, nil
}

func (s *Service) findMemoryBookByHostID(hostID string) (dirRel, noteID string, ok bool) {
	hostID = strings.TrimSpace(hostID)
	if hostID == "" {
		return "", "", false
	}
	list, err := s.ListMemoryNotes(200)
	if err != nil {
		return "", "", false
	}
	prefix := MemoryGroupName + "/"
	var best string
	for _, n := range list {
		if n.SSHHostID != hostID {
			continue
		}
		id := filepath.ToSlash(n.ID)
		if !strings.HasPrefix(id, prefix) {
			continue
		}
		// 优先索引文件
		if strings.HasSuffix(id, "/"+MemoryBookIndexFile) {
			dir := filepath.ToSlash(filepath.Dir(id))
			return dir, id, true
		}
		if best == "" {
			best = id
		}
	}
	if best == "" {
		return "", "", false
	}
	dir := filepath.ToSlash(filepath.Dir(best))
	if dir == "." || dir == MemoryGroupName {
		return MemoryGroupName, best, true
	}
	return dir, best, true
}
