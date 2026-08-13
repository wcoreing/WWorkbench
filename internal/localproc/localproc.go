package localproc

import (
	"bufio"
	"bytes"
	"fmt"
	"os"
	"os/exec"
	"sort"
	"strconv"
	"strings"
	"syscall"
	"time"

	"WWorkbench/internal/errno"
	"WWorkbench/internal/model"
)

const (
	termWait   = 2 * time.Second
	maxListen  = 80
	commonHint = "常用开发端口：3000 / 5173 / 8080 / 8000 / 5432 / 3306 / 6379"
)

// ListByPort 列出占用指定 TCP 端口（LISTEN）的本机进程。
func ListByPort(port int) ([]model.LocalPortProcessDO, error) {
	if err := validatePort(port); err != nil {
		return nil, err
	}
	return listListen(fmt.Sprintf("-iTCP:%d", port))
}

// ListListening 列出本机 TCP LISTEN 端口（去重，上限 maxListen）。
func ListListening() ([]model.LocalPortProcessDO, error) {
	list, err := listListen("-iTCP")
	if err != nil {
		return nil, err
	}
	sort.Slice(list, func(i, j int) bool {
		if list[i].Port != list[j].Port {
			return list[i].Port < list[j].Port
		}
		return list[i].PID < list[j].PID
	})
	if len(list) > maxListen {
		list = list[:maxListen]
	}
	return list, nil
}

// KillByPort 结束占用端口的进程：先 SIGTERM，仍存活且 force 时再 SIGKILL。
func KillByPort(port int, force bool) (*model.LocalPortKillResultDO, error) {
	procs, err := ListByPort(port)
	if err != nil {
		return nil, err
	}
	if len(procs) == 0 {
		return nil, errno.New(errno.CodeNotFound, fmt.Sprintf("端口 %d 无监听进程", port), commonHint)
	}

	killed := make([]model.LocalPortProcessDO, 0, len(procs))
	var lastErr error
	for _, p := range procs {
		if err := validateKillTarget(p); err != nil {
			lastErr = err
			continue
		}
		if err := terminate(p.PID, force); err != nil {
			lastErr = err
			continue
		}
		killed = append(killed, p)
	}
	if len(killed) == 0 {
		if lastErr != nil {
			return nil, lastErr
		}
		return nil, errno.New(errno.CodeInvalidArg, "没有可结束的进程", "")
	}
	return &model.LocalPortKillResultDO{
		Port:   port,
		Force:  force,
		Killed: killed,
	}, nil
}

func validatePort(port int) error {
	if port <= 0 || port > 65535 {
		return errno.New(errno.CodeInvalidArg, "请填写有效端口（1–65535）", strconv.Itoa(port))
	}
	return nil
}

func validateKillTarget(p model.LocalPortProcessDO) error {
	if p.PID <= 1 {
		return errno.New(errno.CodeInvalidArg, "拒绝结束系统关键进程", fmt.Sprintf("pid=%d", p.PID))
	}
	if p.PID == os.Getpid() {
		return errno.New(errno.CodeInvalidArg, "不能结束当前应用自身", fmt.Sprintf("pid=%d", p.PID))
	}
	name := strings.ToLower(p.Name)
	if name == "launchd" || name == "kernel_task" || name == "windowserver" {
		return errno.New(errno.CodeInvalidArg, "拒绝结束系统进程", p.Name)
	}
	return nil
}

func terminate(pid int, force bool) error {
	proc, err := os.FindProcess(pid)
	if err != nil {
		return errno.Wrap(errno.CodeNotFound, "进程不存在", err)
	}
	if err := proc.Signal(syscall.SIGTERM); err != nil {
		if force {
			if err2 := proc.Signal(syscall.SIGKILL); err2 != nil {
				return errno.Wrap(errno.CodeInvalidArg, "强制结束进程失败", err2)
			}
			return nil
		}
		return errno.Wrap(errno.CodeInvalidArg, "结束进程失败", err)
	}
	deadline := time.Now().Add(termWait)
	for time.Now().Before(deadline) {
		if !alive(pid) {
			return nil
		}
		time.Sleep(100 * time.Millisecond)
	}
	if !force {
		return errno.New(errno.CodeInvalidArg, "进程未响应 SIGTERM，可勾选强制结束后再试", fmt.Sprintf("pid=%d", pid))
	}
	if err := proc.Signal(syscall.SIGKILL); err != nil {
		return errno.Wrap(errno.CodeInvalidArg, "强制结束进程失败", err)
	}
	return nil
}

func alive(pid int) bool {
	proc, err := os.FindProcess(pid)
	if err != nil {
		return false
	}
	return proc.Signal(syscall.Signal(0)) == nil
}

// listListen 用 lsof -F 解析 LISTEN 进程；filter 如 -iTCP:5173 或 -iTCP。
func listListen(filter string) ([]model.LocalPortProcessDO, error) {
	args := []string{"-nP", "-sTCP:LISTEN", "-Fpcun"}
	args = append(args, filter)
	out, err := exec.Command("lsof", args...).CombinedOutput()
	if err != nil {
		// lsof 无匹配时 exit 1 且无输出
		if len(bytes.TrimSpace(out)) == 0 {
			return []model.LocalPortProcessDO{}, nil
		}
		return nil, errno.Wrap(errno.CodeInvalidArg, "查询端口占用失败", fmt.Errorf("%w: %s", err, strings.TrimSpace(string(out))))
	}
	return parseLsofF(out)
}

func parseLsofF(raw []byte) ([]model.LocalPortProcessDO, error) {
	var (
		list []model.LocalPortProcessDO
		cur  *model.LocalPortProcessDO
		seen = map[string]struct{}{}
	)
	add := func(p model.LocalPortProcessDO) {
		if p.PID <= 0 || p.Port <= 0 {
			return
		}
		key := fmt.Sprintf("%d:%d:%s", p.PID, p.Port, p.Address)
		if _, ok := seen[key]; ok {
			return
		}
		seen[key] = struct{}{}
		if p.Command == "" {
			p.Command = commandLine(p.PID)
		}
		if p.Name == "" {
			p.Name = baseName(p.Command)
		}
		list = append(list, p)
	}

	sc := bufio.NewScanner(bytes.NewReader(raw))
	for sc.Scan() {
		line := sc.Text()
		if line == "" {
			continue
		}
		tag, val := line[0], line[1:]
		switch tag {
		case 'p':
			pid, _ := strconv.Atoi(val)
			cur = &model.LocalPortProcessDO{PID: pid}
		case 'c':
			if cur != nil {
				cur.Name = val
			}
		case 'u':
			if cur != nil {
				cur.User = val
			}
		case 'n':
			if cur == nil {
				continue
			}
			addr, port := parseListenAddr(val)
			item := *cur
			item.Address = addr
			item.Port = port
			add(item)
		}
	}
	return list, sc.Err()
}

func parseListenAddr(name string) (addr string, port int) {
	// 例: 127.0.0.1:5173 或 *:8080 或 [::1]:5174
	name = strings.TrimSpace(name)
	if name == "" {
		return "", 0
	}
	addr = name
	if i := strings.LastIndex(name, ":"); i >= 0 {
		port, _ = strconv.Atoi(name[i+1:])
	}
	return addr, port
}

func commandLine(pid int) string {
	out, err := exec.Command("ps", "-p", strconv.Itoa(pid), "-o", "args=").Output()
	if err != nil {
		return ""
	}
	return strings.TrimSpace(string(out))
}

func baseName(cmd string) string {
	cmd = strings.TrimSpace(cmd)
	if cmd == "" {
		return ""
	}
	fields := strings.Fields(cmd)
	if len(fields) == 0 {
		return cmd
	}
	base := fields[0]
	if i := strings.LastIndex(base, "/"); i >= 0 {
		return base[i+1:]
	}
	return base
}
