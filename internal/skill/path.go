package skill

import (
	"path/filepath"
	"strings"
)

// EntryInDir 目录相对路径 → …/SKILL.md（不做产品默认根映射）。
func EntryInDir(dir string) string {
	dir = cleanSlash(dir)
	if dir == "" || strings.Contains(dir, "..") {
		return ""
	}
	return dir + "/" + EntryFile
}

// DirFromEntry 从 …/SKILL.md 取目录；非入口返回空。
func DirFromEntry(id string) string {
	id = cleanSlash(id)
	if id == "" {
		return ""
	}
	suffix := "/" + strings.ToLower(EntryFile)
	lower := strings.ToLower(id)
	if !strings.HasSuffix(lower, suffix) {
		if strings.EqualFold(id, EntryFile) {
			return ""
		}
		return ""
	}
	dir := strings.Trim(id[:len(id)-len(suffix)], "/")
	if dir == "" || strings.Contains(dir, "..") {
		return ""
	}
	return dir
}

// Basename 目录末段。
func Basename(ref string) string {
	ref = cleanSlash(ref)
	if dir := DirFromEntry(ref); dir != "" {
		return filepath.Base(dir)
	}
	ref = strings.TrimSuffix(ref, "/"+EntryFile)
	return filepath.Base(ref)
}

// FirstRoot 一级路径段（业务根提示，不解释语义）。
func FirstRoot(ref string) string {
	dir := DirFromEntry(ref)
	if dir == "" {
		dir = cleanSlash(ref)
	}
	if dir == "" {
		return ""
	}
	i := strings.IndexByte(dir, '/')
	if i < 0 {
		return dir
	}
	return dir[:i]
}

func cleanSlash(p string) string {
	return strings.Trim(strings.ReplaceAll(strings.TrimSpace(p), "\\", "/"), "/")
}
