package workbenchtools

import (
	"strings"
	"testing"
)

func TestNormalizeLessonBody_StripsIntentAndStamp(t *testing.T) {
	raw := "修复标签条滚动条。\n远程 shell 已在可见终端跑通。危险命令走确认弹窗。"
	stamped := "- [2026-11-23 16:00] " + raw
	n1 := normalizeLessonBody(raw)
	n2 := normalizeLessonBody(stamped)
	if n1 == "" || n2 == "" {
		t.Fatal("empty normalize")
	}
	if n1 != n2 {
		t.Fatalf("stamp should not change fingerprint body:\n%q\n%q", n1, n2)
	}
	if strings.Contains(n1, "修复标签条") {
		t.Fatalf("intent prefix should be stripped: %q", n1)
	}
}

func TestLessonBodiesEquivalent_AcrossIntentPrefix(t *testing.T) {
	a := "修数据库 tab。\n远程 shell 已在可见终端跑通。本机非硬风险免确认；远端危险命令走确认弹窗。"
	b := "对齐舞台。\n远程 shell 已在可见终端跑通。本机非硬风险免确认；远端危险命令走确认弹窗。"
	if !lessonBodiesEquivalent(a, b) {
		t.Fatal("same template under different intents should be equivalent")
	}
	if lessonFingerprint(a) != lessonFingerprint(b) {
		t.Fatal("fingerprints should match after normalize")
	}
}

func TestTextAlreadyInSection_Normalized(t *testing.T) {
	sec := "- [2026-11-15 09:00] 远程 shell 已在可见终端跑通。本机非硬风险免确认；远端危险命令走确认弹窗。\n- [2026-11-15 09:01] 其它"
	piece := "修 tab。\n远程 shell 已在可见终端跑通。本机非硬风险免确认；远端危险命令走确认弹窗。"
	if !textAlreadyInSection(sec, piece) {
		t.Fatal("expected duplicate after normalize")
	}
	if textAlreadyInSection(sec, "全新经验从未出现过") {
		t.Fatal("new lesson should not count as present")
	}
}
