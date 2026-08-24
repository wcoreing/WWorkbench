package environment

import (
	"fmt"
	"os"
	"path/filepath"
	"regexp"
	"strings"
	"sync"

	"WWorkbench/internal/errno"
	"WWorkbench/internal/model"
)

const (
	langNode = "node"
	langGo   = "go"
	langPHP  = "php"
	langJava = "java"
)

// SSHHostLookup 解析已保存的 SSH 主机（由 terminal.HostService 实现，避免包循环）。
type SSHHostLookup interface {
	Get(id string) (*model.SSHHostDO, error)
}

// Manager 开发环境管理（本机或 SSH 远端）。
type Manager struct {
	mu           sync.Mutex
	hosts        SSHHostLookup
	onInstallLog InstallLogHandler
}

// NewManager 创建环境管理器。
func NewManager(hosts SSHHostLookup) *Manager {
	return &Manager{hosts: hosts}
}

// resolveRunner 空 hostID 为本机；否则拨号 SSH（拒绝 Windows 远端）。
func (m *Manager) resolveRunner(sshHostID string) (ShellRunner, error) {
	sshHostID = strings.TrimSpace(sshHostID)
	if sshHostID == "" {
		return localShellRunner{}, nil
	}
	if m.hosts == nil {
		return nil, errno.New(errno.CodeInvalidArg, "SSH 主机服务不可用", "")
	}
	host, err := m.hosts.Get(sshHostID)
	if err != nil {
		return nil, err
	}
	return newSSHShellRunner(*host)
}

// withHost 在指定目标上串行执行环境操作。
func (m *Manager) withHost(sshHostID string, fn func() error) error {
	m.mu.Lock()
	defer m.mu.Unlock()
	r, err := m.resolveRunner(sshHostID)
	if err != nil {
		return err
	}
	setActiveRunner(r)
	defer func() {
		if ssh, ok := r.(*sshShellRunner); ok {
			ssh.Close()
		}
		setActiveRunner(localShellRunner{})
	}()
	return fn()
}

// ListRuntimes 列出当前生效的运行时。
func (m *Manager) ListRuntimes(sshHostID string) ([]model.RuntimeDO, error) {
	var list []model.RuntimeDO
	err := m.withHost(sshHostID, func() error {
		list = []model.RuntimeDO{
			detectNode(),
			detectGo(),
			detectPHP(),
			detectJava(),
		}
		return nil
	})
	return list, err
}

// ListVersions 列出某语言可切换版本。
func (m *Manager) ListVersions(sshHostID, lang string) ([]model.RuntimeVersionDO, error) {
	var list []model.RuntimeVersionDO
	err := m.withHost(sshHostID, func() error {
		var e error
		switch lang {
		case langNode:
			list = listNodeVersions()
		case langGo:
			list = listGoVersions()
		case langPHP:
			list = listPHPVersions()
		case langJava:
			list = listJavaVersions()
		default:
			e = errno.New(errno.CodeInvalidArg, "未知语言运行时", lang)
		}
		return e
	})
	return list, err
}

// UseVersion 切换运行时版本。
func (m *Manager) UseVersion(sshHostID, lang, version string) error {
	version = strings.TrimSpace(version)
	if version == "" {
		return errno.New(errno.CodeInvalidArg, "版本号不能为空", lang)
	}
	return m.withHost(sshHostID, func() error {
		var err error
		switch lang {
		case langNode:
			err = useNodeVersion(version)
		case langGo:
			err = useGoVersion(version)
		case langPHP:
			err = usePHPVersion(version)
		case langJava:
			err = useJavaVersion(version)
		default:
			return errno.New(errno.CodeInvalidArg, "未知语言运行时", lang)
		}
		if err != nil {
			return errno.Wrap(errno.CodeConnFailed, "切换版本失败", err)
		}
		return nil
	})
}

// ApplyPreset 按预设批量切换版本（单目标）。
func (m *Manager) ApplyPreset(sshHostID string, preset model.EnvPresetDO) []string {
	var warnings []string
	_ = m.withHost(sshHostID, func() error {
		warnings = m.applyPresetUnlocked(preset)
		return nil
	})
	return warnings
}

func (m *Manager) applyPresetUnlocked(preset model.EnvPresetDO) []string {
	var warnings []string
	for lang, ver := range preset.Runtimes {
		ver = strings.TrimSpace(ver)
		if ver == "" {
			continue
		}
		if err := m.ensureVersionUnlocked(lang, ver); err != nil {
			warnings = append(warnings, fmt.Sprintf("%s: %v", lang, err))
		}
	}
	return warnings
}

// ScanProjects 扫描目录下项目的版本线索（始终本机）。
func (m *Manager) ScanProjects(root string) ([]model.ProjectEnvHintDO, error) {
	root = localExpandHome(strings.TrimSpace(root))
	if root == "" {
		return nil, errno.New(errno.CodeInvalidArg, "扫描目录不能为空", "")
	}
	info, err := os.Stat(root)
	if err != nil {
		return nil, errno.Wrap(errno.CodeInvalidArg, "扫描目录不可用", err)
	}
	if !info.IsDir() {
		return nil, errno.New(errno.CodeInvalidArg, "路径不是目录", root)
	}
	entries, err := os.ReadDir(root)
	if err != nil {
		return nil, errno.Wrap(errno.CodeStoreFailed, "读取目录失败", err)
	}
	var out []model.ProjectEnvHintDO
	if hint := scanProjectDir(root); len(hint.Hints) > 0 {
		out = append(out, hint)
	}
	for _, ent := range entries {
		if !ent.IsDir() || strings.HasPrefix(ent.Name(), ".") {
			continue
		}
		path := filepath.Join(root, ent.Name())
		hint := scanProjectDir(path)
		if len(hint.Hints) > 0 {
			out = append(out, hint)
		}
	}
	return out, nil
}

// scanProjectDir 扫描单个项目目录。
func scanProjectDir(path string) model.ProjectEnvHintDO {
	hint := model.ProjectEnvHintDO{
		Path:      path,
		Hints:     []string{},
		Suggested: map[string]string{},
	}
	if v := readTrimFile(filepath.Join(path, ".nvmrc")); v != "" {
		hint.Hints = append(hint.Hints, ".nvmrc → "+v)
		hint.Suggested[langNode] = strings.TrimPrefix(v, "v")
	}
	if v := readTrimFile(filepath.Join(path, ".node-version")); v != "" {
		hint.Hints = append(hint.Hints, ".node-version → "+v)
		hint.Suggested[langNode] = strings.TrimPrefix(v, "v")
	}
	if v := parseGoMod(filepath.Join(path, "go.mod")); v != "" {
		hint.Hints = append(hint.Hints, "go.mod → "+v)
		hint.Suggested[langGo] = v
	}
	if v := readTrimFile(filepath.Join(path, ".go-version")); v != "" {
		v = strings.TrimPrefix(strings.TrimSpace(v), "go")
		hint.Hints = append(hint.Hints, ".go-version → "+v)
		hint.Suggested[langGo] = v
	}
	if v := readTrimFile(filepath.Join(path, ".php-version")); v != "" {
		hint.Hints = append(hint.Hints, ".php-version → "+v)
		hint.Suggested[langPHP] = v
	}
	if v := readTrimFile(filepath.Join(path, ".java-version")); v != "" {
		hint.Hints = append(hint.Hints, ".java-version → "+v)
		hint.Suggested[langJava] = normalizeJavaSuggest(v)
	}
	if raw := readFileText(filepath.Join(path, ".sdkmanrc")); raw != "" {
		if j := parseSdkmanrcJava(raw); j != "" {
			hint.Hints = append(hint.Hints, ".sdkmanrc → "+j)
			hint.Suggested[langJava] = normalizeJavaSuggest(j)
		}
	}
	return hint
}

// normalizeJavaSuggest 将项目线索规范为主版本或可安装 id。
func normalizeJavaSuggest(v string) string {
	id, err := normalizeJavaInstallID(v)
	if err != nil {
		return strings.TrimSpace(v)
	}
	return id
}

// parseSdkmanrcJava 从 .sdkmanrc 提取 java= 值。
func parseSdkmanrcJava(content string) string {
	for _, line := range strings.Split(content, "\n") {
		line = strings.TrimSpace(line)
		if line == "" || strings.HasPrefix(line, "#") {
			continue
		}
		lower := strings.ToLower(line)
		if strings.HasPrefix(lower, "java=") {
			return strings.TrimSpace(line[strings.Index(line, "=")+1:])
		}
	}
	return ""
}

// readFileText 读取整个文本文件。
func readFileText(path string) string {
	data, err := os.ReadFile(path)
	if err != nil {
		return ""
	}
	return string(data)
}

// readTrimFile 读取文件首行并去空白。
func readTrimFile(path string) string {
	data, err := os.ReadFile(path)
	if err != nil {
		return ""
	}
	return strings.TrimSpace(strings.Split(string(data), "\n")[0])
}

var (
	goModVersionRe   = regexp.MustCompile(`(?m)^go\s+([0-9]+\.[0-9]+(?:\.[0-9]+)?)`)
	goModToolchainRe = regexp.MustCompile(`(?m)^toolchain\s+go([0-9]+\.[0-9]+(?:\.[0-9]+)?)`)
)

// parseGoMod 从 go.mod 解析 Go 版本（优先 toolchain）。
func parseGoMod(path string) string {
	data, err := os.ReadFile(path)
	if err != nil {
		return ""
	}
	text := string(data)
	if m := goModToolchainRe.FindStringSubmatch(text); len(m) >= 2 {
		return m[1]
	}
	m := goModVersionRe.FindStringSubmatch(text)
	if len(m) < 2 {
		return ""
	}
	return m[1]
}
