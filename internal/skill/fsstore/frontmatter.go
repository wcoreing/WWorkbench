package fsstore

import (
	"strings"

	"gopkg.in/yaml.v3"
)

func peekFrontmatter(content string) (map[string]interface{}, string, bool) {
	s := strings.TrimLeft(content, " \t\r\n")
	if !strings.HasPrefix(s, "---") {
		return nil, content, false
	}
	rest := s[3:]
	if len(rest) == 0 || (rest[0] != '\n' && rest[0] != '\r') {
		return nil, content, false
	}
	rest = strings.TrimPrefix(rest, "\r\n")
	rest = strings.TrimPrefix(rest, "\n")
	end := strings.Index(rest, "\n---")
	if end < 0 {
		return nil, content, false
	}
	yamlBlock := rest[:end]
	body := rest[end+len("\n---"):]
	body = strings.TrimPrefix(body, "\r\n")
	body = strings.TrimPrefix(body, "\n")
	fm := map[string]interface{}{}
	if err := yaml.Unmarshal([]byte(yamlBlock), &fm); err != nil {
		return nil, content, false
	}
	return fm, body, true
}

func fmString(fm map[string]interface{}, key string) string {
	if fm == nil {
		return ""
	}
	v, ok := fm[key]
	if !ok || v == nil {
		return ""
	}
	switch t := v.(type) {
	case string:
		return strings.TrimSpace(t)
	default:
		return strings.TrimSpace(strings.Trim(strings.TrimSpace(stringify(t)), `"`))
	}
}

func stringify(v interface{}) string {
	b, err := yaml.Marshal(v)
	if err != nil {
		return ""
	}
	return strings.TrimSpace(string(b))
}

func appendLessons(content string, lessons []string) string {
	lines := make([]string, 0, len(lessons))
	for _, l := range lessons {
		l = strings.TrimSpace(l)
		if l == "" {
			continue
		}
		if !strings.HasPrefix(l, "-") {
			l = "- " + l
		}
		lines = append(lines, l)
	}
	if len(lines) == 0 {
		return content
	}
	block := strings.Join(lines, "\n")
	const heading = "## 经验"
	idx := strings.Index(content, heading)
	if idx < 0 {
		if strings.TrimSpace(content) == "" {
			return heading + "\n\n" + block + "\n"
		}
		return strings.TrimRight(content, "\n") + "\n\n" + heading + "\n\n" + block + "\n"
	}
	rest := content[idx+len(heading):]
	next := strings.Index(rest, "\n## ")
	var before, section, after string
	before = content[:idx]
	if next < 0 {
		section = strings.TrimRight(rest, "\n")
		after = ""
	} else {
		section = rest[:next]
		after = rest[next:]
	}
	section = strings.TrimSpace(section)
	if section == "" || strings.Contains(section, "尚无沉淀") {
		section = block
	} else {
		section = section + "\n" + block
	}
	return before + heading + "\n\n" + section + "\n" + after
}
