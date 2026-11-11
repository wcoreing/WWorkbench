package notebook

import (
	"strings"

	"WWorkbench/internal/model"

	"gopkg.in/yaml.v3"
)

// NormalizeNoteRole 归一化笔记角色。
func NormalizeNoteRole(role string) string {
	switch strings.ToLower(strings.TrimSpace(role)) {
	case model.NoteRoleMemory:
		return model.NoteRoleMemory
	case model.NoteRoleSkill:
		return model.NoteRoleSkill
	case model.NoteRoleNote, "":
		return model.NoteRoleNote
	default:
		return model.NoteRoleNote
	}
}

// SyncNoteMeta 保存前同步 frontmatter ↔ role/bind 列（合并写入，保留 name/session 等扩展键）。
func SyncNoteMeta(n *model.NoteDO) {
	if n == nil {
		return
	}
	fmMap, body, hasFM := splitFrontmatterMap(n.Content)
	if fmMap == nil {
		fmMap = map[string]interface{}{}
	}

	if hasFM {
		if strings.TrimSpace(n.SSHHostID) == "" {
			if ssh := fmString(fmMap, "sshHostId"); ssh != "" {
				n.SSHHostID = ssh
			} else if bind, ok := fmMap["bind"].(map[string]interface{}); ok {
				if ssh := firstNonEmpty(fmString(bind, "sshHostId"), fmString(bind, "ssh")); ssh != "" {
					n.SSHHostID = ssh
				}
			}
		}
		if strings.TrimSpace(n.ConnectionID) == "" {
			if conn := fmString(fmMap, "connectionId"); conn != "" {
				n.ConnectionID = conn
			} else if bind, ok := fmMap["bind"].(map[string]interface{}); ok {
				if conn := firstNonEmpty(fmString(bind, "connectionId"), fmString(bind, "connection")); conn != "" {
					n.ConnectionID = conn
				}
			}
		}
		if strings.TrimSpace(n.Role) == "" {
			if r := fmString(fmMap, "role"); r != "" {
				n.Role = r
			}
		}
	}
	n.Role = NormalizeNoteRole(n.Role)

	if n.Role == model.NoteRoleNote && !hasFM && n.SSHHostID == "" && n.ConnectionID == "" {
		return
	}

	if !hasFM {
		body = strings.TrimLeft(n.Content, " \t\r\n")
	}

	if n.Role == model.NoteRoleNote {
		delete(fmMap, "role")
	} else {
		fmMap["role"] = n.Role
	}
	if n.SSHHostID != "" {
		fmMap["sshHostId"] = n.SSHHostID
	} else {
		delete(fmMap, "sshHostId")
	}
	if n.ConnectionID != "" {
		fmMap["connectionId"] = n.ConnectionID
	} else {
		delete(fmMap, "connectionId")
	}
	// 工作流笔记可用 bind: browser 字符串；仅清掉错误写成 map 的 bind
	if n.Role != model.NoteRoleSkill {
		if _, ok := fmMap["bind"].(map[string]interface{}); ok {
			delete(fmMap, "bind")
		}
	}

	if n.Role == model.NoteRoleNote && n.SSHHostID == "" && n.ConnectionID == "" && len(fmMap) == 0 {
		n.Content = strings.TrimLeft(body, " \t\r\n")
		return
	}
	n.Content = joinFrontmatterMap(fmMap, body)
}

// PeekFrontmatter 解析笔记 YAML 头（只读）。
func PeekFrontmatter(content string) (map[string]interface{}, string, bool) {
	return splitFrontmatterMap(content)
}

// FrontmatterString 读取 frontmatter 字符串字段。
func FrontmatterString(fm map[string]interface{}, key string) string {
	return fmString(fm, key)
}

func splitFrontmatterMap(content string) (map[string]interface{}, string, bool) {
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
	raw := rest[:end]
	body := rest[end+4:]
	body = strings.TrimPrefix(body, "\r\n")
	body = strings.TrimPrefix(body, "\n")
	var fm map[string]interface{}
	if err := yaml.Unmarshal([]byte(raw), &fm); err != nil || fm == nil {
		return nil, content, false
	}
	return fm, body, true
}

func joinFrontmatterMap(fm map[string]interface{}, body string) string {
	raw, err := yaml.Marshal(fm)
	if err != nil {
		return body
	}
	block := strings.TrimRight(string(raw), "\n")
	body = strings.TrimLeft(body, " \t\r\n")
	if body == "" {
		return "---\n" + block + "\n---\n"
	}
	return "---\n" + block + "\n---\n\n" + body
}

func fmString(m map[string]interface{}, key string) string {
	if m == nil {
		return ""
	}
	v, ok := m[key]
	if !ok || v == nil {
		return ""
	}
	s, ok := v.(string)
	if !ok {
		return ""
	}
	return strings.TrimSpace(s)
}

func firstNonEmpty(vals ...string) string {
	for _, v := range vals {
		if s := strings.TrimSpace(v); s != "" {
			return s
		}
	}
	return ""
}

// splitFrontmatter 供摘录等只读场景（兼容旧调用）。
func splitFrontmatter(content string) (roleSSHConn, string, bool) {
	fm, body, ok := splitFrontmatterMap(content)
	if !ok {
		return roleSSHConn{}, content, false
	}
	return roleSSHConn{
		Role:         fmString(fm, "role"),
		SSHHostID:    fmString(fm, "sshHostId"),
		ConnectionID: fmString(fm, "connectionId"),
	}, body, true
}

type roleSSHConn struct {
	Role         string
	SSHHostID    string
	ConnectionID string
}
