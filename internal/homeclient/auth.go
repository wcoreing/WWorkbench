package homeclient

import (
	"fmt"
	"strings"
	"unicode/utf8"
)

// ValidateAuth 与 wwb-home 服务端规则对齐的本地校验（提前提示，少打无效请求）。
func ValidateAuth(username, password string) error {
	u := strings.ToLower(strings.TrimSpace(username))
	if u == "" || utf8.RuneCountInString(u) < 2 || utf8.RuneCountInString(u) > 64 {
		return fmt.Errorf("用户名需 2～64 位，仅限字母、数字、点、下划线、连字符")
	}
	for _, r := range u {
		if (r >= 'a' && r <= 'z') || (r >= '0' && r <= '9') || r == '_' || r == '-' || r == '.' {
			continue
		}
		return fmt.Errorf("用户名需 2～64 位，仅限字母、数字、点、下划线、连字符")
	}
	if len(password) < 6 {
		return fmt.Errorf("密码至少 6 位")
	}
	if len(password) > 128 {
		return fmt.Errorf("密码最长 128 位")
	}
	return nil
}

// HumanizeAuthError 将服务端/网络错误转成可直接展示的中文。
func HumanizeAuthError(err error) string {
	if err == nil {
		return ""
	}
	msg := strings.TrimSpace(err.Error())
	switch {
	case msg == "":
		return "账号服务异常"
	case strings.Contains(msg, "connection refused"),
		strings.Contains(msg, "connect: connection refused"):
		return "连不上账号服务（服务未启动或端口未开）"
	case strings.Contains(msg, "Timeout"), strings.Contains(msg, "timeout"),
		strings.Contains(msg, "i/o timeout"), strings.Contains(msg, "deadline exceeded"):
		return "账号服务超时，请稍后重试"
	case strings.Contains(msg, "no such host"), strings.Contains(msg, "network is unreachable"):
		return "无法解析或访问账号服务地址"
	case strings.Contains(msg, "password_short"), strings.Contains(msg, "密码至少 6"):
		return "密码至少 6 位"
	case strings.Contains(msg, "invalid username or password format"):
		return "用户名或密码格式不正确（用户名 2～64 位；密码至少 6 位）"
	case strings.Contains(msg, "username_exists"), strings.Contains(msg, "already exists"),
		strings.Contains(msg, "已被注册"):
		if strings.Contains(msg, "已被注册") {
			return msg
		}
		return "用户名已被注册，请直接登录或换一个用户名"
	case strings.Contains(msg, "bad_credentials"), strings.Contains(msg, "invalid username or password"):
		if strings.Contains(msg, "用户名或密码错误") {
			return msg
		}
		return "用户名或密码错误"
	case strings.Contains(msg, "username_format"), strings.Contains(msg, "用户名需"):
		if strings.Contains(msg, "用户名需") {
			return msg
		}
		return "用户名需 2～64 位，仅限字母、数字、点、下划线、连字符"
	default:
		// 服务端已返回中文时直接透出
		return msg
	}
}
