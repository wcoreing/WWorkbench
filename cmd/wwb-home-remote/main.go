package main

import (
	"bytes"
	"fmt"
	"os"
	"path/filepath"
	"strings"

	"golang.org/x/crypto/ssh"

	"WWorkbench/internal/store"
	"WWorkbench/internal/terminal"
	"WWorkbench/internal/tunnel"
)

func main() {
	if len(os.Args) < 3 {
		fmt.Fprintln(os.Stderr, "usage: hostId script")
		os.Exit(2)
	}
	home, _ := os.UserHomeDir()
	st, err := store.New(filepath.Join(home, ".wworkbench"))
	if err != nil {
		panic(err)
	}
	defer st.Close()
	h, err := st.GetSSHHost(os.Args[1])
	if err != nil || h == nil {
		panic(err)
	}
	c, err := tunnel.DialSSH(nil, terminal.HostToSpec(*h))
	if err != nil {
		panic(err)
	}
	defer c.Close()
	s, err := c.NewSession()
	if err != nil {
		panic(err)
	}
	defer s.Close()
	_ = s.RequestPty("xterm", 40, 120, ssh.TerminalModes{})
	var b bytes.Buffer
	s.Stdout = &b
	s.Stderr = &b
	script := "bash -lc " + shellQuote(os.Args[2]+"; echo __EXIT__:$?")
	_ = s.Run(script)
	out := strings.ReplaceAll(b.String(), "\x00", "")
	fmt.Print(out)
	if !strings.Contains(out, "__EXIT__:0") {
		os.Exit(1)
	}
}

func shellQuote(s string) string {
	return "'" + strings.ReplaceAll(s, "'", `'\''`) + "'"
}
