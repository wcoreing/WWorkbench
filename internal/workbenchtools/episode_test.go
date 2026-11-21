package workbenchtools

import "testing"

func TestLearningEpisodeBookTouchAppendClose(t *testing.T) {
	b := NewLearningEpisodeBook(nil)
	ep := b.Touch("proj1", "部署前端", "项目/Demo", "call1")
	if ep.ID == "" || ep.Status != episodeStatusOpen {
		t.Fatalf("touch: %+v", ep)
	}
	ep2 := b.AppendLesson("proj1", "部署前端", "项目/Demo", EpisodePendingLesson{
		Lessons: "用 rsync 同步 dist",
		Kind:    "lesson",
	})
	if len(ep2.PendingLessons) != 1 {
		t.Fatalf("pending=%d", len(ep2.PendingLessons))
	}
	// 同意图应复用回合
	ep3 := b.Touch("proj1", "部署前端", "项目/Demo", "call2")
	if ep3.ID != ep.ID {
		t.Fatalf("expected same episode %s vs %s", ep.ID, ep3.ID)
	}
	if len(ep3.CallIDs) < 2 {
		t.Fatalf("callIds=%v", ep3.CallIDs)
	}
	closed, ok := b.Close(ep.ID, []string{ep2.PendingLessons[0].ID}, false)
	if !ok || closed.Status != episodeStatusClosed {
		t.Fatalf("close: ok=%v %+v", ok, closed)
	}
	opens := b.ListOpen("proj1", 5)
	if len(opens) != 0 {
		t.Fatalf("expected no open, got %d", len(opens))
	}
}

func TestHumanizeLessonLabel(t *testing.T) {
	got := humanizeLessonLabel("关键 shell 已跑通。危险命令走确认。", "lesson")
	if got == "" || got == "关键 shell 已跑通。危险命令走确认。" {
		t.Fatalf("expected human prefix, got %q", got)
	}
	trust := humanizeLessonLabel("fp=abc", "trust")
	if trust == "" {
		t.Fatal("trust label empty")
	}
}
