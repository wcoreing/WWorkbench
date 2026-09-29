package logs

import (
	"context"
	"fmt"
	"os"
	"strings"
	"time"

	dockersvc "WWorkbench/internal/docker"
	"WWorkbench/internal/errno"
	"WWorkbench/internal/model"
	"WWorkbench/internal/terminal"
	"WWorkbench/internal/tunnel"

	"golang.org/x/crypto/ssh"
)

const maxLocalReadBytes = 2 << 20

// Fetch 按日志源配置拉取一段日志。
// count 为行数；skipFromEnd 为距文件/流末尾再往前跳过的行数（0=最新一段）。
func Fetch(
	ctx context.Context,
	src model.LogSourceDO,
	hosts *terminal.HostService,
	docker *dockersvc.Manager,
	countOverride int,
	skipFromEnd int,
) (string, error) {
	count := src.TailLines
	if countOverride > 0 {
		count = countOverride
	}
	if count <= 0 {
		count = 200
	}
	if skipFromEnd < 0 {
		skipFromEnd = 0
	}

	switch src.SourceType {
	case model.LogSourceLocalFile:
		return tailLocalFile(strings.TrimSpace(src.Path), count, skipFromEnd)
	case model.LogSourceSSHFile:
		return tailSSHFile(ctx, hosts, src.SSHHostID, strings.TrimSpace(src.Path), count, skipFromEnd)
	case model.LogSourceDocker:
		return dockerLogWindow(ctx, docker, src.DockerContextID, src.ContainerID, count, skipFromEnd)
	case model.LogSourceCompose:
		return composeLogWindow(ctx, docker, src.DockerContextID, strings.TrimSpace(src.ComposeDir), src.ComposeService, count, skipFromEnd)
	default:
		return "", errno.New(errno.CodeInvalidArg, "未知日志源类型", src.SourceType)
	}
}

func dockerLogWindow(ctx context.Context, docker *dockersvc.Manager, contextID, containerID string, count, skip int) (string, error) {
	raw, err := docker.GetContainerLogs(ctx, contextID, containerID, count+skip)
	if err != nil {
		return "", err
	}
	return takeLineWindow(raw, count, skip), nil
}

func composeLogWindow(ctx context.Context, docker *dockersvc.Manager, contextID, projectDir, service string, count, skip int) (string, error) {
	raw, err := docker.GetComposeLogs(ctx, contextID, projectDir, service, count+skip)
	if err != nil {
		return "", err
	}
	return takeLineWindow(raw, count, skip), nil
}

// tailLocalFile 读取本机文件一段行窗口。
func tailLocalFile(path string, count, skipFromEnd int) (string, error) {
	if path == "" {
		return "", errno.New(errno.CodeInvalidArg, "请填写日志文件路径", "")
	}
	info, err := os.Stat(path)
	if err != nil {
		return "", errno.Wrap(errno.CodeInvalidArg, "日志文件不存在", err)
	}
	if info.IsDir() {
		return "", errno.New(errno.CodeInvalidArg, "路径是目录而非文件", path)
	}
	f, err := os.Open(path)
	if err != nil {
		return "", errno.Wrap(errno.CodeConnFailed, "打开日志文件失败", err)
	}
	defer f.Close()

	size := info.Size()
	readSize := size
	if readSize > maxLocalReadBytes {
		readSize = maxLocalReadBytes
		_, err = f.Seek(size-readSize, 0)
		if err != nil {
			return "", errno.Wrap(errno.CodeConnFailed, "读取日志文件失败", err)
		}
	}
	buf := make([]byte, readSize)
	n, err := f.Read(buf)
	if err != nil && n == 0 {
		return "", errno.Wrap(errno.CodeConnFailed, "读取日志文件失败", err)
	}
	text := string(buf[:n])
	if readSize < size {
		if i := strings.Index(text, "\n"); i >= 0 {
			text = text[i+1:]
		}
	}
	return takeLineWindow(text, count, skipFromEnd), nil
}

// takeLineWindow 取距文本末尾 skip 行之前的 count 行。
func takeLineWindow(text string, count, skipFromEnd int) string {
	if count <= 0 {
		return strings.TrimRight(text, "\n")
	}
	if skipFromEnd < 0 {
		skipFromEnd = 0
	}
	parts := strings.Split(strings.TrimRight(text, "\n"), "\n")
	if len(parts) == 1 && parts[0] == "" {
		return ""
	}
	end := len(parts) - skipFromEnd
	if end <= 0 {
		return ""
	}
	start := end - count
	if start < 0 {
		start = 0
	}
	return strings.Join(parts[start:end], "\n")
}

// DiffAppend 相对上次快照计算新增文本（兼容 tail 滑动窗口）。
func DiffAppend(prev, full string) (chunk string, reset bool) {
	if prev == "" {
		return full, len(full) > 0
	}
	if full == prev {
		return "", false
	}
	if strings.HasPrefix(full, prev) {
		return full[len(prev):], false
	}
	prevLines := splitLogLines(prev)
	fullLines := splitLogLines(full)
	if len(prevLines) == 0 {
		return full, len(full) > 0
	}
	maxK := len(prevLines)
	if len(fullLines) < maxK {
		maxK = len(fullLines)
	}
	for k := maxK; k > 0; k-- {
		if linesEqual(prevLines[len(prevLines)-k:], fullLines[:k]) {
			if k == len(fullLines) {
				return "", false
			}
			added := strings.Join(fullLines[k:], "\n")
			if added == "" {
				return "", false
			}
			return "\n" + added, false
		}
	}
	return full, true
}

func splitLogLines(text string) []string {
	if text == "" {
		return nil
	}
	return strings.Split(strings.TrimRight(text, "\n"), "\n")
}

func linesEqual(a, b []string) bool {
	if len(a) != len(b) {
		return false
	}
	for i := range a {
		if a[i] != b[i] {
			return false
		}
	}
	return true
}

// tailSSHFile 经 SSH 在远端执行 tail/head 读取日志窗口。
func tailSSHFile(ctx context.Context, hosts *terminal.HostService, hostID, path string, count, skipFromEnd int) (string, error) {
	if hostID == "" {
		return "", errno.New(errno.CodeInvalidArg, "请选择 SSH 主机", "")
	}
	if path == "" {
		return "", errno.New(errno.CodeInvalidArg, "请填写远端日志路径", "")
	}
	h, err := hosts.Get(hostID)
	if err != nil {
		return "", err
	}
	client, err := tunnel.DialSSH(ctx, terminal.HostToSpec(*h))
	if err != nil {
		return "", err
	}
	defer client.Close()

	sess, err := client.NewSession()
	if err != nil {
		return "", errno.Wrap(errno.CodeConnFailed, "创建 SSH 会话失败", err)
	}
	defer sess.Close()

	quoted := shellQuote(path)
	var cmd string
	if skipFromEnd <= 0 {
		cmd = fmt.Sprintf("tail -n %d -- %s 2>&1", count, quoted)
	} else {
		cmd = fmt.Sprintf("tail -n %d -- %s 2>&1 | head -n %d", count+skipFromEnd, quoted, count)
	}
	runCtx, cancel := context.WithTimeout(ctx, 30*time.Second)
	defer cancel()
	done := make(chan struct {
		out []byte
		err error
	}, 1)
	go func() {
		out, e := sess.CombinedOutput(cmd)
		done <- struct {
			out []byte
			err error
		}{out, e}
	}()
	select {
	case <-runCtx.Done():
		return "", errno.New(errno.CodeConnFailed, "读取远端日志超时", "")
	case r := <-done:
		text := strings.TrimRight(string(r.out), "\n")
		if r.err != nil {
			if text == "" {
				return "", errno.Wrap(errno.CodeConnFailed, "读取远端日志失败", r.err)
			}
			if _, ok := r.err.(*ssh.ExitError); !ok {
				return "", errno.Wrap(errno.CodeConnFailed, "读取远端日志失败", r.err)
			}
		}
		return text, nil
	}
}

// shellQuote 为 shell 单引号转义路径。
func shellQuote(s string) string {
	return "'" + strings.ReplaceAll(s, "'", "'\\''") + "'"
}
