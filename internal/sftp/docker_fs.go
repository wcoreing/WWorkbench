package sftp

import (
	"archive/tar"
	"bytes"
	"context"
	"fmt"
	"io"
	"os"
	"path"
	"path/filepath"
	"strings"
	"sync"
	"time"

	"WWorkbench/internal/docker"
	"WWorkbench/internal/errno"
	"WWorkbench/internal/model"

	"github.com/docker/docker/api/types/container"
	"github.com/docker/docker/client"
	"github.com/docker/docker/pkg/stdcopy"
)

const dockerExecTimeout = 60 * time.Second

type dockerFS struct {
	mu          sync.Mutex
	mgr         *docker.Manager
	handle      *docker.ClientHandle
	contextID   string
	containerID string
	ownsHandle  bool
}

func openDockerFS(ctx context.Context, mgr *docker.Manager, contextID, containerID string) (*dockerFS, error) {
	handle, err := mgr.OpenClient(ctx, contextID)
	if err != nil {
		return nil, err
	}
	inspect, err := handle.API().ContainerInspect(ctx, containerID)
	if err != nil {
		handle.Close()
		return nil, errno.Wrap(errno.CodeConnFailed, "读取容器信息失败", err)
	}
	if inspect.State == nil || !inspect.State.Running {
		handle.Close()
		return nil, errno.New(errno.CodeInvalidArg, "容器未运行", containerID)
	}
	return &dockerFS{
		mgr:         mgr,
		handle:      handle,
		contextID:   contextID,
		containerID: containerID,
		ownsHandle:  true,
	}, nil
}

func (f *dockerFS) Close() {
	f.mu.Lock()
	defer f.mu.Unlock()
	if f.ownsHandle && f.handle != nil {
		f.handle.Close()
		f.handle = nil
	}
}

func (f *dockerFS) api() *client.Client {
	if f.handle == nil {
		return nil
	}
	return f.handle.API()
}

func (f *dockerFS) Home() (string, error) {
	return "/", nil
}

func (f *dockerFS) ListDir(dir string) ([]model.FileEntryDO, error) {
	dir = cleanRemotePath(dir)
	// 一次 shell 列出名称/类型/大小/mtime；避免 CopyFromContainer 整盘 tar
	const script = `dir="$1"
ls -1A "$dir" 2>/dev/null | while IFS= read -r name; do
  [ -z "$name" ] && continue
  if [ "$dir" = "/" ]; then p="/$name"; else p="$dir/$name"; fi
  if [ -d "$p" ]; then kind=d; else kind=f; fi
  sz=$(stat -c '%s' "$p" 2>/dev/null || echo 0)
  mt=$(stat -c '%Y' "$p" 2>/dev/null || echo 0)
  printf '%s\t%s\t%s\t%s\n' "$kind" "$sz" "$mt" "$name"
done`
	out, err := f.execOutput("sh", "-c", script, "list", dir)
	if err != nil {
		// 极简镜像：退化为纯 ls（无大小/时间）
		return f.listDirSimple(dir)
	}
	entries := parseListScriptOutput(dir, out)
	if len(entries) == 0 && strings.TrimSpace(out) == "" {
		// 脚本空结果也可能是成功的空目录；再确认目录存在
		if _, statErr := f.Stat(dir); statErr != nil {
			return f.listDirSimple(dir)
		}
	}
	sortFileEntries(entries)
	return entries, nil
}

func (f *dockerFS) listDirSimple(dir string) ([]model.FileEntryDO, error) {
	out, err := f.execOutput("ls", "-1A", dir)
	if err != nil {
		return nil, errno.Wrap(errno.CodeConnFailed, "读取容器目录失败", err)
	}
	entries := make([]model.FileEntryDO, 0)
	for _, name := range strings.Split(out, "\n") {
		name = strings.TrimRight(name, "\r")
		name = strings.TrimSpace(name)
		if name == "" || name == "." || name == ".." {
			continue
		}
		p := path.Join(dir, name)
		isDir := false
		if st, err := f.Stat(p); err == nil {
			isDir = st.IsDir
		}
		entries = append(entries, model.FileEntryDO{
			Name:  name,
			Path:  p,
			IsDir: isDir,
		})
	}
	sortFileEntries(entries)
	return entries, nil
}

func parseListScriptOutput(dir, out string) []model.FileEntryDO {
	entries := make([]model.FileEntryDO, 0)
	for _, line := range strings.Split(out, "\n") {
		line = strings.TrimRight(line, "\r")
		if line == "" {
			continue
		}
		parts := strings.SplitN(line, "\t", 4)
		if len(parts) < 4 {
			continue
		}
		kind, szStr, mtStr, name := parts[0], parts[1], parts[2], parts[3]
		if name == "" || name == "." || name == ".." {
			continue
		}
		var size, modTime int64
		_, _ = fmt.Sscan(szStr, &size)
		_, _ = fmt.Sscan(mtStr, &modTime)
		entries = append(entries, model.FileEntryDO{
			Name:    name,
			Path:    path.Join(dir, name),
			IsDir:   kind == "d",
			Size:    size,
			ModTime: modTime,
		})
	}
	return entries
}

func (f *dockerFS) Stat(p string) (*remoteStat, error) {
	p = cleanRemotePath(p)
	f.mu.Lock()
	defer f.mu.Unlock()
	cli := f.api()
	if cli == nil {
		return nil, errno.New(errno.CodeSessionClosed, "Docker 会话已关闭", "")
	}
	ctx, cancel := context.WithTimeout(context.Background(), 15*time.Second)
	defer cancel()
	stat, err := cli.ContainerStatPath(ctx, f.containerID, p)
	if err != nil {
		return nil, err
	}
	return &remoteStat{
		Name:    path.Base(p),
		Size:    stat.Size,
		ModTime: stat.Mtime.Unix(),
		IsDir:   stat.Mode.IsDir(),
	}, nil
}

func (f *dockerFS) MkdirAll(dir string) error {
	dir = cleanRemotePath(dir)
	if dir == "/" || dir == "." {
		return nil
	}
	return f.execOK("mkdir", "-p", dir)
}

func (f *dockerFS) Rename(oldPath, newPath string) error {
	return f.execOK("mv", cleanRemotePath(oldPath), cleanRemotePath(newPath))
}

func (f *dockerFS) Remove(p string) error {
	p = cleanRemotePath(p)
	st, err := f.Stat(p)
	if err != nil {
		return errno.Wrap(errno.CodeConnFailed, "读取远程路径失败", err)
	}
	if st.IsDir {
		return f.execOK("rmdir", p)
	}
	return f.execOK("rm", "-f", p)
}

func (f *dockerFS) RemoveAll(remotePath string) error {
	remotePath = cleanRemotePath(remotePath)
	if remotePath == "/" {
		return errno.New(errno.CodeInvalidArg, "不能删除根目录", "")
	}
	return f.execOK("rm", "-rf", remotePath)
}

func (f *dockerFS) Walk(dir string, fn func(path string, isDir bool) error) error {
	entries, err := f.ListDir(dir)
	if err != nil {
		return err
	}
	for _, ent := range entries {
		if ent.IsDir {
			if err := f.Walk(ent.Path, fn); err != nil {
				return err
			}
		}
		if err := fn(ent.Path, ent.IsDir); err != nil {
			return err
		}
	}
	return nil
}

// OpenTransfer 为传输打开独立 Docker 客户端，避免与目录列举的 exec hijack 抢同一连接。
func (f *dockerFS) OpenTransfer() (remoteFS, error) {
	handle, err := f.mgr.OpenClient(context.Background(), f.contextID)
	if err != nil {
		return nil, err
	}
	return &dockerFS{
		mgr:         f.mgr,
		handle:      handle,
		contextID:   f.contextID,
		containerID: f.containerID,
		ownsHandle:  true,
	}, nil
}

func (f *dockerFS) UploadFile(ctx context.Context, localPath, remotePath string, onProgress func(done, total int64)) error {
	remotePath = cleanRemotePath(remotePath)
	src, err := os.Open(localPath)
	if err != nil {
		return errno.Wrap(errno.CodeInvalidArg, "打开本地文件失败", err)
	}
	defer src.Close()
	info, err := src.Stat()
	if err != nil {
		return err
	}
	total := info.Size()
	if onProgress != nil {
		onProgress(0, total)
	}
	parent := path.Dir(remotePath)
	if parent == "" {
		parent = "/"
	}
	if err := f.MkdirAll(parent); err != nil {
		return err
	}
	if err := ctx.Err(); err != nil {
		return errno.Wrap(errno.CodeInvalidArg, "上传已取消", err)
	}

	pr, pw := io.Pipe()
	errCh := make(chan error, 1)
	go func() {
		tw := tar.NewWriter(pw)
		hdr := &tar.Header{
			Typeflag: tar.TypeReg,
			Name:     path.Base(remotePath),
			Mode:     0o644,
			Size:     total,
			ModTime:  info.ModTime(),
		}
		var writeErr error
		if writeErr = tw.WriteHeader(hdr); writeErr == nil {
			buf := make([]byte, 32*1024)
			var written int64
			for writeErr == nil {
				if err := ctx.Err(); err != nil {
					writeErr = err
					break
				}
				nr, er := src.Read(buf)
				if nr > 0 {
					nw, ew := tw.Write(buf[:nr])
					written += int64(nw)
					if onProgress != nil {
						onProgress(written, total)
					}
					if ew != nil {
						writeErr = ew
						break
					}
					if nr != nw {
						writeErr = io.ErrShortWrite
						break
					}
				}
				if er != nil {
					if er != io.EOF {
						writeErr = er
					}
					break
				}
			}
		}
		if writeErr == nil {
			writeErr = tw.Close()
		} else {
			_ = tw.Close()
		}
		_ = pw.CloseWithError(writeErr)
		errCh <- writeErr
	}()

	f.mu.Lock()
	cli := f.api()
	if cli == nil {
		f.mu.Unlock()
		_ = pr.Close()
		<-errCh
		return errno.New(errno.CodeSessionClosed, "Docker 会话已关闭", "")
	}
	copyCtx, copyCancel := context.WithTimeout(context.Background(), 10*time.Minute)
	// 传输 client 独占使用：Copy 期间不持锁，避免与本 fs 其它短操作互相堵死
	f.mu.Unlock()
	err = cli.CopyToContainer(copyCtx, f.containerID, parent, pr, container.CopyToContainerOptions{})
	copyCancel()
	pipeErr := <-errCh

	if err != nil {
		if ctx.Err() != nil {
			return errno.Wrap(errno.CodeInvalidArg, "上传已取消", ctx.Err())
		}
		msg := err.Error()
		if strings.Contains(strings.ToLower(msg), "read-only") || strings.Contains(msg, "read only") {
			return errno.New(errno.CodeConnFailed, "目标目录只读，无法上传（可改传到 /tmp）", parent)
		}
		return errno.Wrap(errno.CodeConnFailed, "上传到容器失败", err)
	}
	if pipeErr != nil && pipeErr != io.EOF {
		if ctx.Err() != nil {
			return errno.Wrap(errno.CodeInvalidArg, "上传已取消", ctx.Err())
		}
		return errno.Wrap(errno.CodeConnFailed, "构造上传归档失败", pipeErr)
	}
	if onProgress != nil {
		onProgress(total, total)
	}
	return nil
}

func (f *dockerFS) DownloadFile(ctx context.Context, remotePath, localPath string, onProgress func(done, total int64)) error {
	remotePath = cleanRemotePath(remotePath)
	st, err := f.Stat(remotePath)
	if err != nil {
		return errno.Wrap(errno.CodeConnFailed, "打开远程文件失败", err)
	}
	total := st.Size
	if onProgress != nil {
		onProgress(0, total)
	}

	f.mu.Lock()
	cli := f.api()
	if cli == nil {
		f.mu.Unlock()
		return errno.New(errno.CodeSessionClosed, "Docker 会话已关闭", "")
	}
	copyCtx, copyCancel := context.WithTimeout(context.Background(), 10*time.Minute)
	reader, _, err := cli.CopyFromContainer(copyCtx, f.containerID, remotePath)
	if err != nil {
		copyCancel()
		f.mu.Unlock()
		return errno.Wrap(errno.CodeConnFailed, "从容器下载失败", err)
	}
	// 读流占用连接，持锁直到读完，避免同 client 并发 hijack
	defer func() {
		_ = reader.Close()
		copyCancel()
		f.mu.Unlock()
	}()

	tr := tar.NewReader(reader)
	hdr, err := tr.Next()
	if err != nil {
		return errno.Wrap(errno.CodeConnFailed, "解析容器文件失败", err)
	}
	if hdr.Typeflag == tar.TypeDir {
		return errno.New(errno.CodeInvalidArg, "远程路径是目录", remotePath)
	}
	if err := os.MkdirAll(filepath.Dir(localPath), 0o755); err != nil {
		return errno.Wrap(errno.CodeStoreFailed, "创建本地目录失败", err)
	}
	dst, err := os.Create(localPath)
	if err != nil {
		return errno.Wrap(errno.CodeStoreFailed, "创建本地文件失败", err)
	}
	defer dst.Close()
	_, err = copyWithProgress(ctx, dst, tr, func(n int64) {
		if onProgress != nil {
			onProgress(n, total)
		}
	})
	if err != nil {
		if ctx.Err() != nil {
			return errno.Wrap(errno.CodeInvalidArg, "下载已取消", ctx.Err())
		}
		return errno.Wrap(errno.CodeConnFailed, "下载文件失败", err)
	}
	if onProgress != nil {
		onProgress(total, total)
	}
	return nil
}

func (f *dockerFS) execOK(cmd ...string) error {
	_, err := f.execOutput(cmd...)
	return err
}

// execOutput 在容器内执行命令并返回 stdout（持锁；整体超时后关闭 hijack）。
func (f *dockerFS) execOutput(cmd ...string) (string, error) {
	f.mu.Lock()
	defer f.mu.Unlock()
	cli := f.api()
	if cli == nil {
		return "", errno.New(errno.CodeSessionClosed, "Docker 会话已关闭", "")
	}
	ctx, cancel := context.WithTimeout(context.Background(), dockerExecTimeout)
	defer cancel()
	create, err := cli.ContainerExecCreate(ctx, f.containerID, container.ExecOptions{
		AttachStdout: true,
		AttachStderr: true,
		Cmd:          cmd,
	})
	if err != nil {
		return "", errno.Wrap(errno.CodeConnFailed, "创建容器命令失败", err)
	}
	// attach 用 Background，避免 timeout cancel 弄脏连接；用关闭 hijack 实现超时
	hj, err := cli.ContainerExecAttach(context.Background(), create.ID, container.ExecAttachOptions{})
	if err != nil {
		return "", errno.Wrap(errno.CodeConnFailed, "执行容器命令失败", err)
	}
	var stdout, stderr bytes.Buffer
	done := make(chan error, 1)
	go func() {
		_, copyErr := stdcopy.StdCopy(&stdout, &stderr, hj.Reader)
		done <- copyErr
	}()
	select {
	case <-done:
		_ = hj.CloseWrite()
		hj.Close()
	case <-ctx.Done():
		hj.Close()
		<-done
		return "", errno.New(errno.CodeConnFailed, "容器命令超时", strings.Join(cmd, " "))
	}
	inspect, err := cli.ContainerExecInspect(context.Background(), create.ID)
	if err != nil {
		return "", errno.Wrap(errno.CodeConnFailed, "检查容器命令失败", err)
	}
	if inspect.ExitCode != 0 {
		msg := strings.TrimSpace(stderr.String())
		if msg == "" {
			msg = strings.Join(cmd, " ")
		}
		return "", errno.New(errno.CodeConnFailed, "容器命令执行失败", msg)
	}
	return stdout.String(), nil
}
