package notebook

import (
	"io"
	"os"
	"path/filepath"
	"strings"

	"WWorkbench/internal/errno"
	"WWorkbench/internal/model"
)

// PathMutation 路径变更结果（from → to，工作区相对路径）。
type PathMutation struct {
	From string `json:"from"`
	To   string `json:"to"`
}

// resolveRel 把工作区相对路径解析为绝对路径；禁止逃逸。
func (s *Service) resolveRel(rel string) (abs, clean string, err error) {
	if s == nil || s.dataDir == "" {
		return "", "", errnoNotebook("笔记本未就绪")
	}
	rel = strings.TrimSpace(filepath.ToSlash(rel))
	rel = strings.TrimPrefix(rel, "/")
	if rel == "." {
		rel = ""
	}
	if strings.Contains(rel, "..") {
		return "", "", errno.New(errno.CodeInvalidArg, "非法路径", rel)
	}
	root := s.workspaceRoot()
	if rel == "" {
		return root, "", nil
	}
	abs = filepath.Join(root, filepath.FromSlash(rel))
	if !strings.HasPrefix(abs, root+string(filepath.Separator)) && abs != root {
		return "", "", errno.New(errno.CodeInvalidArg, "路径越界", rel)
	}
	return abs, rel, nil
}

func (s *Service) isProtectedTopDir(rel string) bool {
	rel = strings.Trim(filepath.ToSlash(rel), "/")
	return rel == SkillGroupName || rel == MemoryGroupName
}

func validEntryName(name string) error {
	name = strings.TrimSpace(name)
	if name == "" || name == "." || name == ".." {
		return errno.New(errno.CodeInvalidArg, "名称无效", name)
	}
	if strings.ContainsAny(name, `/\`) || strings.HasPrefix(name, ".") {
		return errno.New(errno.CodeInvalidArg, "名称非法", name)
	}
	return nil
}

// CreateDir 在 parentRel 下建目录，返回新目录相对路径。
func (s *Service) CreateDir(parentRel, name string) (string, error) {
	if err := validEntryName(name); err != nil {
		return "", err
	}
	parentAbs, parentClean, err := s.resolveRel(parentRel)
	if err != nil {
		return "", err
	}
	info, err := os.Stat(parentAbs)
	if err != nil || !info.IsDir() {
		return "", errno.New(errno.CodeInvalidArg, "父目录不存在", parentRel)
	}
	abs := filepath.Join(parentAbs, name)
	if _, err := os.Stat(abs); err == nil {
		return "", errno.New(errno.CodeInvalidArg, "已存在同名目录", name)
	}
	if err := os.MkdirAll(abs, 0o700); err != nil {
		return "", errno.Wrap(errno.CodeStoreFailed, "创建目录失败", err)
	}
	if parentClean == "" {
		return name, nil
	}
	return parentClean + "/" + name, nil
}

// CreateNoteFile 在 parentRel 下新建空 markdown 笔记。
func (s *Service) CreateNoteFile(parentRel, name string) (*model.NoteDO, error) {
	name = strings.TrimSpace(name)
	if err := validEntryName(strings.TrimSuffix(name, ".md")); err != nil && !strings.HasSuffix(strings.ToLower(name), ".md") {
		return nil, err
	}
	if !strings.HasSuffix(strings.ToLower(name), ".md") {
		name += ".md"
	}
	stem := strings.TrimSuffix(name, filepath.Ext(name))
	if err := validEntryName(stem); err != nil {
		return nil, err
	}
	n := model.NoteDO{
		GroupID:  strings.TrimSpace(parentRel),
		Title:    stem,
		Content:  "",
		Language: "markdown",
		Role:     model.NoteRoleNote,
	}
	return s.SaveNote(n)
}

// RenameRel 重命名文件或目录（同级）；newName 不含路径。
func (s *Service) RenameRel(rel, newName string) (PathMutation, error) {
	rel = strings.TrimSpace(filepath.ToSlash(rel))
	if rel == "" {
		return PathMutation{}, errno.New(errno.CodeInvalidArg, "路径为空", "")
	}
	if s.isProtectedTopDir(rel) {
		return PathMutation{}, errno.New(errno.CodeInvalidArg, "不能重命名系统目录", rel)
	}
	// Skill 入口文件：重命名其目录名，而不是 SKILL.md
	if isSkillPathID(rel) {
		rel = filepath.ToSlash(filepath.Dir(rel))
	}
	if err := validEntryName(newName); err != nil {
		return PathMutation{}, err
	}
	abs, clean, err := s.resolveRel(rel)
	if err != nil {
		return PathMutation{}, err
	}
	info, err := os.Stat(abs)
	if err != nil {
		return PathMutation{}, errno.Wrap(errno.CodeNotFound, "路径不存在", err)
	}
	// 普通笔记文件：保留 .md 后缀习惯
	if !info.IsDir() && strings.HasSuffix(strings.ToLower(clean), ".md") &&
		!strings.HasSuffix(strings.ToLower(newName), ".md") {
		newName += ".md"
	}
	parent := filepath.Dir(abs)
	dst := filepath.Join(parent, newName)
	if sameFile(abs, dst) {
		return PathMutation{From: clean, To: clean}, nil
	}
	if _, err := os.Stat(dst); err == nil {
		return PathMutation{}, errno.New(errno.CodeInvalidArg, "目标已存在", newName)
	}
	if err := os.Rename(abs, dst); err != nil {
		return PathMutation{}, errno.Wrap(errno.CodeStoreFailed, "重命名失败", err)
	}
	toRel, _ := filepath.Rel(s.workspaceRoot(), dst)
	return PathMutation{From: clean, To: filepath.ToSlash(toRel)}, nil
}

// MoveRel 将 fromRel 移入 destDirRel（目录相对路径；空=工作区根）。
func (s *Service) MoveRel(fromRel, destDirRel string) (PathMutation, error) {
	fromRel = strings.TrimSpace(filepath.ToSlash(fromRel))
	if fromRel == "" {
		return PathMutation{}, errno.New(errno.CodeInvalidArg, "路径为空", "")
	}
	if s.isProtectedTopDir(fromRel) {
		return PathMutation{}, errno.New(errno.CodeInvalidArg, "不能移动系统目录", fromRel)
	}
	if isSkillPathID(fromRel) {
		fromRel = filepath.ToSlash(filepath.Dir(fromRel))
	}
	srcAbs, fromClean, err := s.resolveRel(fromRel)
	if err != nil {
		return PathMutation{}, err
	}
	if _, err := os.Stat(srcAbs); err != nil {
		return PathMutation{}, errno.Wrap(errno.CodeNotFound, "源路径不存在", err)
	}
	destAbs, destClean, err := s.resolveRel(destDirRel)
	if err != nil {
		return PathMutation{}, err
	}
	info, err := os.Stat(destAbs)
	if err != nil || !info.IsDir() {
		return PathMutation{}, errno.New(errno.CodeInvalidArg, "目标不是目录", destDirRel)
	}
	base := filepath.Base(srcAbs)
	dstAbs := filepath.Join(destAbs, base)
	// 禁止移入自身或子孙
	if srcAbs == dstAbs || strings.HasPrefix(dstAbs, srcAbs+string(filepath.Separator)) {
		return PathMutation{}, errno.New(errno.CodeInvalidArg, "不能移入自身或子目录", fromRel)
	}
	if destClean != "" && (fromClean == destClean || strings.HasPrefix(destClean, fromClean+"/")) {
		return PathMutation{}, errno.New(errno.CodeInvalidArg, "不能移入自身或子目录", fromRel)
	}
	if filepath.Dir(srcAbs) == destAbs {
		return PathMutation{From: fromClean, To: fromClean}, nil
	}
	if _, err := os.Stat(dstAbs); err == nil {
		return PathMutation{}, errno.New(errno.CodeInvalidArg, "目标已存在同名项", base)
	}
	if err := os.Rename(srcAbs, dstAbs); err != nil {
		return PathMutation{}, errno.Wrap(errno.CodeStoreFailed, "移动失败", err)
	}
	toRel, _ := filepath.Rel(s.workspaceRoot(), dstAbs)
	return PathMutation{From: fromClean, To: filepath.ToSlash(toRel)}, nil
}

// CopyRel 复制文件或目录到 destDirRel。
func (s *Service) CopyRel(fromRel, destDirRel string) (PathMutation, error) {
	fromRel = strings.TrimSpace(filepath.ToSlash(fromRel))
	if fromRel == "" {
		return PathMutation{}, errno.New(errno.CodeInvalidArg, "路径为空", "")
	}
	if isSkillPathID(fromRel) {
		fromRel = filepath.ToSlash(filepath.Dir(fromRel))
	}
	srcAbs, fromClean, err := s.resolveRel(fromRel)
	if err != nil {
		return PathMutation{}, err
	}
	srcInfo, err := os.Stat(srcAbs)
	if err != nil {
		return PathMutation{}, errno.Wrap(errno.CodeNotFound, "源路径不存在", err)
	}
	destAbs, _, err := s.resolveRel(destDirRel)
	if err != nil {
		return PathMutation{}, err
	}
	info, err := os.Stat(destAbs)
	if err != nil || !info.IsDir() {
		return PathMutation{}, errno.New(errno.CodeInvalidArg, "目标不是目录", destDirRel)
	}
	base := uniqueNameInDir(destAbs, filepath.Base(srcAbs))
	dstAbs := filepath.Join(destAbs, base)
	if srcInfo.IsDir() {
		if err := copyDir(srcAbs, dstAbs); err != nil {
			return PathMutation{}, errno.Wrap(errno.CodeStoreFailed, "复制目录失败", err)
		}
	} else {
		if err := copyFile(srcAbs, dstAbs); err != nil {
			return PathMutation{}, errno.Wrap(errno.CodeStoreFailed, "复制文件失败", err)
		}
	}
	toRel, _ := filepath.Rel(s.workspaceRoot(), dstAbs)
	return PathMutation{From: fromClean, To: filepath.ToSlash(toRel)}, nil
}

// DeleteRel 删除文件或目录（系统顶栏目录不可删）。
func (s *Service) DeleteRel(rel string) error {
	rel = strings.TrimSpace(filepath.ToSlash(rel))
	if rel == "" {
		return errno.New(errno.CodeInvalidArg, "路径为空", "")
	}
	if s.isProtectedTopDir(rel) {
		return errno.New(errno.CodeInvalidArg, "不能删除系统目录", rel)
	}
	if isSkillPathID(rel) {
		return s.deleteNoteFS(rel)
	}
	abs, _, err := s.resolveRel(rel)
	if err != nil {
		return err
	}
	info, err := os.Stat(abs)
	if err != nil {
		return errno.Wrap(errno.CodeNotFound, "路径不存在", err)
	}
	if info.IsDir() {
		// 若是 Skill 目录（含 SKILL.md），整目录删
		if _, err := os.Stat(filepath.Join(abs, SkillEntryFile)); err == nil {
			return os.RemoveAll(abs)
		}
		return os.RemoveAll(abs)
	}
	// 普通 .md：顺带删 .assets
	_ = os.Remove(abs)
	assets := strings.TrimSuffix(abs, filepath.Ext(abs)) + PlainAssetsSuffix
	_ = os.RemoveAll(assets)
	return nil
}

func uniqueNameInDir(dir, name string) string {
	candidate := name
	ext := filepath.Ext(name)
	stem := strings.TrimSuffix(name, ext)
	for i := 0; ; i++ {
		p := filepath.Join(dir, candidate)
		if _, err := os.Stat(p); err != nil {
			return candidate
		}
		if i == 0 {
			candidate = stem + " 副本" + ext
		} else {
			candidate = stem + " 副本" + shortID() + ext
		}
	}
}

func copyFile(src, dst string) error {
	in, err := os.Open(src)
	if err != nil {
		return err
	}
	defer in.Close()
	if err := os.MkdirAll(filepath.Dir(dst), 0o700); err != nil {
		return err
	}
	out, err := os.OpenFile(dst, os.O_CREATE|os.O_WRONLY|os.O_TRUNC, 0o600)
	if err != nil {
		return err
	}
	defer out.Close()
	_, err = io.Copy(out, in)
	return err
}

func copyDir(src, dst string) error {
	if err := os.MkdirAll(dst, 0o700); err != nil {
		return err
	}
	entries, err := os.ReadDir(src)
	if err != nil {
		return err
	}
	for _, e := range entries {
		s := filepath.Join(src, e.Name())
		d := filepath.Join(dst, e.Name())
		if e.IsDir() {
			if err := copyDir(s, d); err != nil {
				return err
			}
			continue
		}
		if err := copyFile(s, d); err != nil {
			return err
		}
	}
	return nil
}
