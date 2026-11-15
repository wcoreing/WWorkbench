package workbenchtools

import (
	"path/filepath"
	"regexp"
	"sort"
	"strings"
	"unicode"

	"WWorkbench/internal/errno"
	"WWorkbench/internal/model"
	"WWorkbench/internal/workbench"
)

const projectSuggestMinScore = 45

var projectTokenSplitRE = regexp.MustCompile(`[^0-9A-Za-z\p{Han}]+`)

func normalizePathKey(p string) string {
	p = strings.TrimSpace(p)
	if p == "" {
		return ""
	}
	return strings.TrimRight(strings.ToLower(filepath.Clean(p)), string(filepath.Separator))
}

// projectContextTokens 从项目名/路径/git 抽出匹配词。
func projectContextTokens(p model.WorkbenchProjectDO) []string {
	raw := []string{p.Name, p.LocalPath, filepath.Base(strings.TrimSpace(p.LocalPath)), p.GitRemote}
	seen := map[string]bool{}
	var out []string
	add := func(s string) {
		s = strings.TrimSpace(strings.ToLower(s))
		if s == "" || len([]rune(s)) < 2 {
			return
		}
		if seen[s] {
			return
		}
		seen[s] = true
		out = append(out, s)
	}
	for _, piece := range raw {
		piece = strings.TrimSpace(piece)
		if piece == "" {
			continue
		}
		add(piece)
		add(filepath.Base(piece))
		for _, part := range projectTokenSplitRE.Split(piece, -1) {
			add(part)
		}
		if i := strings.LastIndex(piece, "/"); i >= 0 {
			base := strings.TrimSuffix(piece[i+1:], ".git")
			add(base)
		}
	}
	return out
}

func scoreTextMatch(haystack string, tokens []string) (score int, hit string) {
	h := strings.ToLower(strings.TrimSpace(haystack))
	if h == "" {
		return 0, ""
	}
	best := 0
	bestHit := ""
	for _, tok := range tokens {
		if tok == "" || len([]rune(tok)) < 2 {
			continue
		}
		if h == tok {
			return 100, tok
		}
		if strings.Contains(h, tok) {
			s := 70
			if len([]rune(tok)) >= 4 {
				s = 80
			}
			if isASCIIWord(tok) && len(tok) < 4 {
				s = 40
			}
			if s > best {
				best = s
				bestHit = tok
			}
		}
	}
	return best, bestHit
}

func isASCIIWord(s string) bool {
	for _, r := range s {
		if r > unicode.MaxASCII || (!unicode.IsLetter(r) && !unicode.IsDigit(r)) {
			return false
		}
	}
	return true
}

func linkKey(kind, id string) string {
	return strings.TrimSpace(kind) + ":" + strings.TrimSpace(id)
}

func linkedSet(links []model.WorkbenchProjectLinkDO) map[string]bool {
	out := map[string]bool{}
	for _, l := range links {
		out[linkKey(l.Kind, l.ID)] = true
	}
	return out
}

func appendSuggestion(
	out *[]model.ProjectResourceSuggestionDO,
	linked map[string]bool,
	kind, id, label string,
	score int,
	reason string,
) {
	id = strings.TrimSpace(id)
	if id == "" || score < projectSuggestMinScore {
		return
	}
	*out = append(*out, model.ProjectResourceSuggestionDO{
		Kind:          kind,
		ID:            id,
		Label:         strings.TrimSpace(label),
		Score:         score,
		Reason:        reason,
		AlreadyLinked: linked[linkKey(kind, id)],
	})
}

// SuggestProjectResources 按项目上下文对现有资产打分，返回候选（已钉也会返回，标 alreadyLinked）。
func SuggestProjectResources(d *Deps, p model.WorkbenchProjectDO) model.SuggestProjectResourcesResultDO {
	EnsureProjectGitRemote(&p)
	res := model.SuggestProjectResourcesResultDO{Project: p, Suggestions: []model.ProjectResourceSuggestionDO{}}
	if d == nil || d.Store == nil {
		return res
	}
	tokens := projectContextTokens(p)
	res.Tokens = tokens
	linked := linkedSet(p.Links)
	var suggestions []model.ProjectResourceSuggestionDO

	type scoredHost struct {
		id, name string
		score    int
	}
	var topHosts []scoredHost
	if d.SSHHosts != nil {
		if hosts, err := d.SSHHosts.List(); err == nil {
			for _, h := range hosts {
				label := h.Name
				if label == "" {
					label = h.Host
				}
				score, hit := scoreTextMatch(h.Name+" "+h.Host+" "+h.User, tokens)
				reason := ""
				if hit != "" {
					reason = "名称/主机匹配「" + hit + "」"
				}
				appendSuggestion(&suggestions, linked, model.MCPAssetSSH, h.ID, label, score, reason)
				if score >= projectSuggestMinScore {
					topHosts = append(topHosts, scoredHost{id: h.ID, name: label, score: score})
				}
			}
		}
	}
	sort.Slice(topHosts, func(i, j int) bool { return topHosts[i].score > topHosts[j].score })
	hostBoost := map[string]string{}
	for i, h := range topHosts {
		if i >= 3 {
			break
		}
		hostBoost[h.id] = h.name
	}

	if conns, err := d.Store.ListConnections(); err == nil {
		for _, c := range conns {
			label := c.Name
			if label == "" {
				label = c.Host
			}
			score, hit := scoreTextMatch(c.Name+" "+c.Host+" "+c.Database+" "+c.DbType, tokens)
			reason := ""
			if hit != "" {
				reason = "连接信息匹配「" + hit + "」"
			}
			if name, ok := hostBoost[c.SSHHostID]; ok {
				score += 25
				if reason != "" {
					reason += "；"
				}
				reason += "关联主机 " + name
			}
			appendSuggestion(&suggestions, linked, model.MCPAssetDatabase, c.ID, label, score, reason)
		}
	}

	if docks, err := d.Store.ListDockerContexts(); err == nil {
		for _, dx := range docks {
			label := dx.Name
			if label == "" {
				label = dx.ID
			}
			score, hit := scoreTextMatch(dx.Name+" "+dx.Endpoint+" "+dx.Kind, tokens)
			reason := ""
			if hit != "" {
				reason = "上下文匹配「" + hit + "」"
			}
			if name, ok := hostBoost[dx.SSHHostID]; ok {
				score += 25
				if reason != "" {
					reason += "；"
				}
				reason += "关联主机 " + name
			}
			appendSuggestion(&suggestions, linked, model.MCPAssetDocker, dx.ID, label, score, reason)
		}
	}

	if logs, err := d.Store.ListLogSources(); err == nil {
		for _, lg := range logs {
			label := lg.Name
			if label == "" {
				label = lg.Path
			}
			if label == "" {
				label = lg.ID
			}
			score, hit := scoreTextMatch(lg.Name+" "+lg.Path+" "+lg.ComposeDir+" "+lg.ComposeService, tokens)
			reason := ""
			if hit != "" {
				reason = "日志源匹配「" + hit + "」"
			}
			if name, ok := hostBoost[lg.SSHHostID]; ok {
				score += 25
				if reason != "" {
					reason += "；"
				}
				reason += "关联主机 " + name
			}
			appendSuggestion(&suggestions, linked, model.MCPAssetLog, lg.ID, label, score, reason)
		}
	}

	if reqs, err := d.Store.ListHTTPRequests(); err == nil {
		for _, r := range reqs {
			label := r.Name
			if label == "" {
				label = r.URL
			}
			score, hit := scoreTextMatch(r.Name+" "+r.URL+" "+r.Notes, tokens)
			reason := ""
			if hit != "" {
				reason = "接口匹配「" + hit + "」"
			}
			appendSuggestion(&suggestions, linked, model.MCPAssetHTTP, r.ID, label, score, reason)
		}
	}

	if pols, err := d.Store.ListBackupPolicies(); err == nil {
		for _, bp := range pols {
			label := bp.Name
			if label == "" {
				label = bp.Path
			}
			score, hit := scoreTextMatch(bp.Name+" "+bp.Path+" "+bp.DestRoot, tokens)
			reason := ""
			if hit != "" {
				reason = "备份策略匹配「" + hit + "」"
			}
			if name, ok := hostBoost[bp.SSHHostID]; ok {
				score += 25
				if reason != "" {
					reason += "；"
				}
				reason += "关联主机 " + name
			}
			appendSuggestion(&suggestions, linked, model.MCPAssetBackup, bp.ID, label, score, reason)
		}
	}

	suggestProjectNotes(d, p, tokens, linked, hostBoost, &suggestions)

	sort.SliceStable(suggestions, func(i, j int) bool {
		if suggestions[i].Score != suggestions[j].Score {
			return suggestions[i].Score > suggestions[j].Score
		}
		if suggestions[i].Kind != suggestions[j].Kind {
			return suggestions[i].Kind < suggestions[j].Kind
		}
		return suggestions[i].Label < suggestions[j].Label
	})
	perKind := map[string]int{}
	trimmed := make([]model.ProjectResourceSuggestionDO, 0, len(suggestions))
	for _, s := range suggestions {
		if perKind[s.Kind] >= 5 {
			continue
		}
		perKind[s.Kind]++
		trimmed = append(trimmed, s)
		if len(trimmed) >= 20 {
			break
		}
	}
	res.Suggestions = trimmed
	return res
}

// suggestProjectNotes 把笔记本资源纳入智能配置：标题匹配 + 记忆区项目 localPath 对齐。
func suggestProjectNotes(
	d *Deps,
	p model.WorkbenchProjectDO,
	tokens []string,
	linked map[string]bool,
	hostBoost map[string]string,
	suggestions *[]model.ProjectResourceSuggestionDO,
) {
	if d == nil || d.Notebook == nil || suggestions == nil {
		return
	}
	projPath := normalizePathKey(p.LocalPath)

	if list, err := d.Notebook.ListNotes(); err == nil {
		for _, n := range list {
			label := n.Title
			if label == "" {
				label = n.ID
			}
			score, hit := scoreTextMatch(n.Title+" "+n.Role+" "+n.GroupID, tokens)
			reason := ""
			if hit != "" {
				reason = "笔记标题匹配「" + hit + "」"
			}
			if name, ok := hostBoost[n.SSHHostID]; ok {
				score += 20
				if reason != "" {
					reason += "；"
				}
				reason += "关联主机 " + name
			}
			kind := model.MCPAssetNote
			if n.Role == model.NoteRoleSkill {
				kind = model.MCPAssetSkill
			}
			appendSuggestion(suggestions, linked, kind, n.ID, label, score, reason)
		}
	}

	if projPath == "" {
		return
	}
	projects, err := d.Notebook.ListHostProjects("")
	if err != nil {
		return
	}
	for _, hp := range projects {
		if normalizePathKey(hp.LocalPath) != projPath {
			continue
		}
		if hp.NoteID != "" {
			label := hp.Name
			if label == "" {
				label = filepath.Base(hp.DirRel)
			}
			appendSuggestion(suggestions, linked, model.MCPAssetNote, hp.NoteID, label,
				95, "记忆区项目 localPath 对齐")
		}
		if hp.SkillNoteID != "" {
			label := hp.Name
			if label == "" {
				label = "Skill"
			} else {
				label = label + " · Skill"
			}
			appendSuggestion(suggestions, linked, model.MCPAssetSkill, hp.SkillNoteID, label,
				95, "记忆区项目 Skill 对齐")
		}
	}
}

// ConfigureProjectResources 把建议（或显式 keys）钉进项目并保存。
// keys 形如 kind:id；空则采纳所有未钉且过阈值的建议。
func ConfigureProjectResources(d *Deps, projectID string, keys []string) (model.ConfigureProjectResourcesResultDO, error) {
	out := model.ConfigureProjectResourcesResultDO{}
	if d == nil || d.Store == nil {
		return out, errno.New(errno.CodeStoreFailed, "Store 未就绪", "")
	}
	p, err := d.Store.GetWorkbenchProject(projectID)
	if err != nil {
		return out, err
	}
	EnsureProjectGitRemote(&p)
	suggest := SuggestProjectResources(d, p)
	out.Suggested = suggest.Suggestions
	if p.GitRemote == "" && suggest.Project.GitRemote != "" {
		p.GitRemote = suggest.Project.GitRemote
	}

	want := map[string]bool{}
	if len(keys) == 0 {
		for _, s := range suggest.Suggestions {
			if !s.AlreadyLinked {
				want[linkKey(s.Kind, s.ID)] = true
			}
		}
	} else {
		for _, k := range keys {
			k = strings.TrimSpace(k)
			if k != "" {
				want[k] = true
			}
		}
	}

	byKey := map[string]model.ProjectResourceSuggestionDO{}
	for _, s := range suggest.Suggestions {
		byKey[linkKey(s.Kind, s.ID)] = s
	}

	existing := linkedSet(p.Links)
	var added []model.ProjectResourceSuggestionDO
	var skipped []model.ProjectResourceSuggestionDO
	for key := range want {
		parts := strings.SplitN(key, ":", 2)
		if len(parts) != 2 {
			continue
		}
		kind, id := parts[0], parts[1]
		sug, ok := byKey[key]
		if !ok {
			sug = model.ProjectResourceSuggestionDO{Kind: kind, ID: id, Label: id, Reason: "显式指定"}
		}
		if existing[key] {
			sug.AlreadyLinked = true
			skipped = append(skipped, sug)
			continue
		}
		p.Links = append(p.Links, model.WorkbenchProjectLinkDO{
			Kind:  kind,
			ID:    id,
			Label: sug.Label,
		})
		existing[key] = true
		added = append(added, sug)
	}

	saved, err := d.Store.SaveWorkbenchProject(p)
	if err != nil {
		return out, err
	}
	if d.Radar != nil {
		d.Radar.EmitAsset(workbench.RadarDomainProject, "project", workbench.RadarOpUpdate, saved.ID, "mcp-project-smart-config", saved.Name, true)
	}
	out.Project = saved
	out.Added = added
	out.Skipped = skipped
	return out, nil
}
