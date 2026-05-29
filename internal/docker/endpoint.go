package docker

import (
	"os"
	"path/filepath"
	"runtime"
)

// candidateDockerEndpoints 返回待尝试的 Docker 端点（按优先级）。
func candidateDockerEndpoints() []string {
	seen := map[string]bool{}
	add := func(list *[]string, host string) {
		if host == "" || seen[host] {
			return
		}
		seen[host] = true
		*list = append(*list, host)
	}

	var out []string
	if env := os.Getenv("DOCKER_HOST"); env != "" {
		add(&out, env)
	}

	home, _ := os.UserHomeDir()
	if home != "" {
		// Docker Desktop 默认 socket（macOS / 新版 Linux）
		add(&out, unixEndpoint(filepath.Join(home, ".docker", "run", "docker.sock")))
		// 旧版 Docker Desktop for Mac
		add(&out, unixEndpoint(filepath.Join(home, "Library", "Containers", "com.docker.docker", "Data", "docker.sock")))
	}

	add(&out, "unix:///var/run/docker.sock")

	if runtime.GOOS == "linux" {
		add(&out, "unix:///run/docker.sock")
	}

	return out
}

// resolveDockerEndpoint 解析首个可达的 Docker 端点。
func resolveDockerEndpoint() string {
	if eps := candidateDockerEndpoints(); len(eps) > 0 {
		return eps[0]
	}
	return "unix:///var/run/docker.sock"
}

// unixEndpoint 将文件路径转为 unix:// URL。
func unixEndpoint(path string) string {
	if path == "" {
		return ""
	}
	if _, err := os.Stat(path); err != nil {
		return ""
	}
	return "unix://" + filepath.Clean(path)
}

// socketExists 判断 unix 端点对应文件是否存在。
func socketExists(host string) bool {
	if len(host) < 8 || host[:7] != "unix://" {
		return true
	}
	path := host[7:]
	if path == "" {
		return false
	}
	_, err := os.Stat(path)
	return err == nil
}
