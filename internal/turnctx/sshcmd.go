package turnctx

import (
	"fmt"
	"net"
	"regexp"
	"strconv"
	"strings"

	"WWorkbench/internal/model"
)

type sshEndpoint struct {
	User string
	Host string
	Port int
}

func (e sshEndpoint) addr() string {
	if e.Port <= 0 {
		e.Port = 22
	}
	return fmt.Sprintf("%s@%s:%d", e.User, e.Host, e.Port)
}

var (
	sshTokenRe    = regexp.MustCompile(`(?i)(?:^|[\s` + "`" + `])ssh(?:\s|$)`)
	sshPortFlagRe = regexp.MustCompile(`(?i)(?:^|\s)-p\s*(\d+)`)
	userAtHostRe  = regexp.MustCompile(`(?i)(?:^|[\s` + "`" + `])([A-Za-z0-9._-]+)@([A-Za-z0-9][A-Za-z0-9.-]*[A-Za-z0-9])`)
	labelAddrRe   = regexp.MustCompile(`(?i)([A-Za-z0-9._-]+)@([A-Za-z0-9.-]+):(\d+)\s*$`)
)

// ParseSSHTarget 从 ssh 命令或 user@host[:port] / host:port 解析连接目标。
func ParseSSHTarget(s string) (user, host string, port int, ok bool) {
	s = strings.TrimSpace(s)
	if s == "" {
		return "", "", 0, false
	}
	if eps := parseUserSSHEndpoints(s); len(eps) > 0 {
		e := eps[0]
		return e.User, e.Host, e.Port, true
	}
	if m := userAtHostRe.FindStringSubmatch(" " + s); len(m) == 3 {
		user, host = m[1], m[2]
		port = 22
		if p, okp := portAfterHost(s, host); okp {
			port = p
		}
		return user, host, port, true
	}
	if h, p, split := splitHostPort(s); split {
		return "", h, p, true
	}
	return "", "", 0, false
}

func parseUserSSHEndpoints(text string) []sshEndpoint {
	text = strings.TrimSpace(text)
	if text == "" {
		return nil
	}
	var out []sshEndpoint
	seen := map[string]struct{}{}
	add := func(e sshEndpoint) {
		e.User = strings.TrimSpace(e.User)
		e.Host = strings.TrimSpace(strings.Trim(e.Host, ".,;"))
		if e.User == "" || e.Host == "" || !strings.Contains(e.Host, ".") {
			return
		}
		if e.Port <= 0 || e.Port > 65535 {
			e.Port = 22
		}
		k := strings.ToLower(e.addr())
		if _, ok := seen[k]; ok {
			return
		}
		seen[k] = struct{}{}
		out = append(out, e)
	}
	for _, line := range strings.Split(text, "\n") {
		line = strings.TrimSpace(line)
		if line == "" {
			continue
		}
		m := userAtHostRe.FindStringSubmatch(line)
		if len(m) != 3 {
			continue
		}
		user, host := m[1], m[2]
		port := 22
		if sshTokenRe.MatchString(line) || sshPortFlagRe.MatchString(line) {
			if pm := sshPortFlagRe.FindStringSubmatch(line); len(pm) == 2 {
				port, _ = strconv.Atoi(pm[1])
			}
			add(sshEndpoint{User: user, Host: host, Port: port})
			continue
		}
		if p, ok := portAfterHost(line, host); ok {
			add(sshEndpoint{User: user, Host: host, Port: p})
		}
	}
	return out
}

func portAfterHost(line, host string) (int, bool) {
	idx := strings.LastIndex(line, host)
	if idx < 0 {
		return 0, false
	}
	after := line[idx+len(host):]
	if !strings.HasPrefix(after, ":") {
		return 0, false
	}
	n := after[1:]
	end := 0
	for end < len(n) && n[end] >= '0' && n[end] <= '9' {
		end++
	}
	if end == 0 {
		return 0, false
	}
	p, err := strconv.Atoi(n[:end])
	if err != nil || p <= 0 || p > 65535 {
		return 0, false
	}
	return p, true
}

func splitHostPort(s string) (host string, port int, ok bool) {
	h, p, err := net.SplitHostPort(s)
	if err != nil {
		return s, 0, false
	}
	port, err = strconv.Atoi(p)
	if err != nil || port <= 0 || port > 65535 || strings.TrimSpace(h) == "" {
		return s, 0, false
	}
	return h, port, true
}

func endpointFromMentionLabel(label string) (sshEndpoint, bool) {
	m := labelAddrRe.FindStringSubmatch(strings.TrimSpace(label))
	if len(m) != 4 {
		return sshEndpoint{}, false
	}
	port, err := strconv.Atoi(m[3])
	if err != nil {
		return sshEndpoint{}, false
	}
	return sshEndpoint{User: m[1], Host: m[2], Port: port}, true
}

func mentionTitle(label string) string {
	label = strings.TrimSpace(label)
	if i := strings.Index(label, " · "); i > 0 {
		return strings.TrimSpace(label[:i])
	}
	return label
}

func userSSHHint(userText string, mentions []model.AgentMentionDO) string {
	eps := parseUserSSHEndpoints(userText)
	if len(eps) == 0 {
		return ""
	}
	var b strings.Builder
	b.WriteString("- **用户本轮给出的 SSH 地址**（权威，覆盖 @ 绑定的 host/port）：")
	for _, e := range eps {
		fmt.Fprintf(&b, " `%s`", e.addr())
	}
	b.WriteByte('\n')
	for _, e := range eps {
		for _, m := range mentions {
			if m.Kind != "ssh" {
				continue
			}
			bound, ok := endpointFromMentionLabel(m.Label)
			if !ok {
				continue
			}
			if strings.EqualFold(bound.Host, e.Host) && bound.Port == e.Port {
				continue
			}
			fmt.Fprintf(&b, "- 已绑定「%s」是 `%s`，与用户命令不是同一台。save_ssh_host 必须用命令里的 host/port，禁止沿用绑定资产的 host；shell_probe 不要用绑定的旧 hostId。\n",
				mentionTitle(m.Label), bound.addr())
		}
	}
	return b.String()
}
