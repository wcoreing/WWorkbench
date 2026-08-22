package skillstore

import (
	"fmt"
	"os"
	"path/filepath"
	"strings"

	"WWorkbench/internal/model"

	nhskill "github.com/wcoreing/ningharness/skill"
)

// SkillsRootRel ningharness 内技能目录相对路径。
const SkillsRootRel = nhskill.RootDir

// ListSkillsDir 列出 system/skills/{subPath} 下直接子项。
func ListSkillsDir(projectRoot, subPath string) ([]model.FileEntryDO, error) {
	root := strings.TrimSpace(projectRoot)
	if root == "" {
		return nil, fmt.Errorf("empty project root")
	}
	abs, err := skillsAbs(root, subPath)
	if err != nil {
		return nil, err
	}
	info, err := os.Stat(abs)
	if err != nil {
		if os.IsNotExist(err) {
			return nil, nil
		}
		return nil, err
	}
	if !info.IsDir() {
		return nil, fmt.Errorf("路径不是目录")
	}
	ents, err := os.ReadDir(abs)
	if err != nil {
		return nil, err
	}
	prefix := filepath.ToSlash(strings.Trim(strings.TrimSpace(subPath), "/"))
	out := make([]model.FileEntryDO, 0, len(ents))
	for _, e := range ents {
		name := e.Name()
		if strings.HasPrefix(name, ".") {
			continue
		}
		rel := name
		if prefix != "" {
			rel = prefix + "/" + name
		}
		rel = filepath.ToSlash(rel)
		info, err := e.Info()
		if err != nil {
			continue
		}
		out = append(out, model.FileEntryDO{
			Name:    name,
			Path:    rel,
			IsDir:   e.IsDir(),
			Size:    info.Size(),
			ModTime: info.ModTime().Unix(),
		})
	}
	return out, nil
}

// ReadSkillFile 读取 system/skills/ 下相对路径文件正文。
func ReadSkillFile(projectRoot, relPath string) (string, error) {
	abs, err := skillFileAbs(projectRoot, relPath)
	if err != nil {
		return "", err
	}
	info, err := os.Stat(abs)
	if err != nil {
		return "", err
	}
	if info.IsDir() {
		return "", fmt.Errorf("路径是目录")
	}
	raw, err := os.ReadFile(abs)
	if err != nil {
		return "", err
	}
	return string(raw), nil
}

// WriteSkillFile 写入 system/skills/ 下相对路径文件。
func WriteSkillFile(projectRoot, relPath, content string) error {
	if isSkillMarkdownPath(relPath) {
		if err := validateSkillMD(content); err != nil {
			return fmt.Errorf("SKILL.md 须含标准 YAML frontmatter: %w", err)
		}
	}
	abs, err := skillFileAbs(projectRoot, relPath)
	if err != nil {
		return err
	}
	if err := os.MkdirAll(filepath.Dir(abs), 0o755); err != nil {
		return err
	}
	return os.WriteFile(abs, []byte(content), 0o644)
}

func skillsAbs(projectRoot, subPath string) (string, error) {
	base := nhskill.Dir(projectRoot)
	rel := filepath.ToSlash(strings.Trim(strings.TrimSpace(subPath), "/"))
	if strings.Contains(rel, "..") {
		return "", fmt.Errorf("无效路径")
	}
	abs := base
	if rel != "" {
		abs = filepath.Join(base, filepath.FromSlash(rel))
	}
	abs = filepath.Clean(abs)
	baseClean := filepath.Clean(base)
	if abs != baseClean && !strings.HasPrefix(abs, baseClean+string(os.PathSeparator)) {
		return "", fmt.Errorf("路径越界")
	}
	return abs, nil
}

func skillFileAbs(projectRoot, relPath string) (string, error) {
	rel := filepath.ToSlash(strings.TrimSpace(relPath))
	if rel == "" || strings.Contains(rel, "..") {
		return "", fmt.Errorf("无效路径")
	}
	parts := strings.Split(rel, "/")
	if len(parts) < 2 || !nhskill.ValidID(parts[0]) {
		return "", fmt.Errorf("无效 skill 路径")
	}
	return skillsAbs(projectRoot, rel)
}

func isSkillMarkdownPath(relPath string) bool {
	return strings.EqualFold(filepath.Base(relPath), nhskill.SkillFile)
}
