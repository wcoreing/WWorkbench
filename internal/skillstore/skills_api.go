package skillstore

import (
	"fmt"
	"os"
	"path/filepath"
	"strings"

	"WWorkbench/internal/model"

	nhskill "github.com/wcoreing/ningharness/skill"
)

func skillToDO(info nhskill.Info, content string) model.AgentSkillDO {
	return model.AgentSkillDO{
		ID:          info.ID,
		Name:        info.Name,
		Description: info.Description,
		Enabled:     info.Enabled,
		Globs:       append([]string(nil), info.Globs...),
		Builtin:     IsBuiltinSkill(info.ID),
		Content:     content,
	}
}

// ListSkills 列出全部 Skill（含禁用）。
func ListSkills(projectRoot string) ([]model.AgentSkillDO, error) {
	list, err := nhskill.List(projectRoot)
	if err != nil {
		return nil, err
	}
	out := make([]model.AgentSkillDO, 0, len(list))
	for _, info := range list {
		out = append(out, skillToDO(info, ""))
	}
	return out, nil
}

// ListEnabledSkills 仅启用项（/ 调用菜单）。
func ListEnabledSkills(projectRoot string) ([]model.AgentSkillDO, error) {
	all, err := ListSkills(projectRoot)
	if err != nil {
		return nil, err
	}
	out := make([]model.AgentSkillDO, 0, len(all))
	for _, s := range all {
		if s.Enabled {
			out = append(out, s)
		}
	}
	return out, nil
}

// GetSkill 读取 Skill 元数据与正文。
func GetSkill(projectRoot, id string) (model.AgentSkillDO, error) {
	info, body, err := nhskill.LoadBody(projectRoot, id)
	if err != nil {
		return model.AgentSkillDO{}, err
	}
	return skillToDO(info, body), nil
}

// SetSkillEnabled 启用/禁用 Skill。
func SetSkillEnabled(projectRoot, id string, enabled bool) (model.AgentSkillDO, error) {
	rel, doc, info, err := nhskill.RenderSetEnabled(projectRoot, id, enabled)
	if err != nil {
		return model.AgentSkillDO{}, err
	}
	abs := filepath.Join(projectRoot, filepath.FromSlash(rel))
	if err := os.WriteFile(abs, []byte(doc), 0o644); err != nil {
		return model.AgentSkillDO{}, err
	}
	return skillToDO(info, ""), nil
}

// SaveSkill 保存 Skill。
func SaveSkill(projectRoot string, in model.AgentSkillSaveDO) (model.AgentSkillDO, error) {
	id := strings.TrimSpace(in.ID)
	if id == "" {
		return model.AgentSkillDO{}, fmt.Errorf("skill id 不能为空")
	}
	rel := nhskill.RelSkillMD(id)
	abs := filepath.Join(projectRoot, filepath.FromSlash(rel))
	raw, err := os.ReadFile(abs)
	if err != nil {
		return model.AgentSkillDO{}, err
	}
	name, description, enabled, globs, body, err := nhskill.ParseSkillMD(string(raw))
	if err != nil {
		return model.AgentSkillDO{}, err
	}
	if strings.TrimSpace(in.Name) != "" {
		name = strings.TrimSpace(in.Name)
	}
	if strings.TrimSpace(in.Description) != "" {
		description = strings.TrimSpace(in.Description)
	}
	if in.UpdateGlobs {
		globs = trimSkillGlobs(in.Globs)
	}
	if in.UpdateContent {
		body = in.Content
	}
	doc := renderSkillMD(name, description, enabled, globs, body)
	if err := os.WriteFile(abs, []byte(doc), 0o644); err != nil {
		return model.AgentSkillDO{}, err
	}
	return GetSkill(projectRoot, id)
}

// UpsertSkill 创建或覆盖整份 Skill（笔记发布）。
func UpsertSkill(projectRoot string, in model.AgentSkillPublishDO) (model.AgentSkillDO, error) {
	id := strings.TrimSpace(in.ID)
	if id == "" {
		return model.AgentSkillDO{}, fmt.Errorf("skill id 不能为空")
	}
	if !nhskill.ValidID(id) {
		return model.AgentSkillDO{}, fmt.Errorf("无效 skill id（字母数字开头，仅 [a-zA-Z0-9_-]）")
	}
	name := strings.TrimSpace(in.Name)
	if name == "" {
		name = id
	}
	desc := strings.TrimSpace(in.Description)
	if desc == "" {
		desc = name
	}
	body := strings.TrimSpace(in.Content)
	rel := nhskill.RelSkillMD(id)
	abs := filepath.Join(projectRoot, filepath.FromSlash(rel))
	enabled := true
	if raw, err := os.ReadFile(abs); err == nil {
		_, _, en, _, _, perr := nhskill.ParseSkillMD(string(raw))
		if perr == nil {
			enabled = en
		}
	} else if err := os.MkdirAll(filepath.Dir(abs), 0o755); err != nil {
		return model.AgentSkillDO{}, err
	}
	doc := renderSkillMD(name, desc, enabled, nil, body)
	if err := os.WriteFile(abs, []byte(doc), 0o644); err != nil {
		return model.AgentSkillDO{}, err
	}
	return GetSkill(projectRoot, id)
}

// CreateSkill 新建用户 Skill。
func CreateSkill(projectRoot, id, name, description, content string) (model.AgentSkillDO, error) {
	info, err := nhskill.Create(projectRoot, id, name, description, content)
	if err != nil {
		return model.AgentSkillDO{}, err
	}
	return skillToDO(info, strings.TrimSpace(content)), nil
}

// DeleteSkill 删除非受保护 Skill。
func DeleteSkill(projectRoot, id string) error {
	id = strings.TrimSpace(id)
	if IsProtectedSkill(id) {
		return fmt.Errorf("系统 Skill %q 不可删除", id)
	}
	_, err := nhskill.Delete(projectRoot, id)
	return err
}

func trimSkillGlobs(in []string) []string {
	out := make([]string, 0, len(in))
	seen := map[string]struct{}{}
	for _, g := range in {
		g = strings.TrimSpace(g)
		if g == "" {
			continue
		}
		if _, ok := seen[g]; ok {
			continue
		}
		seen[g] = struct{}{}
		out = append(out, g)
	}
	return out
}

func renderSkillMD(name, description string, enabled bool, globs []string, body string) string {
	var b strings.Builder
	b.WriteString("---\n")
	b.WriteString("name: ")
	b.WriteString(name)
	b.WriteString("\n")
	b.WriteString("description: ")
	b.WriteString(description)
	b.WriteString("\n")
	if !enabled {
		b.WriteString("enabled: false\n")
	}
	if len(globs) > 0 {
		b.WriteString("globs:\n")
		for _, g := range globs {
			b.WriteString("  - ")
			b.WriteString(g)
			b.WriteString("\n")
		}
	}
	b.WriteString("---\n\n")
	b.WriteString(strings.TrimSpace(body))
	b.WriteByte('\n')
	return b.String()
}

// RepairSkillFrontmatter 为缺少 YAML frontmatter 的 SKILL.md 补全标准头。
func RepairSkillFrontmatter(projectRoot string) error {
	root := strings.TrimSpace(projectRoot)
	if root == "" {
		return nil
	}
	base := nhskill.Dir(root)
	ents, err := os.ReadDir(base)
	if err != nil {
		if os.IsNotExist(err) {
			return nil
		}
		return err
	}
	for _, e := range ents {
		if !e.IsDir() || strings.HasPrefix(e.Name(), ".") {
			continue
		}
		id := e.Name()
		if !nhskill.ValidID(id) {
			continue
		}
		abs := filepath.Join(base, id, nhskill.SkillFile)
		raw, err := os.ReadFile(abs)
		if err != nil {
			continue
		}
		if _, _, _, _, _, err := nhskill.ParseSkillMD(string(raw)); err == nil {
			continue
		}
		body := strings.TrimSpace(string(raw))
		name, desc := inferSkillNameDesc(id, body)
		doc := renderSkillMD(name, desc, true, nil, body)
		if err := os.WriteFile(abs, []byte(doc), 0o644); err != nil {
			return err
		}
	}
	return nil
}

func inferSkillNameDesc(id, body string) (string, string) {
	name := id
	for _, line := range strings.Split(body, "\n") {
		line = strings.TrimSpace(line)
		if strings.HasPrefix(line, "# ") {
			name = strings.TrimSpace(strings.TrimPrefix(line, "# "))
			break
		}
	}
	return name, name
}

func validateSkillMD(content string) error {
	name, desc, _, _, _, err := nhskill.ParseSkillMD(content)
	if err != nil {
		return err
	}
	if strings.TrimSpace(name) == "" {
		return fmt.Errorf("frontmatter 缺少 name")
	}
	if strings.TrimSpace(desc) == "" {
		return fmt.Errorf("frontmatter 缺少 description")
	}
	return nil
}
