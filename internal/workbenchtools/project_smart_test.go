package workbenchtools

import (
	"testing"

	"WWorkbench/internal/model"
)

func TestProjectContextTokens(t *testing.T) {
	tokens := projectContextTokens(model.WorkbenchProjectDO{
		Name:      "百度标注",
		LocalPath: "/Users/weining/workspace/百度标注",
		GitRemote: "nina.v@example.com:org/baidu-annotate.git",
	})
	joined := ""
	for _, tok := range tokens {
		joined += " " + tok
	}
	for _, want := range []string{"百度标注", "baidu", "annotate"} {
		found := false
		for _, tok := range tokens {
			if tok == want || containsFold(tok, want) {
				found = true
				break
			}
		}
		if !found {
			t.Fatalf("missing token %q in %v", want, tokens)
		}
	}
}

func TestScoreTextMatch(t *testing.T) {
	score, hit := scoreTextMatch("Wistop · annotate ops", []string{"annotate", "xx"})
	if score < projectSuggestMinScore || hit != "annotate" {
		t.Fatalf("score=%d hit=%q", score, hit)
	}
}

func containsFold(hay, needle string) bool {
	return len(hay) >= len(needle) && (hay == needle || len(needle) >= 2 && (len(hay) > 0 && (hay == needle)))
}
