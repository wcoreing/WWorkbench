package harness

import (
	"strings"
	"unicode/utf8"

	"github.com/wcoreing/ningharness/lesson"
)

const lessonBodyMaxRunes = 400

// promoteToolErrorsToLessons 将本轮工具失败去重写入 project lesson，供下轮 InjectBrief 前馈。
// 引导成长：沉淀可审阅的项目经验，而非静默改写行为；重复指纹跳过。
func promoteToolErrorsToLessons(root, sessionKey, taskID string, errs []string) {
	root = strings.TrimSpace(root)
	if root == "" || len(errs) == 0 {
		return
	}
	existing, _ := lesson.ListActiveProject(root, 40)
	for _, errLine := range errs {
		errLine = strings.TrimSpace(errLine)
		if errLine == "" {
			continue
		}
		body := formatToolErrorLesson(errLine)
		fp := lessonFingerprint(body)
		if fp == "" || lessonHasFingerprint(existing, fp) {
			continue
		}
		e, err := lesson.Append(lesson.AppendInput{
			Root:             root,
			Scope:            lesson.ScopeProject,
			Body:             body,
			SourceTaskID:     taskID,
			SourceSessionKey: sessionKey,
		})
		if err != nil {
			continue
		}
		existing = append(existing, e)
	}
}

func formatToolErrorLesson(errLine string) string {
	body := "工具失败教训：" + errLine + "。下次先改参数/换对应能力，勿重复同一非法调用。"
	if utf8.RuneCountInString(body) <= lessonBodyMaxRunes {
		return body
	}
	r := []rune(body)
	return string(r[:lessonBodyMaxRunes-1]) + "…"
}

func lessonFingerprint(body string) string {
	body = strings.TrimSpace(body)
	if body == "" {
		return ""
	}
	// 用「工具失败教训：」后到首个空格/句号前的 tool:code 段做指纹
	const prefix = "工具失败教训："
	s := body
	if i := strings.Index(s, prefix); i >= 0 {
		s = s[i+len(prefix):]
	}
	if i := strings.IndexAny(s, "。.\n"); i >= 0 {
		s = s[:i]
	}
	s = strings.TrimSpace(s)
	if utf8.RuneCountInString(s) > 120 {
		s = string([]rune(s)[:120])
	}
	return s
}

func lessonHasFingerprint(entries []lesson.Entry, fp string) bool {
	if fp == "" {
		return false
	}
	for _, e := range entries {
		if strings.Contains(e.Body, fp) {
			return true
		}
	}
	return false
}
