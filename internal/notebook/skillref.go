package notebook

import (
	"path/filepath"
	"strings"
)

// Skill 路径域（单一寻址规则）
//
// 协议：任意目录下的 SKILL.md + 同级 log.md / assets / scripts。
// 「工作流/」只是任务产品默认落点，不是唯一合法位置。
//
// 引用形态：
//   - 短名 demo          → 工作流/demo/SKILL.md（任务区默认）
//   - 目录路径 a/b/c     → a/b/c/SKILL.md（就地；不做短名映射）
//   - 已是 …/SKILL.md    → 原样

// SkillNoteID 把 skill 引用规范成 …/SKILL.md 相对路径。
// 短名 → 工作流/{name}/SKILL.md；含路径 → 该目录下 SKILL.md。
func SkillNoteID(name string) string {
	name = strings.TrimSpace(strings.ReplaceAll(name, "\\", "/"))
	name = strings.Trim(name, "/")
	if name == "" {
		return ""
	}
	lower := strings.ToLower(name)
	if strings.HasSuffix(lower, "/"+strings.ToLower(SkillEntryFile)) {
		return name
	}
	if strings.EqualFold(name, SkillEntryFile) {
		return ""
	}
	if strings.Contains(name, "/") {
		return SkillEntryIDInDir(name)
	}
	if strings.ContainsAny(name, `\`) {
		return ""
	}
	// 业务根名本身按目录处理，避免「运维」被当成短名落到 工作流/运维/
	if IsBusinessRootName(name) {
		return SkillEntryIDInDir(name)
	}
	return SkillGroupName + "/" + name + "/" + SkillEntryFile
}

// SkillEntryIDInDir 目录相对路径 → …/SKILL.md（不做短名→工作流/ 映射）。
func SkillEntryIDInDir(dir string) string {
	dir = strings.Trim(strings.ReplaceAll(dir, "\\", "/"), "/")
	if dir == "" || strings.Contains(dir, "..") {
		return ""
	}
	return dir + "/" + SkillEntryFile
}

// IsBusinessRootName 是否为笔记本一级业务根目录名。
func IsBusinessRootName(name string) bool {
	return IsSystemTopDir(name)
}

// SkillDirFromNoteID 从 SKILL.md 路径取技能目录相对路径；非入口文件返回空。
func SkillDirFromNoteID(id string) string {
	id = strings.TrimSpace(strings.ReplaceAll(id, "\\", "/"))
	if id == "" {
		return ""
	}
	lower := strings.ToLower(id)
	suffix := "/" + strings.ToLower(SkillEntryFile)
	if !strings.HasSuffix(lower, suffix) {
		return ""
	}
	dir := strings.Trim(id[:len(id)-len(suffix)], "/")
	if dir == "" || strings.Contains(dir, "..") {
		return ""
	}
	return dir
}

// SkillNameFromNoteID 从 SKILL.md 路径还原对外引用名。
// 工作流/{short}/SKILL.md → short；其它位置 → 完整目录路径。
func SkillNameFromNoteID(id string) string {
	dir := SkillDirFromNoteID(id)
	if dir == "" {
		return ""
	}
	if strings.HasPrefix(dir, SkillGroupName+"/") {
		rest := strings.TrimPrefix(dir, SkillGroupName+"/")
		if rest != "" && !strings.Contains(rest, "/") {
			return rest
		}
	}
	return dir
}

// SkillBasename 技能目录末段名（短名消歧用）。
func SkillBasename(idOrName string) string {
	idOrName = strings.TrimSpace(strings.ReplaceAll(idOrName, "\\", "/"))
	if idOrName == "" {
		return ""
	}
	if dir := SkillDirFromNoteID(idOrName); dir != "" {
		return filepath.Base(dir)
	}
	if strings.HasSuffix(strings.ToLower(idOrName), "/"+strings.ToLower(SkillEntryFile)) {
		return ""
	}
	idOrName = strings.TrimSuffix(idOrName, "/"+SkillEntryFile)
	return filepath.Base(idOrName)
}

// IsTaskLogNoteID 是否为技能目录旁的账本投影 …/log.md。
func IsTaskLogNoteID(id string) bool {
	id = strings.TrimSpace(strings.ReplaceAll(id, "\\", "/"))
	if id == "" {
		return false
	}
	lower := strings.ToLower(id)
	if !strings.HasSuffix(lower, "/"+strings.ToLower(TaskLogFile)) {
		return false
	}
	dir := strings.Trim(id[:len(id)-len("/"+TaskLogFile)], "/")
	return dir != "" && !strings.Contains(dir, "..")
}

// NoteParentDir 笔记相对路径的父目录（slash）；根下文件返回空。
func NoteParentDir(noteID string) string {
	noteID = strings.Trim(strings.ReplaceAll(strings.TrimSpace(noteID), "\\", "/"), "/")
	if noteID == "" {
		return ""
	}
	dir := strings.Trim(filepath.ToSlash(filepath.Dir(noteID)), "/")
	if dir == "" || dir == "." {
		return ""
	}
	if strings.Contains(dir, "..") {
		return ""
	}
	return dir
}
