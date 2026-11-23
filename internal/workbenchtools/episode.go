package workbenchtools

import (
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"fmt"
	"strings"
	"sync"
	"time"

	"WWorkbench/internal/store"
)

const (
	mcpEpisodesSettingKey = "mcp_learning_episodes"
	episodeStatusOpen     = "open"
	episodeStatusOffered  = "offered"
	episodeStatusClosed   = "closed"
	episodeStatusSkipped  = "skipped"
	maxEpisodesKept       = 80
)

// EpisodePendingLesson 待人审沉淀条目。
type EpisodePendingLesson struct {
	ID          string `json:"id"`
	Kind        string `json:"kind"` // lesson | trust | script
	HumanLabel  string `json:"humanLabel"`
	Lessons     string `json:"lessons"`
	Tool        string `json:"tool,omitempty"`
	Domain      string `json:"domain,omitempty"`
	Fingerprint string `json:"fingerprint,omitempty"`
	At          int64  `json:"at"`
}

// LearningEpisode 一次人话目标的完整生命周期。
type LearningEpisode struct {
	ID                string                 `json:"id"`
	ProjectID         string                 `json:"projectId"`
	Intent            string                 `json:"intent"`
	IntentHash        string                 `json:"intentHash"`
	Status            string                 `json:"status"`
	SkillPath         string                 `json:"skillPath,omitempty"`
	CallIDs           []string               `json:"callIds,omitempty"`
	TrustFingerprints []string               `json:"trustFingerprints,omitempty"`
	PendingLessons    []EpisodePendingLesson `json:"pendingLessons,omitempty"`
	StartedAt         int64                  `json:"startedAt"`
	UpdatedAt         int64                  `json:"updatedAt"`
	ClosedAt          int64                  `json:"closedAt,omitempty"`
	OfferedAt         int64                  `json:"offeredAt,omitempty"`
}

// LearningEpisodeBook 内存 + app_settings 持久化。
type LearningEpisodeBook struct {
	mu    sync.RWMutex
	items []LearningEpisode
	store *store.Store
}

// NewLearningEpisodeBook 从设置加载回合账本。
func NewLearningEpisodeBook(st *store.Store) *LearningEpisodeBook {
	b := &LearningEpisodeBook{store: st}
	b.load()
	return b
}

func (b *LearningEpisodeBook) load() {
	if b == nil || b.store == nil {
		return
	}
	raw, err := b.store.GetAppSetting(mcpEpisodesSettingKey)
	if err != nil || strings.TrimSpace(raw) == "" {
		return
	}
	var items []LearningEpisode
	if json.Unmarshal([]byte(raw), &items) != nil {
		return
	}
	b.mu.Lock()
	b.items = items
	b.mu.Unlock()
}

func (b *LearningEpisodeBook) persistLocked() {
	if b == nil || b.store == nil {
		return
	}
	if len(b.items) > maxEpisodesKept {
		b.items = b.items[:maxEpisodesKept]
	}
	raw, _ := json.Marshal(b.items)
	_ = b.store.SetAppSetting(mcpEpisodesSettingKey, string(raw))
}

// ListOpen 未收口回合（open|offered），新→旧。
func (b *LearningEpisodeBook) ListOpen(projectID string, limit int) []LearningEpisode {
	if b == nil {
		return nil
	}
	if limit <= 0 {
		limit = 5
	}
	projectID = strings.TrimSpace(projectID)
	b.mu.RLock()
	defer b.mu.RUnlock()
	out := make([]LearningEpisode, 0, limit)
	for _, ep := range b.items {
		if ep.Status != episodeStatusOpen && ep.Status != episodeStatusOffered {
			continue
		}
		if projectID != "" && ep.ProjectID != projectID {
			continue
		}
		out = append(out, ep)
		if len(out) >= limit {
			break
		}
	}
	return out
}

// Get 按 id 取回合。
func (b *LearningEpisodeBook) Get(id string) (LearningEpisode, bool) {
	if b == nil {
		return LearningEpisode{}, false
	}
	id = strings.TrimSpace(id)
	b.mu.RLock()
	defer b.mu.RUnlock()
	for _, ep := range b.items {
		if ep.ID == id {
			return ep, true
		}
	}
	return LearningEpisode{}, false
}

// Touch 按项目+intent 打开或推进回合。
func (b *LearningEpisodeBook) Touch(projectID, intent, skillPath, callID string) LearningEpisode {
	if b == nil {
		return LearningEpisode{}
	}
	projectID = strings.TrimSpace(projectID)
	intent = strings.TrimSpace(intent)
	skillPath = strings.TrimSpace(skillPath)
	callID = strings.TrimSpace(callID)
	ih := IntentHash(intent)
	now := time.Now().UnixMilli()

	b.mu.Lock()
	defer b.mu.Unlock()
	for i := range b.items {
		ep := &b.items[i]
		if ep.ProjectID != projectID || ep.IntentHash != ih {
			continue
		}
		if ep.Status != episodeStatusOpen && ep.Status != episodeStatusOffered {
			continue
		}
		if skillPath != "" {
			ep.SkillPath = skillPath
		}
		if intent != "" {
			ep.Intent = intent
		}
		if callID != "" && !containsStr(ep.CallIDs, callID) {
			ep.CallIDs = append(ep.CallIDs, callID)
		}
		ep.UpdatedAt = now
		out := *ep
		b.persistLocked()
		return out
	}

	ep := LearningEpisode{
		ID:         fmt.Sprintf("ep_%s_%d", shortHash(projectID+ih), now),
		ProjectID:  projectID,
		Intent:     intent,
		IntentHash: ih,
		Status:     episodeStatusOpen,
		SkillPath:  skillPath,
		StartedAt:  now,
		UpdatedAt:  now,
	}
	if callID != "" {
		ep.CallIDs = []string{callID}
	}
	b.items = append([]LearningEpisode{ep}, b.items...)
	b.persistLocked()
	return ep
}

// AppendLesson 追加待沉淀（去重）；返回更新后回合。
func (b *LearningEpisodeBook) AppendLesson(projectID, intent, skillPath string, lesson EpisodePendingLesson) LearningEpisode {
	ep := b.Touch(projectID, intent, skillPath, "")
	if strings.TrimSpace(ep.ID) == "" {
		return ep
	}
	lesson.ID = strings.TrimSpace(lesson.ID)
	if lesson.ID == "" {
		lesson.ID = fmt.Sprintf("les_%d", time.Now().UnixNano())
	}
	lesson.Lessons = strings.TrimSpace(lesson.Lessons)
	lesson.HumanLabel = strings.TrimSpace(lesson.HumanLabel)
	if lesson.HumanLabel == "" {
		lesson.HumanLabel = humanizeLessonLabel(lesson.Lessons, lesson.Kind)
	}
	if lesson.At == 0 {
		lesson.At = time.Now().UnixMilli()
	}
	if lesson.Kind == "" {
		lesson.Kind = "lesson"
	}
	if strings.TrimSpace(lesson.Fingerprint) == "" {
		lesson.Fingerprint = lessonFingerprint(lesson.Lessons)
	}

	b.mu.Lock()
	defer b.mu.Unlock()
	for i := range b.items {
		if b.items[i].ID != ep.ID {
			continue
		}
		for _, existing := range b.items[i].PendingLessons {
			if lesson.Fingerprint != "" && existing.Fingerprint == lesson.Fingerprint {
				return b.items[i]
			}
			if existing.Lessons == lesson.Lessons || lessonBodiesEquivalent(existing.Lessons, lesson.Lessons) {
				return b.items[i]
			}
		}
		b.items[i].PendingLessons = append(b.items[i].PendingLessons, lesson)
		b.items[i].UpdatedAt = time.Now().UnixMilli()
		if b.items[i].Status == episodeStatusOffered {
			b.items[i].Status = episodeStatusOpen // 新条目到来，允许再次收口
			b.items[i].OfferedAt = 0
		}
		out := b.items[i]
		b.persistLocked()
		return out
	}
	return ep
}

// RecordTrust 记录已写入 Skill 的信任指纹（不进 pending，避免双写）。
func (b *LearningEpisodeBook) RecordTrust(projectID, intent, skillPath, fingerprint string) {
	if b == nil || strings.TrimSpace(fingerprint) == "" {
		return
	}
	ep := b.Touch(projectID, intent, skillPath, "")
	if strings.TrimSpace(ep.ID) == "" {
		return
	}
	b.mu.Lock()
	defer b.mu.Unlock()
	for i := range b.items {
		if b.items[i].ID != ep.ID {
			continue
		}
		if !containsStr(b.items[i].TrustFingerprints, fingerprint) {
			b.items[i].TrustFingerprints = append(b.items[i].TrustFingerprints, fingerprint)
		}
		b.items[i].UpdatedAt = time.Now().UnixMilli()
		b.persistLocked()
		return
	}
}

// MarkOffered 标记已弹出成长卡。
func (b *LearningEpisodeBook) MarkOffered(id string) (LearningEpisode, bool) {
	if b == nil {
		return LearningEpisode{}, false
	}
	id = strings.TrimSpace(id)
	now := time.Now().UnixMilli()
	b.mu.Lock()
	defer b.mu.Unlock()
	for i := range b.items {
		if b.items[i].ID != id {
			continue
		}
		b.items[i].Status = episodeStatusOffered
		b.items[i].OfferedAt = now
		b.items[i].UpdatedAt = now
		out := b.items[i]
		b.persistLocked()
		return out, true
	}
	return LearningEpisode{}, false
}

// Close 收口：保留选中 lessons，清空 pending；skip=true 则整回合跳过。
func (b *LearningEpisodeBook) Close(id string, keepIDs []string, skip bool) (LearningEpisode, bool) {
	if b == nil {
		return LearningEpisode{}, false
	}
	id = strings.TrimSpace(id)
	now := time.Now().UnixMilli()
	keep := map[string]bool{}
	for _, k := range keepIDs {
		k = strings.TrimSpace(k)
		if k != "" {
			keep[k] = true
		}
	}
	b.mu.Lock()
	defer b.mu.Unlock()
	for i := range b.items {
		if b.items[i].ID != id {
			continue
		}
		if skip {
			b.items[i].Status = episodeStatusSkipped
		} else {
			b.items[i].Status = episodeStatusClosed
			if len(keep) > 0 {
				kept := make([]EpisodePendingLesson, 0, len(keep))
				for _, les := range b.items[i].PendingLessons {
					if keep[les.ID] {
						kept = append(kept, les)
					}
				}
				b.items[i].PendingLessons = kept
			} else {
				b.items[i].PendingLessons = nil
			}
		}
		b.items[i].ClosedAt = now
		b.items[i].UpdatedAt = now
		out := b.items[i]
		b.persistLocked()
		return out, true
	}
	return LearningEpisode{}, false
}

// PendingLessonsForClose 取出待写 lessons（按 keepIDs 过滤；空=全部）。
func (b *LearningEpisodeBook) PendingLessonsForClose(id string, keepIDs []string) []EpisodePendingLesson {
	ep, ok := b.Get(id)
	if !ok {
		return nil
	}
	if len(keepIDs) == 0 {
		return append([]EpisodePendingLesson(nil), ep.PendingLessons...)
	}
	keep := map[string]bool{}
	for _, k := range keepIDs {
		keep[strings.TrimSpace(k)] = true
	}
	out := make([]EpisodePendingLesson, 0, len(keepIDs))
	for _, les := range ep.PendingLessons {
		if keep[les.ID] {
			out = append(out, les)
		}
	}
	return out
}

// IntentHash 稳定意图哈希（短）。
func IntentHash(intent string) string {
	intent = strings.TrimSpace(strings.ToLower(intent))
	if intent == "" {
		intent = "(empty)"
	}
	return shortHash(intent)
}

func shortHash(s string) string {
	sum := sha256.Sum256([]byte(s))
	return hex.EncodeToString(sum[:])[:12]
}

func containsStr(list []string, v string) bool {
	for _, x := range list {
		if x == v {
			return true
		}
	}
	return false
}

func humanizeLessonLabel(lessons, kind string) string {
	lessons = strings.TrimSpace(lessons)
	if kind == "trust" {
		return "下次同类操作少问你一次（信任免确认）"
	}
	first := lessons
	if i := strings.IndexAny(first, "。\n"); i > 0 {
		first = first[:i]
	}
	first = truncateRunes(first, 42)
	if first == "" {
		return "记住这次做法，下次少摸索"
	}
	return "下次：" + first
}
