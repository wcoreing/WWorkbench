package agent

import (
	"encoding/json"
	"regexp"
	"strings"
)

var skillIDsFeedforwardRE = regexp.MustCompile(`<!--\s*wwb-skill-ids:\s*(\[[\s\S]*?\])\s*-->`)

// AppendSkillIDsFeedforward 把 skill id 写入 user 行前馈（不进气泡正文，历史可恢复）。
func AppendSkillIDsFeedforward(ff string, skillIDs []string) string {
	ids := trimSkillIDs(skillIDs)
	if len(ids) == 0 {
		return ff
	}
	raw, err := json.Marshal(ids)
	if err != nil {
		return ff
	}
	mark := "<!-- wwb-skill-ids: " + string(raw) + " -->"
	ff = strings.TrimSpace(ff)
	if ff == "" {
		return mark
	}
	return ff + "\n" + mark
}

// ParseSkillIDsFeedforward 从 user 行前馈解析 skill id。
func ParseSkillIDsFeedforward(ff string) []string {
	m := skillIDsFeedforwardRE.FindStringSubmatch(ff)
	if len(m) < 2 {
		return nil
	}
	var ids []string
	if err := json.Unmarshal([]byte(m[1]), &ids); err != nil {
		return nil
	}
	return trimSkillIDs(ids)
}
