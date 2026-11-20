package cursorrule

import (
	"fmt"
	"os"
	"path/filepath"
	"strings"
)

// RelPath 相对项目根的托管规则路径。
const RelPath = ".cursor/rules/wworkbench-stage.mdc"

const managedMarker = "<!-- wwb-managed-stage-rule -->"

// StageRuleMDC Cursor alwaysApply 舞台优先规则（产品托管；Agent 选工具时权重高于 MCP instructions）。
const StageRuleMDC = `---
description: WWorkbench 舞台优先——改机/SSH/部署必须走 WWorkbench MCP，禁止 Cursor 自带 Shell
alwaysApply: true
---

` + managedMarker + `

# WWorkbench 舞台优先

你在带 WWorkbench 的仓库里协作。本机/远端动手必须走 **WWorkbench MCP**（端点 /mcp/workbench），让人看得见终端与确认弹窗。

## 路由协议（先于任何 Cursor 自带工具）

1. 动手意图（SSH、部署、查生产输出、改配置）：先确认 MCP 工具可用 → 调用 get_workbench_context 或 list_ssh_hosts。
2. 改机器 / 跑可见命令：只用 MCP shell_run + get_shell_output（带 afterUpdatedAt）；只读短探针才用 shell_probe。
3. **禁止**用 Cursor 自带 Shell / Terminal / SSH / 直连服务器「图省事」；确认弹窗烦也不许绕开。
4. 工具列表里没有某能力：告诉人去 WWorkbench「设置 → AI 能力权限」打开对应域，**不要**改用自带 Shell。
5. Cursor 只挂本工作台 /mcp/workbench；勿叠 chrome-devtools / browser-use / computer-use 等同能力 MCP。

## 为何

舞台失明 = 人无法拍板与复盘。产品目标是引导人成长，不是替人偷偷改生产。
`

// Result Ensure 结果摘要。
type Result struct {
	Path    string `json:"path"`
	Written bool   `json:"written"`
	Skipped bool   `json:"skipped,omitempty"`
	Error   string `json:"error,omitempty"`
}

// EnsureStageRule 向项目根写入 alwaysApply 舞台规则；已存在且内容同源则跳过。
func EnsureStageRule(projectRoot string) (Result, error) {
	root := strings.TrimSpace(projectRoot)
	out := Result{}
	if root == "" {
		return out, fmt.Errorf("localPath 为空")
	}
	abs, err := filepath.Abs(root)
	if err != nil {
		return out, err
	}
	info, err := os.Stat(abs)
	if err != nil {
		return out, fmt.Errorf("项目目录不可用: %w", err)
	}
	if !info.IsDir() {
		return out, fmt.Errorf("localPath 不是目录: %s", abs)
	}
	path := filepath.Join(abs, RelPath)
	out.Path = path
	if prev, err := os.ReadFile(path); err == nil {
		if strings.TrimSpace(string(prev)) == strings.TrimSpace(StageRuleMDC) {
			out.Skipped = true
			return out, nil
		}
	}
	if err := os.MkdirAll(filepath.Dir(path), 0o755); err != nil {
		return out, err
	}
	if err := os.WriteFile(path, []byte(StageRuleMDC), 0o644); err != nil {
		return out, err
	}
	out.Written = true
	return out, nil
}
