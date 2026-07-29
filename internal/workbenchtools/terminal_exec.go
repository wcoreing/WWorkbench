package workbenchtools

import (
	"context"
	"encoding/json"
	"os/exec"
	"runtime"
	"strings"
	"time"

	"WWorkbench/internal/errno"
	"WWorkbench/internal/model"
	"WWorkbench/internal/terminal"
	"WWorkbench/internal/tunnel"
)

type terminalExecArgs struct {
	LocalShell     bool   `json:"localShell"`
	HostID         string `json:"hostId"`
	HostOrName     string `json:"hostOrName"`
	Command        string `json:"command"`
	TimeoutSeconds int    `json:"timeoutSeconds"`
}

const defaultExecTimeout = 30

// validateExecCommand 校验无头命令（禁止 shell 元字符与高危子串）。
func validateExecCommand(command string) error {
	command = strings.TrimSpace(command)
	if command == "" {
		return errno.New(errno.CodeInvalidArg, "请填写 command", "")
	}
	if strings.ContainsAny(command, ";\n\r|&`$") {
		return errno.New(errno.CodeInvalidArg, "命令不允许包含 ; | & ` $ 或换行", "")
	}
	if strings.Contains(command, ">") || strings.Contains(command, "<") {
		return errno.New(errno.CodeInvalidArg, "命令不允许重定向", "")
	}
	lower := strings.ToLower(command)
	for _, banned := range []string{
		"rm ", "rm\t", "dd ", "mkfs", "shutdown", "reboot", "poweroff",
		"chmod ", "chown ", "kill ", "pkill ", "systemctl ",
		":(){", "wget ", "curl ", "scp ", "sftp ",
	} {
		if strings.Contains(lower, banned) {
			return errno.New(errno.CodeInvalidArg, "该命令不在允许范围内", command)
		}
	}
	return nil
}

// toolTerminalExec 经 SSH 或本机执行只读命令并返回输出（无头，不打开终端 UI）。
func toolTerminalExec(ctx context.Context, d *Deps, raw json.RawMessage) ToolResult {
	var in terminalExecArgs
	if err := json.Unmarshal(raw, &in); err != nil {
		return Fail("参数无效: " + err.Error())
	}
	if err := validateExecCommand(in.Command); err != nil {
		return Fail(err.Error())
	}
	timeout := in.TimeoutSeconds
	if timeout <= 0 || timeout > 120 {
		timeout = defaultExecTimeout
	}
	if in.LocalShell {
		out, err := execLocalCommand(ctx, in.Command, timeout)
		if err != nil {
			return Fail(err.Error())
		}
		return OKData(map[string]interface{}{
			"ok": true, "kind": "local", "command": in.Command, "output": out,
		})
	}
	host, ambiguous, errMsg := resolveSSHHost(d, in.HostID, in.HostOrName)
	if errMsg != "" {
		if len(ambiguous) > 0 {
			parts := make([]string, 0, len(ambiguous))
			for _, h := range ambiguous {
				parts = append(parts, h.Name+" "+h.User+"@"+h.Host)
			}
			return Fail(errMsg + "：" + strings.Join(parts, "；"))
		}
		return Fail(errMsg)
	}
	out, err := execSSHCommand(ctx, d, *host, in.Command, timeout)
	if err != nil {
		return Fail(err.Error())
	}
	return OKData(map[string]interface{}{
		"ok": true, "hostId": host.ID, "host": host.Host, "command": in.Command, "output": out,
	})
}

// execSSHCommand 在远端执行单条命令并返回合并输出。
func execSSHCommand(ctx context.Context, d *Deps, host model.SSHHostDO, command string, timeoutSec int) (string, error) {
	client, err := tunnel.DialSSH(ctx, terminal.HostToSpec(host))
	if err != nil {
		return "", err
	}
	defer client.Close()
	sess, err := client.NewSession()
	if err != nil {
		return "", errno.Wrap(errno.CodeConnFailed, "创建 SSH 会话失败", err)
	}
	defer sess.Close()

	runCtx, cancel := context.WithTimeout(ctx, time.Duration(timeoutSec)*time.Second)
	defer cancel()
	type result struct {
		out []byte
		err error
	}
	done := make(chan result, 1)
	go func() {
		b, e := sess.CombinedOutput(command)
		done <- result{out: b, err: e}
	}()
	select {
	case <-runCtx.Done():
		return "", errno.New(errno.CodeConnFailed, "命令执行超时", command)
	case r := <-done:
		text := strings.TrimSpace(string(r.out))
		if r.err != nil && text == "" {
			return "", errno.Wrap(errno.CodeConnFailed, "命令执行失败", r.err)
		}
		if len(text) > 64*1024 {
			text = text[:64*1024] + "\n…(输出已截断)"
		}
		return text, nil
	}
}

// execLocalCommand 在本机执行单条命令。
func execLocalCommand(ctx context.Context, command string, timeoutSec int) (string, error) {
	runCtx, cancel := context.WithTimeout(ctx, time.Duration(timeoutSec)*time.Second)
	defer cancel()
	var cmd *exec.Cmd
	if runtime.GOOS == "windows" {
		cmd = exec.CommandContext(runCtx, "cmd", "/C", command)
	} else {
		cmd = exec.CommandContext(runCtx, "sh", "-c", command)
	}
	b, err := cmd.CombinedOutput()
	text := strings.TrimSpace(string(b))
	if err != nil && text == "" {
		return "", errno.Wrap(errno.CodeConnFailed, "本机命令执行失败", err)
	}
	if len(text) > 64*1024 {
		text = text[:64*1024] + "\n…(输出已截断)"
	}
	return text, nil
}
