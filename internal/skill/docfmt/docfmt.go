// Package docfmt 生成 / 解析 Skill Markdown 正文模板（纯函数，无存储依赖）。
package docfmt

import (
	"encoding/json"
	"fmt"
	"regexp"
	"strings"

	"WWorkbench/internal/model"
	"WWorkbench/internal/skill"

	"gopkg.in/yaml.v3"
)

var sectionRE = regexp.MustCompile(`(?m)^##\s+(.+?)\s*$`)

// BodyExtras 除步骤外的可沉淀段落。
type BodyExtras struct {
	Lessons    string
	TrustedOps string
	Scripts    string
	Resources  string
}

type frontmatter struct {
	Role        string `yaml:"role,omitempty"`
	Name        string `yaml:"name,omitempty"`
	SkillID     string `yaml:"skillId,omitempty"`
	Session     string `yaml:"session,omitempty"`
	SourceRunID string `yaml:"sourceRunId,omitempty"`
	Intent      string `yaml:"intent,omitempty"`
	Description string `yaml:"description,omitempty"`
	Bind        string `yaml:"bind,omitempty"`
}

// 资源 kind（登记在 ## 资源）。
const (
	ResourceKindScreenshot = "screenshot"
	ResourceKindFile       = "file"
	ResourceKindTemplate   = "template"
	ResourceKindConfig     = "config"
)

// ExtractBodyExtras 从正文抽出经验/脚本/资源等段落。
func ExtractBodyExtras(content string) BodyExtras {
	_, body, ok := splitFrontmatter(content)
	if !ok {
		body = content
	}
	return BodyExtras{
		Lessons:    extractSection(body, "经验"),
		TrustedOps: extractSection(body, "已信任操作"),
		Scripts:    extractSection(body, "脚本"),
		Resources:  extractSection(body, "资源"),
	}
}

// FormatResourceLine 统一资源索引行。
func FormatResourceLine(kind, label, markdown string) string {
	kind = strings.TrimSpace(kind)
	if kind == "" {
		kind = ResourceKindFile
	}
	label = strings.TrimSpace(label)
	markdown = strings.TrimSpace(markdown)
	if label == "" {
		return fmt.Sprintf("- kind: %s · %s", kind, markdown)
	}
	return fmt.Sprintf("- kind: %s · %s · %s", kind, label, markdown)
}

// DefaultScriptsPlaceholder ## 脚本 空态。
func DefaultScriptsPlaceholder() string {
	return "（无脚本。沉淀：`update_skill(script=…)`；shell/SQL 围栏写在「## 脚本」，或落同级 `scripts/`；给人核对，经工作台确认后再跑。）"
}

// DefaultResourcesPlaceholder ## 资源 空态。
func DefaultResourcesPlaceholder(noteID string) string {
	noteID = strings.TrimSpace(noteID)
	if noteID == "" {
		noteID = "{dir}/" + skill.EntryFile
	}
	return fmt.Sprintf(
		"> 附件真源：本 Skill 目录下 assets/（与 SKILL.md 同级）。正文用相对链接 assets/文件名。\n\n"+
			"（无附件。update_skill(resourcePaths=…) 或「插入附件」→ 写入 assets/ 并按 kind · 说明 · 链接 登记。noteId=%s）",
		noteID,
	)
}

// Format 将工作流写成标准 Skill Markdown。
// noteID 空时：含路径用 EntryInDir；短名用 name/SKILL.md（产品短名→工作流/ 映射由调用方填 NoteID）。
func Format(p model.WorkflowDO, extras BodyExtras) string {
	name := strings.TrimSpace(p.Name)
	noteID := strings.TrimSpace(p.NoteID)
	if noteID == "" {
		if strings.Contains(name, "/") {
			noteID = skill.EntryInDir(name)
		} else if name != "" {
			noteID = name + "/" + skill.EntryFile
		}
	}
	fm := frontmatter{
		Role:        model.NoteRoleSkill,
		Name:        name,
		SkillID:     name,
		SourceRunID: strings.TrimSpace(p.SourceRunID),
		Intent:      strings.TrimSpace(p.Intent),
		Description: strings.TrimSpace(p.Description),
		Bind:        "browser",
	}
	if sess := sessionFromSteps(p.Steps); sess != "" {
		fm.Session = sess
	}
	raw, _ := yaml.Marshal(fm)
	block := strings.TrimRight(string(raw), "\n")

	title := firstNonEmpty(strings.TrimSpace(p.Title), p.Name)
	var body strings.Builder
	fmt.Fprintf(&body, "<!-- wwb-skill: %s -->\n\n", name)
	fmt.Fprintf(&body, "# %s\n\n", title)
	if d := strings.TrimSpace(p.Description); d != "" {
		body.WriteString(d)
		body.WriteString("\n\n")
	}
	if intent := strings.TrimSpace(p.Intent); intent != "" {
		fmt.Fprintf(&body, "> 意图：%s\n\n", intent)
	}
	body.WriteString("## 说明\n\n")
	body.WriteString("本笔记是 **Agent Skill**（引擎=Agent；步骤=可选提示）。\n\n")
	fmt.Fprintf(&body, "- 读：`get_skill(skill=%s)` → 用工具完成目标\n", name)
	body.WriteString("- 沉淀：`update_skill` 写回经验 / 步骤 / 脚本 / 资源\n")
	body.WriteString("- 资源：二进制挂本 Skill 目录 `assets/`；脚本写在「## 脚本」或 `scripts/`\n")
	fmt.Fprintf(&body, "- 可选：`run_skill(name=%s)`（机械逐步，失败即停）\n\n", name)

	lessons := strings.TrimSpace(extras.Lessons)
	if lessons == "" {
		lessons = "（尚无沉淀；跑通或踩坑后 `update_skill(lessons=…)` 追加。）"
	}
	body.WriteString("## 经验\n\n")
	body.WriteString(lessons)
	body.WriteString("\n\n")

	if trusted := strings.TrimSpace(extras.TrustedOps); trusted != "" {
		body.WriteString("## 已信任操作\n\n")
		body.WriteString(trusted)
		body.WriteString("\n\n")
	}

	body.WriteString("## 步骤\n\n")
	for i, st := range p.Steps {
		sum := firstNonEmpty(st.Summary, st.Action)
		if st.Action == "pause" || st.Action == "coach" {
			fmt.Fprintf(&body, "%d. **pause** — %s\n", i+1, sum)
		} else {
			fmt.Fprintf(&body, "%d. `%s` — %s\n", i+1, st.Action, sum)
		}
	}
	body.WriteString("\n可执行步骤：\n\n")
	stepsJSON, err := json.MarshalIndent(p.Steps, "", "  ")
	if err != nil {
		stepsJSON = []byte("[]")
	}
	body.WriteString("```wwb-skill-steps\n")
	body.Write(stepsJSON)
	body.WriteString("\n```\n\n")

	scripts := strings.TrimSpace(extras.Scripts)
	if scripts == "" {
		scripts = DefaultScriptsPlaceholder()
	}
	body.WriteString("## 脚本\n\n")
	body.WriteString(scripts)
	body.WriteString("\n\n")

	resources := strings.TrimSpace(extras.Resources)
	if resources == "" {
		resources = DefaultResourcesPlaceholder(noteID)
	}
	body.WriteString("## 资源\n\n")
	body.WriteString(resources)
	body.WriteString("\n")

	return "---\n" + block + "\n---\n\n" + body.String()
}

func extractSection(body, title string) string {
	idxs := sectionRE.FindAllStringSubmatchIndex(body, -1)
	if len(idxs) == 0 {
		return ""
	}
	for i, m := range idxs {
		name := strings.TrimSpace(body[m[2]:m[3]])
		if name != title {
			continue
		}
		start := m[1]
		end := len(body)
		if i+1 < len(idxs) {
			end = idxs[i+1][0]
		}
		return strings.TrimSpace(body[start:end])
	}
	return ""
}

func splitFrontmatter(content string) (frontmatter, string, bool) {
	s := strings.TrimLeft(content, " \t\r\n")
	if !strings.HasPrefix(s, "---") {
		return frontmatter{}, content, false
	}
	rest := s[3:]
	if len(rest) == 0 || (rest[0] != '\n' && rest[0] != '\r') {
		return frontmatter{}, content, false
	}
	rest = strings.TrimPrefix(rest, "\r\n")
	rest = strings.TrimPrefix(rest, "\n")
	end := strings.Index(rest, "\n---")
	if end < 0 {
		return frontmatter{}, content, false
	}
	raw := rest[:end]
	body := rest[end+4:]
	body = strings.TrimPrefix(body, "\r\n")
	body = strings.TrimPrefix(body, "\n")
	var fm frontmatter
	if err := yaml.Unmarshal([]byte(raw), &fm); err != nil {
		return frontmatter{}, content, false
	}
	return fm, body, true
}

func sessionFromSteps(steps []model.WorkflowStepDO) string {
	for _, st := range steps {
		if st.Args == nil {
			continue
		}
		if v, ok := st.Args["session"].(string); ok && strings.TrimSpace(v) != "" {
			return strings.TrimSpace(v)
		}
	}
	return ""
}

func firstNonEmpty(vals ...string) string {
	for _, v := range vals {
		if strings.TrimSpace(v) != "" {
			return v
		}
	}
	return ""
}
