package workbenchtools

import (
	"fmt"
	"path/filepath"
	"strings"

	"WWorkbench/internal/errno"
)

// tokenizeExecArgv 把 command 拆成 argv（识别引号，不把引号内符号当 shell 语法）。
func tokenizeExecArgv(command string) ([]string, error) {
	s := strings.TrimSpace(command)
	if s == "" {
		return nil, errno.New(errno.CodeInvalidArg, "请填写 command", "")
	}
	var args []string
	var b strings.Builder
	quote := byte(0)
	inToken := false
	flush := func() {
		if !inToken {
			return
		}
		args = append(args, b.String())
		b.Reset()
		inToken = false
	}
	for i := 0; i < len(s); i++ {
		c := s[i]
		if quote != 0 {
			if c == quote {
				quote = 0
				continue
			}
			if quote == '"' && c == '\\' && i+1 < len(s) {
				n := s[i+1]
				if n == '"' || n == '\\' || n == '$' || n == '`' || n == '\n' {
					b.WriteByte(n)
					i++
					continue
				}
			}
			b.WriteByte(c)
			continue
		}
		if c == '\'' || c == '"' {
			inToken = true
			quote = c
			continue
		}
		if c == ' ' || c == '\t' {
			flush()
			continue
		}
		if c == '\\' && i+1 < len(s) {
			inToken = true
			b.WriteByte(s[i+1])
			i++
			continue
		}
		if op, ok := unquotedShellOp(s, i); ok {
			return nil, errno.New(errno.CodeInvalidArg, unquotedOpHint(op), command)
		}
		inToken = true
		b.WriteByte(c)
	}
	if quote != 0 {
		return nil, errno.New(errno.CodeInvalidArg, "引号未闭合。python -c 的代码请用双引号或单引号包起来。", command)
	}
	flush()
	if len(args) == 0 {
		return nil, errno.New(errno.CodeInvalidArg, "请填写 command", "")
	}
	return args, nil
}

func unquotedShellOp(s string, i int) (string, bool) {
	c := s[i]
	switch c {
	case '\n', '\r':
		return "换行", true
	case ';':
		return ";", true
	case '|':
		return "|", true
	case '&':
		return "&", true
	case '<', '>':
		return string(c), true
	default:
		return "", false
	}
}

func unquotedOpHint(op string) string {
	return fmt.Sprintf(
		"未加引号的 %s 不会按管道/多语句执行（argv 安全模式只起一个进程）。python -c 里的分号请写在引号内；管道请用 terminal_open。",
		op,
	)
}

// posixQuoteArgv 将 argv 编成远端 shell 不会二次拆语句的命令行。
func posixQuoteArgv(argv []string) string {
	parts := make([]string, len(argv))
	for i, a := range argv {
		parts[i] = "'" + strings.ReplaceAll(a, "'", `'"'"'`) + "'"
	}
	return strings.Join(parts, " ")
}

var execBannedBins = map[string]string{
	"rm":       "删除请在终端面板操作（terminal_open）",
	"dd":       "磁盘写入请 terminal_open",
	"mkfs":     "格式化请 terminal_open",
	"shutdown": "关机请 terminal_open",
	"reboot":   "重启请 terminal_open",
	"poweroff": "关机请 terminal_open",
	"halt":     "关机请 terminal_open",
	"chmod":    "改权限请 terminal_open",
	"chown":    "改属主请 terminal_open",
	"kill":     "杀进程请 terminal_open",
	"pkill":    "杀进程请 terminal_open",
	"killall":  "杀进程请 terminal_open",
	"wget":     "下载请 terminal_open",
	"curl":     "HTTP 请用 execute_http；其它下载请 terminal_open",
	"scp":      "传文件请用 SFTP 或 terminal_open",
	"sftp":     "传文件请用 SFTP 产品线",
	"sudo":     "提权请 terminal_open",
	"su":       "提权请 terminal_open",
	"doas":     "提权请 terminal_open",
	"bash":     "不要包一层 shell。直接写要跑的程序（如 python、uptime）",
	"sh":       "不要包一层 shell。直接写要跑的程序（如 python、uptime）",
	"zsh":      "不要包一层 shell。直接写要跑的程序",
	"ksh":      "不要包一层 shell。直接写要跑的程序",
	"dash":     "不要包一层 shell。直接写要跑的程序",
	"fish":     "不要包一层 shell。直接写要跑的程序",
	"csh":      "不要包一层 shell。直接写要跑的程序",
	"tcsh":     "不要包一层 shell。直接写要跑的程序",
	"busybox":  "busybox 请 terminal_open",
	"xargs":    "xargs 请 terminal_open",
	"env":      "请直接写目标程序（如 python），不要经 env 包装",
}

var dockerDeniedVerbs = map[string]bool{
	"rm": true, "rmi": true, "stop": true, "kill": true, "start": true,
	"restart": true, "run": true, "exec": true, "create": true,
}

var dockerComposeDenied = map[string]bool{
	"up": true, "down": true, "kill": true, "rm": true, "start": true,
	"stop": true, "restart": true, "run": true, "exec": true, "create": true,
}

var systemctlDenied = map[string]bool{
	"start": true, "stop": true, "restart": true, "reload": true, "kill": true,
	"mask": true, "unmask": true, "enable": true, "disable": true, "isolate": true,
}

// validateExecArgv 只拦危险程序与 Docker/systemctl 写操作，不拦引号内符号。
func validateExecArgv(argv []string) error {
	if len(argv) == 0 {
		return errno.New(errno.CodeInvalidArg, "请填写 command", "")
	}
	bin := execBinName(argv[0])
	if hint, ok := execBannedBins[bin]; ok {
		return errno.New(errno.CodeInvalidArg, fmt.Sprintf("%s：%s", bin, hint), strings.Join(argv, " "))
	}
	if strings.HasPrefix(bin, "mkfs.") {
		return errno.New(errno.CodeInvalidArg, "mkfs：格式化请 terminal_open", bin)
	}
	if bin == "docker" {
		if err := validateDockerArgv(argv); err != nil {
			return err
		}
	}
	if bin == "systemctl" {
		if err := validateSystemctlArgv(argv); err != nil {
			return err
		}
	}
	return nil
}

func execBinName(argv0 string) string {
	base := strings.ToLower(filepath.Base(argv0))
	return strings.TrimSuffix(base, ".exe")
}

func firstNonFlag(argv []string, start int) (string, int) {
	for i := start; i < len(argv); i++ {
		a := argv[i]
		if a == "--" {
			if i+1 < len(argv) {
				return argv[i+1], i + 1
			}
			return "", i
		}
		if strings.HasPrefix(a, "-") {
			continue
		}
		return a, i
	}
	return "", -1
}

func validateDockerArgv(argv []string) error {
	verb, idx := firstNonFlag(argv, 1)
	verb = strings.ToLower(verb)
	if verb == "" {
		return nil
	}
	if verb == "compose" {
		sub, _ := firstNonFlag(argv, idx+1)
		sub = strings.ToLower(sub)
		if dockerComposeDenied[sub] {
			return errno.New(errno.CodeInvalidArg,
				"容器启停/删除请用 start_container / stop_container / remove_container（会弹确认），勿经 terminal_exec 跑 docker compose "+sub,
				strings.Join(argv, " "))
		}
		return nil
	}
	if dockerDeniedVerbs[verb] {
		return errno.New(errno.CodeInvalidArg,
			"容器启停/删除请用 start_container / stop_container / remove_container（会弹确认），勿经 terminal_exec",
			strings.Join(argv, " "))
	}
	return nil
}

func validateSystemctlArgv(argv []string) error {
	action, _ := firstNonFlag(argv, 1)
	action = strings.ToLower(action)
	if action == "" {
		return errno.New(errno.CodeInvalidArg, "systemctl 请带只读动作，如 status / is-active；启停请 terminal_open", strings.Join(argv, " "))
	}
	if systemctlDenied[action] {
		return errno.New(errno.CodeInvalidArg,
			"systemctl "+action+" 请在终端面板执行（terminal_open）；只读可用 systemctl status / is-active",
			strings.Join(argv, " "))
	}
	return nil
}

// parseAndValidateExec 解析并校验 argv 安全模式命令。
func parseAndValidateExec(command string) ([]string, error) {
	argv, err := tokenizeExecArgv(command)
	if err != nil {
		return nil, err
	}
	if err := validateExecArgv(argv); err != nil {
		return nil, err
	}
	return argv, nil
}
