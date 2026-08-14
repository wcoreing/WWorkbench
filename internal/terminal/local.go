package terminal

import (
	"os"
	"os/user"
	"runtime"

	"WWorkbench/internal/environment"
	"WWorkbench/internal/errno"
	"WWorkbench/internal/model"

	gopty "github.com/aymanbagabas/go-pty"
	"github.com/google/uuid"
)

// OpenLocal 打开本机 Shell 终端。
func (m *Manager) OpenLocal(cols, rows int) (*model.TerminalSessionInfoDO, error) {
	if cols <= 0 {
		cols = 80
	}
	if rows <= 0 {
		rows = 24
	}

	ptmx, err := gopty.New()
	if err != nil {
		return nil, errno.Wrap(errno.CodeConnFailed, "启动本机 Shell 失败", err)
	}
	if err := ptmx.Resize(cols, rows); err != nil {
		_ = ptmx.Close()
		return nil, errno.Wrap(errno.CodeConnFailed, "设置终端尺寸失败", err)
	}

	shell := defaultShell()
	var cmd *gopty.Cmd
	if runtime.GOOS != "windows" {
		cmd = ptmx.Command(shell, "-lc", environment.LocalTerminalInitScript(shell))
	} else {
		cmd = ptmx.Command(shell)
	}
	cmd.Env = append(os.Environ(), "TERM=xterm-256color", "COLORTERM=truecolor")
	if home, err := os.UserHomeDir(); err == nil && home != "" {
		cmd.Dir = home
	}
	if err := cmd.Start(); err != nil {
		_ = ptmx.Close()
		return nil, errno.Wrap(errno.CodeConnFailed, "启动本机 Shell 失败", err)
	}

	sid := uuid.NewString()
	ts := &Session{
		ID:       sid,
		Kind:     kindLocal,
		Title:    localTitle(),
		stdin:    ptmx,
		localCmd: cmd,
		localPty: ptmx,
	}
	m.registerSession(ts, ptmx, func() { m.finish(sid) })

	return &model.TerminalSessionInfoDO{
		SessionID: sid,
		Kind:      string(kindLocal),
		Title:     ts.Title,
	}, nil
}

// defaultShell 返回当前用户默认 Shell。
func defaultShell() string {
	if sh := os.Getenv("SHELL"); sh != "" {
		return sh
	}
	if runtime.GOOS == "windows" {
		if com := os.Getenv("COMSPEC"); com != "" {
			return com
		}
		return "cmd.exe"
	}
	return "/bin/zsh"
}

// localTitle 生成本机终端标题。
func localTitle() string {
	name := "本机"
	if u, err := user.Current(); err == nil && u.Username != "" {
		name = u.Username
	}
	if host, err := os.Hostname(); err == nil && host != "" {
		return name + "@" + host
	}
	return name + " · Shell"
}
