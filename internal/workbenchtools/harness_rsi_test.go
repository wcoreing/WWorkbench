package workbenchtools

import (
	"encoding/json"
	"testing"
)

func TestScoreHarnessCandidate_BrowserMacro(t *testing.T) {
	c := HarnessCandidate{
		LessonsPatch: "登录页已跑通。下次用 browser_run(mode=macro) 复用；收口写进 Skill。",
		BaseLessons:  "尚无沉淀",
	}
	sc := scoreHarnessCandidate(c)
	if !sc.Pass {
		t.Fatalf("expected pass, got %d %v", sc.Total, sc.Breakdown)
	}
	if sc.Total < harnessPromoteMinScore {
		t.Fatalf("score %d < min %d", sc.Total, harnessPromoteMinScore)
	}
}

func TestScoreHarnessCandidate_RejectEmpty(t *testing.T) {
	sc := scoreHarnessCandidate(HarnessCandidate{})
	if sc.Pass || sc.Total != 0 {
		t.Fatalf("empty should fail: %+v", sc)
	}
}

func TestLooksLikeHarnessablePatch(t *testing.T) {
	if !looksLikeHarnessablePatch("browser", "稳定 browser_run 宏路径") {
		t.Fatal("expected browser_run patch accepted")
	}
	if looksLikeHarnessablePatch("ops", "browser_run 宏") {
		t.Fatal("ops domain should be rejected in v1 slice")
	}
	if looksLikeHarnessablePatch("browser", "随便写点无关经验没有路径信号") {
		t.Fatal("unrelated patch should be rejected")
	}
	if looksLikeHarnessablePatch("browser", "文本里碰巧有宏字但不是路径") {
		t.Fatal("lone 宏 char should not match")
	}
}

func TestHarnessCandidateBook_CRUD(t *testing.T) {
	b := NewHarnessCandidateBook(nil)
	c := b.Add(HarnessCandidate{
		SkillPath:    "项目/demo",
		LessonsPatch: "browser_run 宏已跑通，下次直接复用。",
		Domain:       "browser",
		Summary:      "demo",
	})
	if c.ID == "" || c.Status != harnessStatusProposed {
		t.Fatalf("add: %+v", c)
	}
	got, ok := b.Get(c.ID)
	if !ok || got.SkillPath != "项目/demo" {
		t.Fatalf("get: %+v ok=%v", got, ok)
	}
	got.Status = harnessStatusEvaluated
	if !b.Update(got) {
		t.Fatal("update failed")
	}
	list := b.List("项目/demo", 10)
	if len(list) != 1 {
		t.Fatalf("list len=%d", len(list))
	}
	got.Status = harnessStatusDiscarded
	_ = b.Update(got)
	if len(b.List("项目/demo", 10)) != 0 {
		t.Fatal("discarded should be hidden from list")
	}
}

func TestProposeHarnessPatch_RequireBrowserSignal(t *testing.T) {
	d := &Deps{Harness: NewHarnessCandidateBook(nil)}
	res := ProposeHarnessPatch(d, ProposeHarnessArgs{
		SkillPath:    "项目/x",
		LessonsPatch: "无关文本没有宏信号",
		Domain:       "browser",
		EmitUI:       false,
	})
	if res.OK {
		t.Fatal("expected fail without browser signal")
	}
}

func TestProposeAndEvalHarnessPatch(t *testing.T) {
	d := &Deps{Harness: NewHarnessCandidateBook(nil)}
	res := ProposeHarnessPatch(d, ProposeHarnessArgs{
		SkillPath:    "项目/web",
		LessonsPatch: "表单提交已用 browser_run(mode=macro) 跑通。下次少摸索；收口写进 Skill。",
		Domain:       "browser",
		Intent:       "表单宏",
		EmitUI:       false,
	})
	if !res.OK {
		t.Fatalf("propose: %s", res.Error)
	}
	var wrap struct {
		Candidate HarnessCandidate `json:"candidate"`
	}
	if err := json.Unmarshal(res.Data, &wrap); err != nil {
		t.Fatal(err)
	}
	if wrap.Candidate.ID == "" {
		t.Fatal("missing candidate id")
	}
	if wrap.Candidate.Score == nil || !wrap.Candidate.Score.Pass {
		t.Fatalf("auto-eval should pass: %+v", wrap.Candidate.Score)
	}
	ev := EvalHarnessCandidate(d, wrap.Candidate.ID)
	if !ev.OK {
		t.Fatalf("eval: %s", ev.Error)
	}
}

func TestProposeUsesPreWriteBaseNotPostWriteNote(t *testing.T) {
	d := &Deps{Harness: NewHarnessCandidateBook(nil)}
	patch := "登录已用 browser_run(mode=macro) 跑通。下次少摸索；收口写进 Skill。"
	// 模拟写盘后笔记已含补丁；若误用写后基线会判重复。传写前空基线应达标。
	pre := "尚无沉淀"
	res := ProposeHarnessPatch(d, ProposeHarnessArgs{
		SkillPath:    "项目/web",
		LessonsPatch: patch,
		Domain:       "browser",
		EmitUI:       false,
		BaseLessons:  &pre,
	})
	if !res.OK {
		t.Fatalf("propose: %s", res.Error)
	}
	var wrap struct {
		Candidate HarnessCandidate `json:"candidate"`
	}
	_ = json.Unmarshal(res.Data, &wrap)
	if wrap.Candidate.Score == nil || !wrap.Candidate.Score.Pass {
		t.Fatalf("pre-write base should pass: %+v", wrap.Candidate.Score)
	}
	// 对比：若把写后全文当基线，会低估
	post := "- [2026-01-01] " + patch
	bad := scoreHarnessCandidate(HarnessCandidate{LessonsPatch: patch, BaseLessons: post})
	good := scoreHarnessCandidate(HarnessCandidate{LessonsPatch: patch, BaseLessons: pre})
	if !(good.Total > bad.Total) {
		t.Fatalf("pre-write score %d should beat post-write baseline %d", good.Total, bad.Total)
	}
}

func TestPromoteRequiresPassUnlessForce(t *testing.T) {
	d := &Deps{Harness: NewHarnessCandidateBook(nil)}
	c := d.Harness.Add(HarnessCandidate{
		SkillPath:    "项目/low",
		LessonsPatch: "x", // too weak
		Domain:       "browser",
		Score:        &HarnessEvalScore{Total: 10, Pass: false},
		Status:       harnessStatusEvaluated,
	})
	res := PromoteHarnessCandidate(d, c.ID, "test", false)
	if res.OK {
		t.Fatal("low score without force should fail")
	}
}
