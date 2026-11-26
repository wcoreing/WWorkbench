package agent

import (
	"strings"
	"testing"
	"unicode/utf8"

	"WWorkbench/internal/workbenchtools"
)

func TestReadFileMessageKeepsTail(t *testing.T) {
	body := strings.Repeat("行\n", 9000) + "</template>"
	res := workbenchtools.OKData(body)
	got, ok := fileToolMessage("read_file", res, 0)
	if !ok {
		t.Fatal("expected file message")
	}
	if !strings.HasSuffix(got, "</template>") {
		t.Fatalf("tail missing: %s", got[len(got)-40:])
	}
	if strings.Contains(got, "已截断") {
		t.Fatal("read_file should not use the generic truncation note")
	}
	if utf8.RuneCountInString(body) <= maxToolMsgRunes {
		t.Fatal("fixture should exceed the generic tool window")
	}
}
