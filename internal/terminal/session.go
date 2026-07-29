package terminal

import (
	"io"
	"os"
	"os/exec"

	"WWorkbench/internal/docker"

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
	localCmd   *exec.Cmd
	localPTY   *os.File
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
	if s.localPTY != nil {
		_ = s.localPTY.Close()
	}
	if s.dockerExec != nil {
		s.dockerExec.Close()
		s.dockerExec = nil
	}
}
