package cursorrule

import (
	"fmt"
	"os"
	"path/filepath"
	"strings"
)

// UserProjectStageMarker 全局用户规则托管标记（合并/重装/移除依据）。
const UserProjectStageMarker = "<!-- wwb-managed-project-stage -->"

// UserProjectStageRel 相对 ~/.cursor 的用户规则路径。
const UserProjectStageRel = "rules/wworkbench-project-stage.mdc"

// UserProjectStagePluginRel 本地插件规则路径（~/.cursor/plugins/local/wworkbench/…）。
const UserProjectStagePluginRel = "plugins/local/wworkbench/rules/wworkbench-project-stage.mdc"

const userProjectStagePluginJSONRel = "plugins/local/wworkbench/.cursor-plugin/plugin.json"

const userProjectStagePluginJSON = `{
  "name": "wworkbench",
  "description": "WWorkbench project stage bootstrap"
}
`

// UserProjectStageMDC 全局 alwaysApply：仅动手意图才对齐项目舞台（纯读码跳过）。
const UserProjectStageMDC = `---
description: WWorkbench — 仅动手意图才 open_project_stage 对齐项目舞台
alwaysApply: true
---

` + UserProjectStageMarker + `

# WWorkbench 项目舞台上报

若已配置 **wworkbench** MCP（/mcp/workbench）：

1. **仅当本回合有动手意图**（SSH / 部署 / 查生产 / 改本机或远端配置 / shell_run）时，再调用 open_project_stage：
   - localPath = **当前工作区根目录的绝对路径**
   - intent = 人话说明要干什么、影响谁
2. **纯读码、改 UI、讨论方案、写文档**：不要调用 open_project_stage，不要为对齐而开舞台。
3. 无匹配项目时 WWorkbench 会自动建项并写入舞台规则、同步 Cursor 对话；已有项目则幂等对齐。
4. **禁止**用 Cursor 自带 Shell / 扫盘脚本代替本工具做改机。
5. 工具列表没有 open_project_stage：提示人在 WWorkbench「设置 → AI 能力权限」打开项目域，勿绕开。
`

// UserRuleResult 用户规则 / 本地插件写入结果。
type UserRuleResult struct {
	Path       string `json:"path"`
	PluginPath string `json:"pluginPath,omitempty"`
	Written    bool   `json:"written"`
	Skipped    bool   `json:"skipped,omitempty"`
	Removed    bool   `json:"removed,omitempty"`
	Error      string `json:"error,omitempty"`
}

func cursorHome() (string, error) {
	home, err := os.UserHomeDir()
	if err != nil {
		return "", err
	}
	return filepath.Join(home, ".cursor"), nil
}

func writeManagedFile(path, body string) (written, skipped bool, err error) {
	if prev, readErr := os.ReadFile(path); readErr == nil {
		if strings.TrimSpace(string(prev)) == strings.TrimSpace(body) {
			return false, true, nil
		}
	}
	if err := os.MkdirAll(filepath.Dir(path), 0o755); err != nil {
		return false, false, err
	}
	if err := os.WriteFile(path, []byte(body), 0o644); err != nil {
		return false, false, err
	}
	return true, false, nil
}

// EnsureUserProjectStageRule 幂等写入 ~/.cursor/rules + local plugin rules（不覆盖其它规则文件）。
func EnsureUserProjectStageRule() (UserRuleResult, error) {
	out := UserRuleResult{}
	root, err := cursorHome()
	if err != nil {
		return out, err
	}
	path := filepath.Join(root, UserProjectStageRel)
	pluginPath := filepath.Join(root, UserProjectStagePluginRel)
	out.Path = path
	out.PluginPath = pluginPath

	w1, s1, err := writeManagedFile(path, UserProjectStageMDC)
	if err != nil {
		out.Error = err.Error()
		return out, err
	}
	pluginJSON := filepath.Join(root, userProjectStagePluginJSONRel)
	if _, err := os.Stat(pluginJSON); os.IsNotExist(err) {
		if err := os.MkdirAll(filepath.Dir(pluginJSON), 0o755); err != nil {
			out.Error = err.Error()
			return out, err
		}
		if err := os.WriteFile(pluginJSON, []byte(userProjectStagePluginJSON), 0o644); err != nil {
			out.Error = err.Error()
			return out, err
		}
	}
	w2, s2, err := writeManagedFile(pluginPath, UserProjectStageMDC)
	if err != nil {
		out.Error = err.Error()
		return out, err
	}
	out.Written = w1 || w2
	out.Skipped = s1 && s2 && !out.Written
	return out, nil
}

// RemoveUserProjectStageRule 移除托管的用户规则与插件规则文件（保留其它规则）。
func RemoveUserProjectStageRule() (UserRuleResult, error) {
	out := UserRuleResult{}
	root, err := cursorHome()
	if err != nil {
		return out, err
	}
	path := filepath.Join(root, UserProjectStageRel)
	pluginPath := filepath.Join(root, UserProjectStagePluginRel)
	out.Path = path
	out.PluginPath = pluginPath
	removed := false
	for _, p := range []string{path, pluginPath} {
		if err := os.Remove(p); err == nil {
			removed = true
		} else if !os.IsNotExist(err) {
			out.Error = err.Error()
			return out, err
		}
	}
	out.Removed = removed
	if !removed {
		out.Skipped = true
	}
	return out, nil
}

// IsForbiddenAutoCreatePath 拒绝把 / 或 $HOME 自动建成项目。
func IsForbiddenAutoCreatePath(absPath string) error {
	abs := filepath.Clean(strings.TrimSpace(absPath))
	if abs == "" || abs == string(filepath.Separator) || abs == "/" {
		return fmt.Errorf("拒绝将文件系统根目录登记为项目")
	}
	home, err := os.UserHomeDir()
	if err == nil {
		homeAbs, _ := filepath.Abs(home)
		if homeAbs != "" && filepath.Clean(homeAbs) == abs {
			return fmt.Errorf("拒绝将用户主目录登记为项目")
		}
	}
	return nil
}
