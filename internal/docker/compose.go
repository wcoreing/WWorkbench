package docker

import (
	"context"
	"encoding/json"
	"fmt"
	"os"
	"os/exec"
	"path/filepath"
	"strings"
	"time"

	"WWorkbench/internal/errno"
	"WWorkbench/internal/model"
	"WWorkbench/internal/tunnel"
)

// composePsRow docker compose ps --format json 单行结构。
type composePsRow struct {
	ID      string `json:"ID"`
	Name    string `json:"Name"`
	Image   string `json:"Image"`
	Service string `json:"Service"`
	State   string `json:"State"`
	Status  string `json:"Status"`
	Ports   string `json:"Ports"`
}

// runCompose 在指定目录执行 docker compose 子命令并返回合并输出。
func (m *Manager) runCompose(ctx context.Context, contextID, projectDir string, args ...string) (string, error) {
	projectDir = strings.TrimSpace(projectDir)
	if projectDir == "" {
		return "", errno.New(errno.CodeInvalidArg, "请选择 Compose 项目目录", "")
	}
	if _, err := os.Stat(projectDir); err != nil {
		return "", errno.Wrap(errno.CodeInvalidArg, "项目目录不存在", err)
	}
	if !hasComposeFile(projectDir) {
		return "", errno.New(errno.CodeInvalidArg, "目录中未找到 compose.yaml / docker-compose.yml", projectDir)
	}

	fullArgs := append([]string{"compose"}, args...)
	if contextID == LocalContextID {
		return runLocalCompose(ctx, projectDir, fullArgs)
	}
	return m.runRemoteCompose(ctx, contextID, projectDir, fullArgs)
}

// hasComposeFile 判断目录是否包含 Compose 清单文件。
func hasComposeFile(dir string) bool {
	for _, name := range []string{"compose.yaml", "compose.yml", "docker-compose.yaml", "docker-compose.yml"} {
		if _, err := os.Stat(filepath.Join(dir, name)); err == nil {
			return true
		}
	}
	return false
}

// runLocalCompose 本机执行 docker compose。
func runLocalCompose(ctx context.Context, dir string, args []string) (string, error) {
	cmd := exec.CommandContext(ctx, "docker", args...)
	cmd.Dir = dir
	out, err := cmd.CombinedOutput()
	text := strings.TrimSpace(string(out))
	if err != nil {
		if text == "" {
			text = err.Error()
		}
		return text, errno.Wrap(errno.CodeConnFailed, "docker compose 执行失败", fmt.Errorf("%s", text))
	}
	return text, nil
}

// runRemoteCompose 经 SSH 在远端目录执行 docker compose。
func (m *Manager) runRemoteCompose(ctx context.Context, contextID, dir string, args []string) (string, error) {
	ctxDO, err := m.store.GetDockerContext(contextID)
	if err != nil {
		return "", err
	}
	if ctxDO.SSHHostID == "" {
		return "", errno.New(errno.CodeInvalidArg, "无效的 Docker 上下文", contextID)
	}
	host, err := m.store.GetSSHHost(ctxDO.SSHHostID)
	if err != nil {
		return "", err
	}
	sshClient, err := tunnel.DialSSH(ctx, sshHostToTunnel(*host))
	if err != nil {
		return "", err
	}
	defer sshClient.Close()

	quotedDir := shellQuote(dir)
	cmdLine := "docker " + strings.Join(quoteArgs(args), " ")
	script := fmt.Sprintf("cd %s && %s", quotedDir, cmdLine)
	out, err := runSSHShell(sshClient, script)
	if err != nil {
		msg := strings.TrimSpace(out)
		if msg == "" {
			msg = err.Error()
		}
		return msg, errno.Wrap(errno.CodeConnFailed, "远端 docker compose 执行失败", fmt.Errorf("%s", msg))
	}
	return strings.TrimSpace(out), nil
}

// quoteArgs 为 shell 参数加引号。
func quoteArgs(args []string) []string {
	out := make([]string, len(args))
	for i, a := range args {
		out[i] = shellQuote(a)
	}
	return out
}

// ListComposeServices 列出 Compose 项目中的服务状态。
func (m *Manager) ListComposeServices(ctx context.Context, contextID, projectDir string) ([]model.ComposeServiceDO, error) {
	out, err := m.runCompose(ctx, contextID, projectDir, "ps", "-a", "--format", "json")
	if err != nil {
		return nil, err
	}
	return parseComposePs(out), nil
}

// parseComposePs 解析 compose ps JSON 输出。
func parseComposePs(output string) []model.ComposeServiceDO {
	output = strings.TrimSpace(output)
	if output == "" {
		return []model.ComposeServiceDO{}
	}
	var rows []composePsRow
	if strings.HasPrefix(output, "[") {
		_ = json.Unmarshal([]byte(output), &rows)
	} else {
		for _, line := range strings.Split(output, "\n") {
			line = strings.TrimSpace(line)
			if line == "" {
				continue
			}
			var row composePsRow
			if json.Unmarshal([]byte(line), &row) == nil {
				rows = append(rows, row)
			}
		}
	}
	list := make([]model.ComposeServiceDO, 0, len(rows))
	for _, r := range rows {
		name := r.Service
		if name == "" {
			name = r.Name
		}
		list = append(list, model.ComposeServiceDO{
			Name:      r.Name,
			Service:   name,
			Image:     r.Image,
			State:     r.State,
			Status:    r.Status,
			Ports:     r.Ports,
			Container: r.ID,
		})
	}
	return list
}

// ComposeUp 启动 Compose 项目（detached）。
func (m *Manager) ComposeUp(ctx context.Context, contextID, projectDir string) (string, error) {
	return m.runCompose(ctx, contextID, projectDir, "up", "-d", "--remove-orphans")
}

// ComposeDown 停止并移除 Compose 项目容器。
func (m *Manager) ComposeDown(ctx context.Context, contextID, projectDir string) (string, error) {
	return m.runCompose(ctx, contextID, projectDir, "down")
}

// ComposePull 拉取 Compose 项目镜像。
func (m *Manager) ComposePull(ctx context.Context, contextID, projectDir string) (string, error) {
	return m.runCompose(ctx, contextID, projectDir, "pull")
}

// GetComposeLogs 获取 Compose 项目或服务日志。
func (m *Manager) GetComposeLogs(ctx context.Context, contextID, projectDir, service string, tail int) (string, error) {
	if tail <= 0 {
		tail = 200
	}
	args := []string{"logs", "--tail", fmt.Sprintf("%d", tail), "--timestamps"}
	if strings.TrimSpace(service) != "" {
		args = append(args, strings.TrimSpace(service))
	}
	return m.runCompose(ctx, contextID, projectDir, args...)
}

// ComposeRestart 重启 Compose 服务。
func (m *Manager) ComposeRestart(ctx context.Context, contextID, projectDir, service string) (string, error) {
	args := []string{"restart"}
	if strings.TrimSpace(service) != "" {
		args = append(args, strings.TrimSpace(service))
	}
	return m.runCompose(ctx, contextID, projectDir, args...)
}

// TestComposeProject 检测目录是否为有效 Compose 项目。
func (m *Manager) TestComposeProject(projectDir string) error {
	projectDir = strings.TrimSpace(projectDir)
	if projectDir == "" {
		return errno.New(errno.CodeInvalidArg, "请选择项目目录", "")
	}
	if !hasComposeFile(projectDir) {
		return errno.New(errno.CodeInvalidArg, "未找到 compose 清单文件", projectDir)
	}
	ctx, cancel := context.WithTimeout(context.Background(), 30*time.Second)
	defer cancel()
	_, err := runLocalCompose(ctx, projectDir, []string{"compose", "config", "--quiet"})
	return err
}
