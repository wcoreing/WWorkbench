package agentchoice

import (
	"regexp"
	"strings"
)

var choiceFenceRE = regexp.MustCompile("(?is)```\\s*(agent-choice|desk-choice|agentchoice|deskchoice)\\s*\\r?\\n([\\s\\S]*?)```")

// Block 助手正文里一处 agent-choice / desk-choice 围栏。
type Block struct {
	Lang  string
	Inner string
}

// ExtractBlocks 抽出显式 agent-choice / desk-choice 围栏（不含 json/无 lang 误写）。
func ExtractBlocks(content string) []Block {
	if strings.TrimSpace(content) == "" {
		return nil
	}
	matches := choiceFenceRE.FindAllStringSubmatch(content, -1)
	if len(matches) == 0 {
		return nil
	}
	out := make([]Block, 0, len(matches))
	for _, m := range matches {
		if len(m) < 3 {
			continue
		}
		out = append(out, Block{Lang: strings.TrimSpace(m[1]), Inner: m[2]})
	}
	return out
}
