package agentchoice

import (
	"fmt"
	"strings"
)

// RetryUserMessage 校验失败时写入 history 的 user 行，驱动模型重写 agent-choice 块。
func RetryUserMessage(err error) string {
	var b strings.Builder
	b.WriteString("【系统】你上一条回复里的 agent-choice / desk-choice JSON 无效，请修正后重新输出整段助手回复。\n\n")
	if ve, ok := err.(*ValidationError); ok {
		b.WriteString(ve.Error())
		if s := strings.TrimSpace(ve.Snippet); s != "" {
			b.WriteString("\n块末尾片段：")
			b.WriteString(s)
		}
	} else if err != nil {
		b.WriteString(err.Error())
	}
	b.WriteString("\n\n要求：")
	b.WriteString("\n- fenced 语言标记用 agent-choice 或 desk-choice")
	b.WriteString("\n- 块内必须是完整可解析 JSON（引号、括号、数组全部闭合）")
	b.WriteString("\n- 单题示例：")
	fmt.Fprintf(&b, "\n```agent-choice\n%s\n```", `{"n":1,"mode":"single","prompt":"下一步？","options":[{"key":"a","label":"选项A"}]}`)
	return b.String()
}
