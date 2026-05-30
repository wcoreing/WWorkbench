package logs

import (
	"context"
	"fmt"
	"os"
	"strings"
	"time"

	dockersvc "WNavicat/internal/docker"
	"WNavicat/internal/errno"
	"WNavicat/internal/model"
	"WNavicat/internal/terminal"
	"WNavicat/internal/tunnel"

	"golang.org/x/crypto/ssh"
)

const maxLocalReadBytes = 2 << 20

// Fetch 按日志源配置拉取尾部日志。
func Fetch(
	ctx context.Context,
	src model.LogSourceDO,
	hosts *terminal.HostService,
	docker *dockersvc.Manager,
	tailOverride int,
) (string, error) {
	tail := src.TailLines
	if tailOverride > 0 {
		tail = tailOverride
	}
	if tail <= 0 {
		tail = 200
	}

	switch src.SourceType {
	case model.LogSourceLocalFile:
		return tailLocalFile(strings.TrimSpace(src.Path), tail)
	case model.LogSourceSSHFile:
		return tailSSHFile(ctx, hosts, src.SSHHostID, strings.TrimSpace(src.Path), tail)
	case model.LogSourceDocker:
		return docker.GetContainerLogs(ctx, src.DockerContextID, src.ContainerID, tail)
	case model.LogSourceCompose:
		return docker.GetComposeLogs(ctx, src.DockerContextID, strings.TrimSpace(src.ComposeDir), src.ComposeService, tail)
	default:
		return "", errno.New(errno.CodeInvalidArg, "未知日志源类型", src.SourceType)
	}
}

// tailLocalFile 读取本机文件尾部若干行。
func tailLocalFile(path string, lines int) (string, error) {
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
	return takeLastLines(text, lines), nil
}

// takeLastLines 取文本最后 n 行。
func takeLastLines(text string, n int) string {
	if n <= 0 {
		return text
	}
	parts := strings.Split(text, "\n")
	if len(parts) <= n {
		return strings.TrimRight(text, "\n")
	}
	return strings.Join(parts[len(parts)-n:], "\n")
}

// tailSSHFile 经 SSH 在远端执行 tail 读取日志。
func tailSSHFile(ctx context.Context, hosts *terminal.HostService, hostID, path string, lines int) (string, error) {
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

	cmd := fmt.Sprintf("tail -n %d -- %s 2>&1", lines, shellQuote(path))
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
		text := strings.TrimSpace(string(r.out))
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
