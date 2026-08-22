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
		"未加引号的 %s 不会按管道/多语句执行。无头只做只读短探针；管道/多语句请 shell_run 注入到面板。",
		op,
	)
}

const execOpenInstead = "请改用 shell_run 注入到终端面板（人看得见）。无头 shell_probe 只做只读短探针。"

// posixQuoteArgv 将 argv 编成远端 shell 不会二次拆语句的命令行。
func posixQuoteArgv(argv []string) string {
	parts := make([]string, len(argv))
	for i, a := range argv {
		parts[i] = "'" + strings.ReplaceAll(a, "'", `'"'"'`) + "'"
	}
	return strings.Join(parts, " ")
}

// execProbeBins 无头白名单：只读短探针。不在表内的一律请注入面板。
var execProbeBins = map[string]bool{
	"uptime": true, "free": true, "df": true, "du": true, "nproc": true,
	"hostname": true, "uname": true, "whoami": true, "id": true, "date": true, "pwd": true,
	"nvidia-smi": true, "nvcc": true,
	"ps": true, "pgrep": true, "pidof": true,
	"ls": true, "lsblk": true, "lscpu": true, "lsmem": true,
	"cat": true, "head": true, "tail": true, "wc": true, "stat": true, "file": true,
	"grep": true, "egrep": true, "fgrep": true,
	"readlink": true, "realpath": true, "dirname": true, "basename": true,
	"which": true, "whereis": true, "type": true,
	"pip": true, "pip3": true,
	"git": true,
	"docker": true, "systemctl": true, "journalctl": true,
	"ip": true, "ss": true,
	"echo": true, "true": true, "false": true,
}

var execBannedBins = map[string]string{
	"rm":       "删除" + execOpenInstead,
	"dd":       "磁盘写入" + execOpenInstead,
	"mkfs":     "格式化" + execOpenInstead,
	"shutdown": "关机" + execOpenInstead,
	"reboot":   "重启" + execOpenInstead,
	"poweroff": "关机" + execOpenInstead,
	"halt":     "关机" + execOpenInstead,
	"chmod":    "改权限" + execOpenInstead,
	"chown":    "改属主" + execOpenInstead,
	"kill":     "杀进程" + execOpenInstead,
	"pkill":    "杀进程" + execOpenInstead,
	"killall":  "杀进程" + execOpenInstead,
	"wget":     "下载" + execOpenInstead,
	"curl":     "HTTP 请用 execute_http；其它下载" + execOpenInstead,
	"scp":      "传文件请用 SFTP，或" + execOpenInstead,
	"sftp":     "传文件请用 SFTP 产品线",
	"sudo":     "提权" + execOpenInstead,
	"su":       "提权" + execOpenInstead,
	"doas":     "提权" + execOpenInstead,
	"bash":     "不要包一层 shell；无头直接写探针程序。长命令/脚本" + execOpenInstead,
	"sh":       "不要包一层 shell；无头直接写探针程序。长命令/脚本" + execOpenInstead,
	"zsh":      "不要包一层 shell。" + execOpenInstead,
	"ksh":      "不要包一层 shell。" + execOpenInstead,
	"dash":     "不要包一层 shell。" + execOpenInstead,
	"fish":     "不要包一层 shell。" + execOpenInstead,
	"csh":      "不要包一层 shell。" + execOpenInstead,
	"tcsh":     "不要包一层 shell。" + execOpenInstead,
	"busybox":  "busybox " + execOpenInstead,
	"xargs":    "xargs " + execOpenInstead,
	"env":      "请直接写目标程序，不要经 env 包装",
	"nohup":    "后台任务" + execOpenInstead,
	"screen":   "会话复用" + execOpenInstead,
	"tmux":     "会话复用" + execOpenInstead,
	"apt":      "装包" + execOpenInstead,
	"apt-get":  "装包" + execOpenInstead,
	"yum":      "装包" + execOpenInstead,
	"dnf":      "装包" + execOpenInstead,
	"pacman":   "装包" + execOpenInstead,
	"make":     "构建" + execOpenInstead,
	"cmake":    "构建" + execOpenInstead,
	"gcc":      "编译" + execOpenInstead,
	"g++":      "编译" + execOpenInstead,
}

var dockerProbeVerbs = map[string]bool{
	"ps": true, "images": true, "inspect": true, "logs": true, "stats": true,
	"version": true, "info": true, "top": true, "port": true,
}

var dockerComposeProbe = map[string]bool{
	"ps": true, "logs": true, "config": true, "images": true, "ls": true, "version": true,
}

var systemctlProbe = map[string]bool{
	"status": true, "is-active": true, "is-enabled": true, "is-failed": true,
	"show": true, "cat": true, "list-units": true, "list-unit-files": true,
	"show-environment": true,
}

var pipProbeVerbs = map[string]bool{
	"show": true, "list": true, "freeze": true, "index": true, "help": true, "--version": true, "-V": true,
}

var gitProbeVerbs = map[string]bool{
	"status": true, "log": true, "diff": true, "show": true, "branch": true,
	"rev-parse": true, "remote": true, "describe": true, "ls-files": true,
}

// validateExecArgv 无头只允许只读短探针（白名单 + 动词），写操作/长任务走 shell_run。
func validateExecArgv(argv []string) error {
	if len(argv) == 0 {
		return errno.New(errno.CodeInvalidArg, "请填写 command", "")
	}
	bin := execBinName(argv[0])
	if hint, ok := execBannedBins[bin]; ok {
		return errno.New(errno.CodeInvalidArg, fmt.Sprintf("%s：%s", bin, hint), strings.Join(argv, " "))
	}
	if strings.HasPrefix(bin, "mkfs.") {
		return errno.New(errno.CodeInvalidArg, "mkfs："+execOpenInstead, bin)
	}
	if isPythonBin(bin) {
		return validatePythonProbe(argv)
	}
	if bin == "pip" || bin == "pip3" {
		return validatePipProbe(argv, 1)
	}
	if bin == "git" {
		return validateGitProbe(argv)
	}
	if bin == "docker" {
		return validateDockerArgv(argv)
	}
	if bin == "systemctl" {
		return validateSystemctlArgv(argv)
	}
	if execProbeBins[bin] {
		return nil
	}
	return errno.New(errno.CodeInvalidArg,
		bin+" 不是只读短探针，"+execOpenInstead+execReadFileHint(bin),
		strings.Join(argv, " "))
}

func execReadFileHint(bin string) string {
	switch bin {
	case "sed", "awk", "perl", "ruby", "less", "more", "vi", "vim", "nano":
		return " 读磁盘文件请用 cat / head / tail（无头允许）。"
	default:
		return ""
	}
}

func isPythonBin(bin string) bool {
	return bin == "python" || strings.HasPrefix(bin, "python3")
}

func validatePythonProbe(argv []string) error {
	if len(argv) == 1 {
		return errno.New(errno.CodeInvalidArg, "python 无头仅允许 --version / -c print… / -m pip show。跑脚本"+execOpenInstead, strings.Join(argv, " "))
	}
	for i := 1; i < len(argv); i++ {
		a := argv[i]
		switch a {
		case "-V", "--version":
			return nil
		case "-c":
			if i+1 >= len(argv) {
				return errno.New(errno.CodeInvalidArg, "python -c 缺少代码", strings.Join(argv, " "))
			}
			if pythonCLooksLikeWrite(argv[i+1]) {
				return errno.New(errno.CodeInvalidArg, "python -c 含写入/子进程，"+execOpenInstead, argv[i+1])
			}
			return nil
		case "-m":
			if i+1 >= len(argv) {
				return errno.New(errno.CodeInvalidArg, "python -m 缺少模块", strings.Join(argv, " "))
			}
			mod := strings.ToLower(argv[i+1])
			if mod == "pip" {
				return validatePipProbe(argv, i+2)
			}
			return errno.New(errno.CodeInvalidArg, "python -m "+argv[i+1]+" "+execOpenInstead+"（无头仅 python -m pip show/list/freeze）", strings.Join(argv, " "))
		}
	}
	return errno.New(errno.CodeInvalidArg, "python 跑脚本或无 -c "+execOpenInstead, strings.Join(argv, " "))
}

func pythonCLooksLikeWrite(code string) bool {
	lower := strings.ToLower(code)
	needles := []string{
		"open(", "write(", "writelines", "unlink", "remove(", "rmtree",
		"shutil", "subprocess", "os.system", "path.write", "mkdir",
		"makedirs", "torch.save", "to_csv", "savefig", "dump(",
	}
	for _, n := range needles {
		if strings.Contains(lower, n) {
			return true
		}
	}
	return false
}

func validatePipProbe(argv []string, start int) error {
	verb, _ := firstNonFlag(argv, start)
	if verb == "" {
		return errno.New(errno.CodeInvalidArg, "pip 无头仅 show/list/freeze；install "+execOpenInstead, strings.Join(argv, " "))
	}
	if pipProbeVerbs[verb] {
		return nil
	}
	return errno.New(errno.CodeInvalidArg, "pip "+verb+" "+execOpenInstead+"（无头仅 pip show/list/freeze）", strings.Join(argv, " "))
}

func validateGitProbe(argv []string) error {
	verb, _ := firstNonFlag(argv, 1)
	verb = strings.ToLower(verb)
	if verb == "" || gitProbeVerbs[verb] {
		if verb == "" {
			return errno.New(errno.CodeInvalidArg, "git 无头请带 status/log/diff；commit/push "+execOpenInstead, strings.Join(argv, " "))
		}
		return nil
	}
	return errno.New(errno.CodeInvalidArg, "git "+verb+" "+execOpenInstead+"（无头仅 status/log/diff/show）", strings.Join(argv, " "))
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
		return errno.New(errno.CodeInvalidArg, "docker 无头请带 ps/images/inspect/logs；启停请用专用工具或 "+execOpenInstead, strings.Join(argv, " "))
	}
	if verb == "compose" {
		sub, _ := firstNonFlag(argv, idx+1)
		sub = strings.ToLower(sub)
		if dockerComposeProbe[sub] {
			return nil
		}
		return errno.New(errno.CodeInvalidArg,
			"docker compose "+sub+" 会改状态；启停/删除用 start/stop/remove_container，其它 "+execOpenInstead,
			strings.Join(argv, " "))
	}
	if dockerProbeVerbs[verb] {
		return nil
	}
	return errno.New(errno.CodeInvalidArg,
		"docker "+verb+" 不是只读探针；启停/删除用专用工具，其它 "+execOpenInstead,
		strings.Join(argv, " "))
}

func validateSystemctlArgv(argv []string) error {
	action, _ := firstNonFlag(argv, 1)
	action = strings.ToLower(action)
	if action == "" {
		return errno.New(errno.CodeInvalidArg, "systemctl 无头仅 status / is-active；启停 "+execOpenInstead, strings.Join(argv, " "))
	}
	if systemctlProbe[action] {
		return nil
	}
	return errno.New(errno.CodeInvalidArg,
		"systemctl "+action+" "+execOpenInstead+"（无头仅 status / is-active）",
		strings.Join(argv, " "))
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
