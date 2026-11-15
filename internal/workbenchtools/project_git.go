package workbenchtools

import (
	"bufio"
	"os"
	"os/exec"
	"path/filepath"
	"strings"
	"time"

	"WWorkbench/internal/model"
)

// DetectGitRemote 从本机项目目录探测 origin（或第一个 remote）URL。
// 优先读 .git/config；失败再试 git remote get-url。
func DetectGitRemote(localPath string) string {
	localPath = strings.TrimSpace(localPath)
	if localPath == "" {
		return ""
	}
	info, err := os.Stat(localPath)
	if err != nil || !info.IsDir() {
		return ""
	}
	if u := readGitRemoteFromConfig(localPath); u != "" {
		return u
	}
	return gitRemoteViaCLI(localPath)
}

// EnsureProjectGitRemote 若 gitRemote 为空则按 localPath 探测并写回。
func EnsureProjectGitRemote(p *model.WorkbenchProjectDO) {
	if p == nil {
		return
	}
	if strings.TrimSpace(p.GitRemote) != "" {
		return
	}
	if u := DetectGitRemote(p.LocalPath); u != "" {
		p.GitRemote = u
	}
}

func readGitRemoteFromConfig(localPath string) string {
	cfgPath := filepath.Join(localPath, ".git", "config")
	if st, err := os.Stat(filepath.Join(localPath, ".git")); err == nil && !st.IsDir() {
		if dir := readGitDirFile(filepath.Join(localPath, ".git")); dir != "" {
			cfgPath = filepath.Join(dir, "config")
		}
	}
	f, err := os.Open(cfgPath)
	if err != nil {
		return ""
	}
	defer f.Close()

	section := ""
	originURL := ""
	firstURL := ""
	sc := bufio.NewScanner(f)
	for sc.Scan() {
		line := strings.TrimSpace(sc.Text())
		if line == "" || strings.HasPrefix(line, "#") || strings.HasPrefix(line, ";") {
			continue
		}
		if strings.HasPrefix(line, "[") && strings.HasSuffix(line, "]") {
			section = strings.ToLower(strings.TrimSpace(line[1 : len(line)-1]))
			continue
		}
		if !strings.HasPrefix(section, "remote ") {
			continue
		}
		key, val, ok := strings.Cut(line, "=")
		if !ok {
			continue
		}
		if strings.TrimSpace(strings.ToLower(key)) != "url" {
			continue
		}
		url := strings.TrimSpace(val)
		if url == "" {
			continue
		}
		if firstURL == "" {
			firstURL = url
		}
		if section == `remote "origin"` || strings.Contains(section, `"origin"`) {
			originURL = url
		}
	}
	if originURL != "" {
		return originURL
	}
	return firstURL
}

func readGitDirFile(gitFile string) string {
	b, err := os.ReadFile(gitFile)
	if err != nil {
		return ""
	}
	line := strings.TrimSpace(string(b))
	const prefix = "gitdir:"
	if !strings.HasPrefix(strings.ToLower(line), prefix) {
		return ""
	}
	dir := strings.TrimSpace(line[len(prefix):])
	if dir == "" {
		return ""
	}
	if filepath.IsAbs(dir) {
		return dir
	}
	return filepath.Clean(filepath.Join(filepath.Dir(gitFile), dir))
}

func gitRemoteViaCLI(localPath string) string {
	done := make(chan string, 1)
	go func() {
		cmd := exec.Command("git", "-C", localPath, "remote", "get-url", "origin")
		out, err := cmd.Output()
		if err == nil {
			done <- strings.TrimSpace(string(out))
			return
		}
		cmd = exec.Command("git", "-C", localPath, "remote", "-v")
		out, err = cmd.Output()
		if err != nil {
			done <- ""
			return
		}
		for _, line := range strings.Split(string(out), "\n") {
			fields := strings.Fields(line)
			if len(fields) >= 2 && fields[0] == "origin" {
				done <- fields[1]
				return
			}
		}
		done <- ""
	}()
	select {
	case u := <-done:
		return u
	case <-time.After(2 * time.Second):
		return ""
	}
}
