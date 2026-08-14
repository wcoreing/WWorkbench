package terminal

import (
	"io"

	"WWorkbench/internal/docker"

	gopty "github.com/aymanbagabas/go-pty"
	"golang.org/x/crypto/ssh"
)

type sessionKind string

const (
	kindSSH    sessionKind = "ssh"
	kindLocal  sessionKind = "local"
	kindDocker sessionKind = "docker"
)

// Session 交互式终端会话（本机、SSH 或 Docker）。
type Session struct {
	ID         string
	Kind       sessionKind
	HostID     string
	Title      string
	stdin      io.Writer
	client     *ssh.Client
	sshSess    *ssh.Session
	localCmd   *gopty.Cmd
	localPty   gopty.Pty
	dockerExec *docker.ExecSession
	dockerMgr  *docker.Manager
}

// cleanup 释放会话资源。
func (s *Session) cleanup() {
	if s.sshSess != nil {
		_ = s.sshSess.Close()
	}
	if s.client != nil {
		_ = s.client.Close()
	}
	if s.localCmd != nil && s.localCmd.Process != nil {
		_ = s.localCmd.Process.Kill()
	}
	if s.localPty != nil {
		_ = s.localPty.Close()
		s.localPty = nil
	}
	if s.dockerExec != nil {
		s.dockerExec.Close()
		s.dockerExec = nil
	}
}
