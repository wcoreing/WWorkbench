package environment

import (
	"fmt"
	"os"
	"path/filepath"
	"regexp"
	"strings"

	"WNavicat/internal/errno"
	"WNavicat/internal/model"
)

const (
	langNode = "node"
	langGo   = "go"
	langPHP  = "php"
	langJava = "java"
)

// Manager 本机开发环境管理。
type Manager struct {
	onInstallLog InstallLogHandler
}

// NewManager 创建环境管理器。
func NewManager() *Manager {
	return &Manager{}
}

// ListRuntimes 列出当前生效的运行时。
func (m *Manager) ListRuntimes() []model.RuntimeDO {
	return []model.RuntimeDO{
		detectNode(),
		detectGo(),
		detectPHP(),
		detectJava(),
	}
}

// ListVersions 列出某语言可切换版本。
func (m *Manager) ListVersions(lang string) ([]model.RuntimeVersionDO, error) {
	switch lang {
	case langNode:
		return listNodeVersions(), nil
	case langGo:
		return listGoVersions(), nil
	case langPHP:
		return listPHPVersions(), nil
	case langJava:
		return listJavaVersions(), nil
	default:
		return nil, errno.New(errno.CodeInvalidArg, "未知语言运行时", lang)
	}
}

// UseVersion 切换运行时版本。
func (m *Manager) UseVersion(lang, version string) error {
	version = strings.TrimSpace(version)
	if version == "" {
		return errno.New(errno.CodeInvalidArg, "版本号不能为空", lang)
	}
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
}

// ApplyPreset 按预设批量切换版本。
func (m *Manager) ApplyPreset(preset model.EnvPresetDO) []string {
	var warnings []string
	for lang, ver := range preset.Runtimes {
		ver = strings.TrimSpace(ver)
		if ver == "" {
			continue
		}
		if err := m.EnsureVersion(lang, ver); err != nil {
			warnings = append(warnings, fmt.Sprintf("%s: %v", lang, err))
		}
	}
	return warnings
}

// ScanProjects 扫描目录下项目的版本线索。
func (m *Manager) ScanProjects(root string) ([]model.ProjectEnvHintDO, error) {
	root = expandHome(strings.TrimSpace(root))
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
	if v := readTrimFile(filepath.Join(path, ".php-version")); v != "" {
		hint.Hints = append(hint.Hints, ".php-version → "+v)
		hint.Suggested[langPHP] = v
	}
	if v := readTrimFile(filepath.Join(path, ".java-version")); v != "" {
		hint.Hints = append(hint.Hints, ".java-version → "+v)
		hint.Suggested[langJava] = v
	}
	return hint
}

// readTrimFile 读取文件首行并去空白。
func readTrimFile(path string) string {
	data, err := os.ReadFile(path)
	if err != nil {
		return ""
	}
	return strings.TrimSpace(strings.Split(string(data), "\n")[0])
}

var goModVersionRe = regexp.MustCompile(`(?m)^go\s+([0-9]+\.[0-9]+(?:\.[0-9]+)?)`)

// parseGoMod 从 go.mod 解析 Go 版本。
func parseGoMod(path string) string {
	data, err := os.ReadFile(path)
	if err != nil {
		return ""
	}
	m := goModVersionRe.FindStringSubmatch(string(data))
	if len(m) < 2 {
		return ""
	}
	return m[1]
}
