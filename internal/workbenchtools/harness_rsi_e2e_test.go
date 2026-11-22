package workbenchtools

import (
	"encoding/json"
	"strings"
	"testing"

	"WWorkbench/internal/notebook"
)

func testHarnessDeps(t *testing.T) *Deps {
	t.Helper()
	dir := t.TempDir()
	nb := notebook.NewService(nil, dir)
	return &Deps{
		Notebook: nb,
		Harness:  NewHarnessCandidateBook(nil),
		Episodes: NewLearningEpisodeBook(nil),
	}
}

func TestE2E_ProposeEvalPromote_BrowserMacro(t *testing.T) {
	d := testHarnessDeps(t)
	skill := "项目/rsi-demo"

	// 1) 建空 Skill 基线
	create := UpdateSkillNow(d, UpdateSkillArgs{
		Name: skill, Intent: "初始化", Title: "RSI Demo",
		Lessons: "尚无沉淀", Description: "e2e",
	})
	if !create.OK {
		t.Fatalf("create skill: %s", create.Error)
	}

	patch := "登录页表单已用 browser_run(mode=macro) 跑通。下次少摸索；收口写进 Skill。"
	pre := "尚无沉淀"

	// 2) Propose（写前基线）
	prop := ProposeHarnessPatch(d, ProposeHarnessArgs{
		SkillPath: skill, LessonsPatch: patch, Domain: "browser",
		Intent: "登录宏", EmitUI: false, BaseLessons: &pre,
	})
	if !prop.OK {
		t.Fatalf("propose: %s", prop.Error)
	}
	var wrap struct {
		Candidate HarnessCandidate `json:"candidate"`
	}
	if err := json.Unmarshal(prop.Data, &wrap); err != nil {
		t.Fatal(err)
	}
	c := wrap.Candidate
	if c.ID == "" {
		t.Fatal("empty candidate id")
	}
	if c.Score == nil || !c.Score.Pass {
		t.Fatalf("auto-eval should pass: %+v", c.Score)
	}
	t.Logf("propose score=%d pass=%v breakdown=%v", c.Score.Total, c.Score.Pass, c.Score.Breakdown)

	// 3) Eval 再跑一轮应仍达标
	ev := EvalHarnessCandidate(d, c.ID)
	if !ev.OK {
		t.Fatalf("eval: %s", ev.Error)
	}

	// 4) Promote 升版写入
	prom := PromoteHarnessCandidate(d, c.ID, "e2e 升版", false)
	if !prom.OK {
		t.Fatalf("promote: %s data=%s", prom.Error, string(prom.Data))
	}
	got, ok := d.Harness.Get(c.ID)
	if !ok || got.Status != harnessStatusPromoted {
		t.Fatalf("status after promote: %+v ok=%v", got, ok)
	}

	note, err := d.Notebook.GetNote(notebook.SkillNoteID(skill))
	if err != nil || note == nil {
		t.Fatalf("get note: %v", err)
	}
	extras := notebook.ExtractWorkflowNoteBodyExtras(note.Content)
	if !strings.Contains(extras.Lessons, "browser_run") {
		t.Fatalf("lessons missing macro after promote:\n%s", extras.Lessons)
	}
	t.Logf("promote ok · lessons head=%q", truncateRunes(extras.Lessons, 80))

	// 5) 再 promote 应 already
	again := PromoteHarnessCandidate(d, c.ID, "again", false)
	if !again.OK {
		t.Fatalf("re-promote: %s", again.Error)
	}
	var againWrap struct {
		Already bool `json:"already"`
	}
	_ = json.Unmarshal(again.Data, &againWrap)
	if !againWrap.Already {
		t.Fatal("expected already=true on second promote")
	}
}

func TestE2E_EpisodeClose_AutoProposeWithPreWriteBase(t *testing.T) {
	d := testHarnessDeps(t)
	skill := "项目/rsi-episode"

	// 先有一点旧经验（不含本次补丁）
	if res := UpdateSkillNow(d, UpdateSkillArgs{
		Name: skill, Intent: "初始化", Title: "Episode Demo",
		Lessons: "旧经验：只用过 browser_snapshot 探索", Description: "e2e",
	}); !res.OK {
		t.Fatalf("create: %s", res.Error)
	}

	lesson := "支付确认页已用 browser_run(mode=macro) 跑通。下次直接复用；收口写进 Skill。"
	ep := d.Episodes.AppendLesson("p1", "支付宏", skill, EpisodePendingLesson{
		Kind: "lesson", HumanLabel: "支付宏", Lessons: lesson, Domain: "browser", Tool: "browser_run",
	})
	if ep.ID == "" || len(ep.PendingLessons) == 0 {
		t.Fatalf("episode: %+v", ep)
	}
	ids := []string{ep.PendingLessons[0].ID}

	closeRes := CloseLearningEpisode(d, ep.ID, ids, false)
	if !closeRes.OK {
		t.Fatalf("close: %s", closeRes.Error)
	}
	var out struct {
		Written            int    `json:"written"`
		HarnessCandidateID string `json:"harnessCandidateId"`
		HarnessScore       int    `json:"harnessScore"`
	}
	if err := json.Unmarshal(closeRes.Data, &out); err != nil {
		t.Fatal(err)
	}
	if out.Written < 1 {
		t.Fatalf("expected written>=1: %+v data=%s", out, string(closeRes.Data))
	}
	if out.HarnessCandidateID == "" {
		t.Fatalf("expected auto harness candidate: data=%s", string(closeRes.Data))
	}
	if out.HarnessScore < harnessPromoteMinScore {
		cand, _ := d.Harness.Get(out.HarnessCandidateID)
		t.Fatalf("episode auto-propose under-scored %d (min %d); score=%+v base=%q",
			out.HarnessScore, harnessPromoteMinScore, cand.Score, cand.BaseLessons)
	}
	t.Logf("episode→harness candidate=%s score=%d", out.HarnessCandidateID, out.HarnessScore)

	// Promote 应成功（内容可能已写，skipped 亦可）
	prom := PromoteHarnessCandidate(d, out.HarnessCandidateID, "episode 升版", false)
	if !prom.OK {
		t.Fatalf("promote after episode: %s %s", prom.Error, string(prom.Data))
	}
	cand, _ := d.Harness.Get(out.HarnessCandidateID)
	if cand.Status != harnessStatusPromoted {
		t.Fatalf("want promoted, got %s", cand.Status)
	}
}

func TestE2E_DiscardAndList(t *testing.T) {
	d := testHarnessDeps(t)
	patch := "导航已用 browser_run(mode=macro) 验证。下次少摸索；收口写进 Skill。"
	prop := ProposeHarnessPatch(d, ProposeHarnessArgs{
		SkillPath: "项目/discard-me", LessonsPatch: patch, Domain: "browser", EmitUI: false,
	})
	if !prop.OK {
		t.Fatalf("propose: %s", prop.Error)
	}
	var wrap struct {
		Candidate HarnessCandidate `json:"candidate"`
	}
	_ = json.Unmarshal(prop.Data, &wrap)
	if len(d.Harness.List("项目/discard-me", 10)) != 1 {
		t.Fatal("list should show proposed")
	}
	dis := DiscardHarnessCandidate(d, wrap.Candidate.ID, false)
	if !dis.OK {
		t.Fatalf("discard: %s", dis.Error)
	}
	if len(d.Harness.List("项目/discard-me", 10)) != 0 {
		t.Fatal("list should hide discarded")
	}
}

func TestE2E_RejectNonBrowserDomain(t *testing.T) {
	d := testHarnessDeps(t)
	res := ProposeHarnessPatch(d, ProposeHarnessArgs{
		SkillPath: "项目/ops", LessonsPatch: "browser_run 宏", Domain: "ops", EmitUI: false,
	})
	if res.OK {
		t.Fatal("ops domain must fail in v1")
	}
}
