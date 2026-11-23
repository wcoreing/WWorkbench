package workbenchtools

import (
	"regexp"
	"strings"

	"WWorkbench/internal/notebook"
)

var (
	reLessonStamp   = regexp.MustCompile(`(?m)^-\s*\[[0-9]{4}-[0-9]{2}-[0-9]{2}[^\]]*\]\s*`)
	reLessonBullet  = regexp.MustCompile(`(?m)^-\s+`)
	reMultiSpace    = regexp.MustCompile(`\s+`)
)

// normalizeLessonBody 同类经验归一化：去时间戳/列表前缀、剥 intent 拼接头、压空白。
func normalizeLessonBody(s string) string {
	s = strings.TrimSpace(s)
	if s == "" {
		return ""
	}
	s = strings.ReplaceAll(s, "\r\n", "\n")
	s = strings.ReplaceAll(s, "\r", "\n")
	s = reLessonStamp.ReplaceAllString(s, "")
	s = reLessonBullet.ReplaceAllString(s, "")
	s = stripLeadingIntentPrefix(s)
	s = strings.TrimSpace(s)
	s = reMultiSpace.ReplaceAllString(s, " ")
	return strings.ToLower(s)
}

// stripLeadingIntentPrefix 去掉 teach 拼的「intent。\n模板」头；只剥短首句，保留正文。
func stripLeadingIntentPrefix(s string) string {
	s = strings.TrimSpace(s)
	for _, sep := range []string{"。\n", ".\n", "。\r\n"} {
		i := strings.Index(s, sep)
		if i <= 0 || i > 100 {
			continue
		}
		rest := strings.TrimSpace(s[i+len(sep):])
		if len([]rune(rest)) < 16 {
			continue
		}
		return rest
	}
	return s
}

// lessonFingerprint 同类经验指纹（短 hash）。
func lessonFingerprint(s string) string {
	n := normalizeLessonBody(s)
	if n == "" {
		return ""
	}
	return shortHash(n)
}

// lessonBodiesEquivalent 归一化后是否同一类经验。
func lessonBodiesEquivalent(a, b string) bool {
	na, nb := normalizeLessonBody(a), normalizeLessonBody(b)
	if na == "" || nb == "" {
		return false
	}
	if na == nb {
		return true
	}
	// 一方包含另一方（模板已沉淀、新条仍带短前缀残留）
	if len(na) >= 24 && strings.Contains(nb, na) {
		return true
	}
	if len(nb) >= 24 && strings.Contains(na, nb) {
		return true
	}
	return false
}

// textAlreadyInSection 经验/脚本去重：正文已出现则不再追加（归一化后比对）。
func textAlreadyInSection(section, piece string) bool {
	piece = strings.TrimSpace(piece)
	section = strings.TrimSpace(section)
	if piece == "" {
		return true
	}
	if section == "" || strings.Contains(section, "尚无沉淀") || strings.Contains(section, "update_skill(script") {
		return false
	}
	// 兼容旧路径：整段字面包含
	if strings.Contains(section, piece) {
		return true
	}
	pieceN := normalizeLessonBody(piece)
	if pieceN == "" {
		return true
	}
	if strings.Contains(normalizeLessonBody(section), pieceN) {
		return true
	}
	for _, line := range strings.Split(section, "\n") {
		line = strings.TrimSpace(line)
		if line == "" {
			continue
		}
		if lessonBodiesEquivalent(line, piece) {
			return true
		}
	}
	return false
}

// skillHasEquivalentLesson 项目 Skill「## 经验」是否已有同类正文。
func skillHasEquivalentLesson(d *Deps, skillPath, lessons string) bool {
	if d == nil || d.Notebook == nil {
		return false
	}
	skillPath = strings.TrimSpace(skillPath)
	lessons = strings.TrimSpace(lessons)
	if skillPath == "" || lessons == "" {
		return false
	}
	cur, err := resolveWorkflowSSOT(d, skillPath)
	if err != nil {
		return false
	}
	noteID := firstNonEmpty(cur.NoteID, notebook.SkillNoteID(skillPath))
	existing, err := d.Notebook.GetNote(noteID)
	if err != nil || existing == nil {
		return false
	}
	extras := notebook.ExtractWorkflowNoteBodyExtras(existing.Content)
	return textAlreadyInSection(extras.Lessons, lessons)
}

// HasEquivalentPending 任意未收口回合是否已有同类 pending（跨 intent）。
func (b *LearningEpisodeBook) HasEquivalentPending(projectID, lessons string) bool {
	if b == nil {
		return false
	}
	projectID = strings.TrimSpace(projectID)
	fp := lessonFingerprint(lessons)
	if fp == "" && strings.TrimSpace(lessons) == "" {
		return false
	}
	b.mu.RLock()
	defer b.mu.RUnlock()
	for _, ep := range b.items {
		if projectID != "" && ep.ProjectID != projectID {
			continue
		}
		if ep.Status != episodeStatusOpen && ep.Status != episodeStatusOffered {
			continue
		}
		for _, existing := range ep.PendingLessons {
			if fp != "" && existing.Fingerprint == fp {
				return true
			}
			if lessonBodiesEquivalent(existing.Lessons, lessons) {
				return true
			}
		}
	}
	return false
}
