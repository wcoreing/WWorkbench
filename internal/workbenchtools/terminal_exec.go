package workbenchtools

import (
	"context"
	"encoding/json"
	"os/exec"
	"path/filepath"
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

// toolTerminalExec 按 argv 起单进程并返回输出（无头；远端将参数单引号后再交给 sshd）。
func toolTerminalExec(ctx context.Context, d *Deps, raw json.RawMessage) ToolResult {
	var in terminalExecArgs
	if err := json.Unmarshal(raw, &in); err != nil {
		return Fail("参数无效: " + err.Error())
	}
	argv, err := parseAndValidateExec(in.Command)
	if err != nil {
		return Fail(err.Error())
	}
	timeout := in.TimeoutSeconds
	if timeout <= 0 || timeout > 120 {
		timeout = defaultExecTimeout
	}
	if in.LocalShell {
		out, err := execLocalArgv(ctx, argv, timeout)
		if err != nil {
			return Fail(err.Error())
		}
		return OKData(map[string]interface{}{
			"ok": true, "kind": "local", "argv": argv, "command": in.Command, "output": out,
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
	out, err := execSSHArgv(ctx, d, *host, argv, timeout)
	if err != nil {
		return Fail(err.Error())
	}
	return OKData(map[string]interface{}{
		"ok": true, "hostId": host.ID, "host": host.Host, "argv": argv, "command": in.Command, "output": out,
	})
}

// execSSHArgv 在远端按 argv 执行（POSIX 单引号，避免 sshd 的 shell -c 再拆语句）。
func execSSHArgv(ctx context.Context, d *Deps, host model.SSHHostDO, argv []string, timeoutSec int) (string, error) {
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
	cmdline := posixQuoteArgv(argv)
	done := make(chan result, 1)
	go func() {
		b, e := sess.CombinedOutput(cmdline)
		done <- result{out: b, err: e}
	}()
	select {
	case <-runCtx.Done():
		return "", errno.New(errno.CodeConnFailed, "命令执行超时", cmdline)
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

// execLocalArgv 在本机按 argv 执行（不经 sh -c）。
func execLocalArgv(ctx context.Context, argv []string, timeoutSec int) (string, error) {
	runCtx, cancel := context.WithTimeout(ctx, time.Duration(timeoutSec)*time.Second)
	defer cancel()
	bin := argv[0]
	if !strings.ContainsAny(bin, `/\`) && !filepath.IsAbs(bin) {
		p, err := exec.LookPath(bin)
		if err != nil {
			return "", errno.Wrap(errno.CodeInvalidArg, "找不到可执行文件 "+bin, err)
		}
		bin = p
	}
	cmd := exec.CommandContext(runCtx, bin, argv[1:]...)
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
