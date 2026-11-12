// Package dirgit 笔记本任意目录的 git 版本仓（目录内 .git；可按策略 ignore）。
package dirgit

import (
	"fmt"
	"os"
	"os/exec"
	"path/filepath"
	"strconv"
	"strings"
	"sync"
)

const (
	gitUserMail = "wworkbench@local"
	gitUserName = "WWorkbench"
	mainBranch  = "main"
	initSubject = "init dir repo"
)

var mu sync.Mutex

// CommitInfo 提交摘要。
type CommitInfo struct {
	Hash    string `json:"hash"`
	Short   string `json:"short"`
	Subject string `json:"subject"`
	When    string `json:"when"`
}

// Status 目录仓时间轴。
type Status struct {
	Dir     string       `json:"dir"`
	Enabled bool         `json:"enabled"`
	Head    string       `json:"head,omitempty"`
	Working bool         `json:"working"`
	Commits []CommitInfo `json:"commits"`
}

// Options 建仓 / 创建版本时的 ignore 策略。
type Options struct {
	// ExtraIgnore 追加到默认 .DS_Store 之外（如 log.md）。
	ExtraIgnore []string
}

// DefaultExtraIgnore 按笔记本相对路径给默认额外忽略（工作流目录排除 log.md）。
func DefaultExtraIgnore(dirRel string) []string {
	rel := filepath.ToSlash(strings.TrimSpace(dirRel))
	if rel == "工作流" || strings.HasPrefix(rel, "工作流/") {
		return []string{"log.md"}
	}
	return nil
}

func run(dir string, args ...string) (string, error) {
	cmd := exec.Command("git", append([]string{"-c", "core.quotepath=false"}, args...)...)
	cmd.Dir = dir
	out, err := cmd.CombinedOutput()
	s := string(out)
	if err != nil {
		return s, fmt.Errorf("git %s: %w: %s", strings.Join(args, " "), err, strings.TrimSpace(s))
	}
	return s, nil
}

func mustRun(dir string, args ...string) string {
	out, _ := run(dir, args...)
	return out
}

// IsRepo 目录是否已纳管。
func IsRepo(dir string) bool {
	st, err := os.Stat(filepath.Join(dir, ".git"))
	if err != nil {
		return false
	}
	return st.IsDir() || st.Mode().IsRegular()
}

func ensureGitIgnore(dir string, extra []string) error {
	want := map[string]struct{}{".DS_Store": {}}
	for _, e := range extra {
		e = strings.TrimSpace(e)
		if e != "" {
			want[e] = struct{}{}
		}
	}
	p := filepath.Join(dir, ".gitignore")
	raw, err := os.ReadFile(p)
	if err != nil && !os.IsNotExist(err) {
		return err
	}
	text := string(raw)
	changed := false
	for line := range want {
		if !strings.Contains(text, line) {
			if text != "" && !strings.HasSuffix(text, "\n") {
				text += "\n"
			}
			text += line + "\n"
			changed = true
		}
	}
	if os.IsNotExist(err) && text == "" {
		var b strings.Builder
		for line := range want {
			b.WriteString(line)
			b.WriteByte('\n')
		}
		text = b.String()
		changed = true
	}
	if !changed {
		return nil
	}
	return os.WriteFile(p, []byte(text), 0o600)
}

func ensureMain(dir string) error {
	cur := strings.TrimSpace(mustRun(dir, "branch", "--show-current"))
	if cur == mainBranch {
		return nil
	}
	if _, err := run(dir, "rev-parse", "--verify", mainBranch); err == nil {
		_, err = run(dir, "checkout", mainBranch)
		return err
	}
	_, err := run(dir, "branch", "-M", mainBranch)
	return err
}

func ensureRepo(dir string, opt Options) error {
	if err := os.MkdirAll(dir, 0o700); err != nil {
		return err
	}
	if err := ensureGitIgnore(dir, opt.ExtraIgnore); err != nil {
		return err
	}
	if IsRepo(dir) {
		return ensureMain(dir)
	}
	if _, err := run(dir, "init"); err != nil {
		return err
	}
	if _, err := run(dir, "config", "user.email", gitUserMail); err != nil {
		return err
	}
	if _, err := run(dir, "config", "user.name", gitUserName); err != nil {
		return err
	}
	if _, err := run(dir, "add", "--", ".gitignore"); err != nil {
		return err
	}
	if _, err := run(dir, "commit", "-m", initSubject); err != nil {
		return err
	}
	return ensureMain(dir)
}

func parseLogLine(line string) CommitInfo {
	parts := strings.SplitN(line, "\x00", 3)
	ci := CommitInfo{}
	if len(parts) > 0 {
		ci.Hash = strings.TrimSpace(parts[0])
		if len(ci.Hash) >= 7 {
			ci.Short = ci.Hash[:7]
		}
	}
	if len(parts) > 1 {
		ci.Subject = parts[1]
	}
	if len(parts) > 2 {
		ci.When = parts[2]
	}
	return ci
}

func headInfo(dir string) (CommitInfo, error) {
	hash := strings.TrimSpace(mustRun(dir, "rev-parse", "HEAD"))
	if hash == "" {
		return CommitInfo{}, fmt.Errorf("dirgit: empty HEAD")
	}
	out, err := run(dir, "log", "-1", "--format=%H%x00%s%x00%cI", "HEAD")
	if err != nil {
		ci := CommitInfo{Hash: hash}
		if len(hash) >= 7 {
			ci.Short = hash[:7]
		}
		return ci, nil
	}
	return parseLogLine(strings.TrimSpace(out)), nil
}

func dirty(dir string) bool {
	out, err := run(dir, "status", "--porcelain", "--untracked-files=normal")
	if err != nil {
		return true
	}
	for _, line := range strings.Split(out, "\n") {
		line = strings.TrimRight(line, "\r")
		if strings.TrimSpace(line) == "" {
			continue
		}
		return true
	}
	return false
}

// Enable 启用目录版本（建仓；已存在则确保 ignore/main）。
func Enable(dir string, opt Options) error {
	mu.Lock()
	defer mu.Unlock()
	dir = filepath.Clean(strings.TrimSpace(dir))
	if dir == "" || dir == "." {
		return fmt.Errorf("invalid dir")
	}
	return ensureRepo(dir, opt)
}

// Pin 创建当前目录版本（无变更则返回 HEAD；未建仓则先 Enable）。
func Pin(dir, message string, opt Options) (CommitInfo, error) {
	mu.Lock()
	defer mu.Unlock()

	dir = filepath.Clean(strings.TrimSpace(dir))
	if dir == "" || dir == "." {
		return CommitInfo{}, fmt.Errorf("invalid dir")
	}
	if err := ensureRepo(dir, opt); err != nil {
		return CommitInfo{}, err
	}
	if _, err := run(dir, "add", "-A"); err != nil {
		return CommitInfo{}, err
	}
	msg := strings.TrimSpace(message)
	if msg == "" {
		msg = "pin"
	}
	// 显式创建版本：无变更也允许空提交，保证历史里一定有一条可见记录
	args := []string{"commit", "-m", msg}
	if _, err := run(dir, "diff", "--cached", "--quiet"); err == nil {
		args = append(args, "--allow-empty")
	}
	if _, err := run(dir, args...); err != nil {
		return CommitInfo{}, err
	}
	return headInfo(dir)
}

// Log 提交历史（新→旧）；跳过 init。
func Log(dir string, limit int) ([]CommitInfo, error) {
	dir = filepath.Clean(strings.TrimSpace(dir))
	if !IsRepo(dir) {
		return []CommitInfo{}, nil
	}
	if limit <= 0 {
		limit = 24
	}
	rev := mainBranch
	if _, err := run(dir, "rev-parse", "--verify", rev); err != nil {
		rev = "HEAD"
	}
	out, err := run(dir, "log", "-n", strconv.Itoa(limit), "--format=%H%x00%s%x00%cI", rev)
	if err != nil {
		return nil, err
	}
	var list []CommitInfo
	for _, line := range strings.Split(strings.TrimSpace(out), "\n") {
		line = strings.TrimSpace(line)
		if line == "" {
			continue
		}
		ci := parseLogLine(line)
		if ci.Hash == "" || ci.Subject == initSubject || ci.Subject == "init skill repo" {
			continue
		}
		list = append(list, ci)
	}
	return list, nil
}

// Restore 恢复到某提交（新 commit；被 ignore 的文件不动）。
func Restore(dir, hash, message string, opt Options) (CommitInfo, error) {
	mu.Lock()
	defer mu.Unlock()

	dir = filepath.Clean(strings.TrimSpace(dir))
	if !IsRepo(dir) {
		return CommitInfo{}, fmt.Errorf("目录尚未启用版本")
	}
	full := strings.TrimSpace(hash)
	out, err := run(dir, "rev-parse", "--verify", full)
	if err != nil {
		return CommitInfo{}, fmt.Errorf("unknown revision %s", hash)
	}
	full = strings.TrimSpace(out)
	if _, err := run(dir, "checkout", full, "--", "."); err != nil {
		return CommitInfo{}, err
	}
	if err := ensureGitIgnore(dir, opt.ExtraIgnore); err != nil {
		return CommitInfo{}, err
	}
	if _, err := run(dir, "add", "-A"); err != nil {
		return CommitInfo{}, err
	}
	msg := strings.TrimSpace(message)
	if msg == "" {
		short := full
		if len(short) > 7 {
			short = short[:7]
		}
		msg = "restore: " + short
	} else if !strings.HasPrefix(msg, "restore:") {
		msg = "restore: " + msg
	}
	if _, err := run(dir, "diff", "--cached", "--quiet"); err == nil {
		return headInfo(dir)
	}
	if _, err := run(dir, "commit", "-m", msg); err != nil {
		return CommitInfo{}, err
	}
	return headInfo(dir)
}

// ShowFile 读某 commit 中相对目录的文件。
func ShowFile(dir, hash, rel string) (string, error) {
	dir = filepath.Clean(strings.TrimSpace(dir))
	rel = filepath.ToSlash(strings.TrimSpace(rel))
	if rel == "" || strings.Contains(rel, "..") {
		return "", fmt.Errorf("invalid path")
	}
	if !IsRepo(dir) {
		return "", fmt.Errorf("目录尚未启用版本")
	}
	full := strings.TrimSpace(hash)
	out, err := run(dir, "rev-parse", "--verify", full)
	if err != nil {
		return "", fmt.Errorf("unknown revision %s", hash)
	}
	full = strings.TrimSpace(out)
	body, err := run(dir, "show", full+":"+rel)
	if err != nil {
		return "", err
	}
	return body, nil
}

// StatusOf 时间轴。
func StatusOf(dir string, limit int) (Status, error) {
	dir = filepath.Clean(strings.TrimSpace(dir))
	st := Status{Dir: dir, Commits: []CommitInfo{}, Enabled: IsRepo(dir)}
	if !st.Enabled {
		return st, nil
	}
	st.Head = strings.TrimSpace(mustRun(dir, "rev-parse", "HEAD"))
	commits, err := Log(dir, limit)
	if err != nil {
		return st, err
	}
	st.Commits = commits
	st.Working = dirty(dir)
	return st, nil
}
