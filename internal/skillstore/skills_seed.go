package skillstore

import (
	"os"
	"path/filepath"
	"strings"

	nhskill "github.com/wcoreing/ningharness/skill"
)

// ProtectedSkillID 不可删除的系统 Skill。
const ProtectedSkillID = "skill-creator"

// IsProtectedSkill 是否受保护的系统 Skill。
func IsProtectedSkill(id string) bool {
	return strings.TrimSpace(id) == ProtectedSkillID
}

// IsBuiltinSkill 是否内置种子 Skill（展示用；skill-creator 除外不可删）。
func IsBuiltinSkill(id string) bool {
	for _, s := range skillSeeds {
		if s.id == strings.TrimSpace(id) {
			return true
		}
	}
	return false
}

type skillSeed struct {
	id, name, description, body string
	scripts map[string]string // 相对 skill 目录，如 scripts/foo.sh
}

var skillSeeds = []skillSeed{
	{
		id:          "skill-creator",
		name:        "技能发布",
		description: "从笔记发布或更新 Agent 技能（/ 手动调用）",
		body: `# 技能发布助手

## 何时用

用户输入 /skill-creator，或从笔记点「发布为技能」。

## 流程

1. 用 get_workbench_context 取 noteId；没有则 list_notes / search_notes，或请用户说明目标笔记。
2. get_note(noteId) 读全文。正文顶部的 <!-- wwb-skill: id --> 表示已有关联 id（更新时沿用）。
3. 从笔记标题推断 id（小写、连字符、字母数字开头）、显示名、一句话 description；用户消息里的补充要求优先。
4. 简要展示推断结果；用户已在消息里写清 id/名称时可跳过确认，否则请其确认或补充（可选）。
5. 调用 publish_agent_skill：content 为去掉 wwb-skill 标记后的正文；noteId 必填。
6. 完成后告知：以后用 /{id} 调用；改正文请到左侧「技能」产品线编辑，或再 /skill-creator 从笔记同步。

## 不要

- 不要配置 globs / 自动匹配（产品仅支持 / 手动调用）。
- 不要把 HTML 注释写进 skill content。
`,
	},
	{
		id:          "ssh-inspect",
		name:        "SSH 巡检",
		description: "对绑定的 SSH 主机做只读巡检，汇总后写入笔记本",
		body: `# SSH 巡检

## 何时用

用户输入 /ssh-inspect，或绑定了 SSH 主机并要求巡检 / 健康检查。

## 本轮流程

1. 确认本轮已绑定 SSH 主机（前馈 / @）；没有则先请用户附加。
2. 用 shell_probe 在该主机执行只读诊断：uptime、free -h、df -h；必要时再看 load / 关键进程。
3. 汇总内存 / 磁盘 / 负载结论（简明条目，不堆原始长输出）。
4. 用 notebook_append_content 把 Markdown 报告写入笔记本。

## 不要

- 不要改配置、装包、重启服务。
- 不要用可见终端抢用户屏幕；探针用 shell_probe。
`,
	},
	{
		id:          "docker-inspect",
		name:        "Docker 巡检",
		description: "对绑定的 Docker 上下文做只读巡检，汇总后写入笔记本",
		body: `# Docker 巡检

## 何时用

用户输入 /docker-inspect，或绑定了 Docker 上下文并要求巡检。

## 本轮流程

1. 确认本轮已绑定 Docker 上下文。
2. list_containers 查看容器状态；对异常或核心容器 get_container_logs，必要时 fetch_logs。
3. 汇总运行中 / 退出 / 重启异常等结论。
4. notebook_append_content 写入 Markdown 报告。

## 不要

- 不要启停删容器，除非用户明确要求且走确认闸。
`,
	},
	{
		id:          "container-inspect",
		name:        "容器巡检",
		description: "对绑定的容器主机做只读巡检，汇总后写入笔记本",
		body: `# 容器巡检

## 何时用

用户输入 /container-inspect，或绑定了 docker: 容器主机并要求巡检。

## 本轮流程

1. 确认本轮已绑定容器主机（hostId 形如 docker:…）。
2. 用 shell_probe（hostId=该容器）执行 uptime、df -h、free -h 等只读诊断。
3. 必要时再 list_containers / get_container_logs。
4. notebook_append_content 写入 Markdown 报告。

## 不要

- 不要在容器内装包或改持久配置，除非用户明确要求。
`,
	},
	{
		id:          "host-probe-script",
		name:        "主机探针脚本",
		description: "用 scripts/probe.sh 对绑定 SSH 主机做只读探针，汇总写入笔记本",
		body: `# 主机探针脚本

## 何时用

用户输入 /host-probe-script，或要求按脚本探针巡检主机。

## 本轮流程

1. 确认本轮已绑定 SSH 主机（前馈 / @）；没有则先请用户附加。
2. **必须先** get_skill host-probe-script 加载本技能。
3. **必须** read_file 读取 system/skills/host-probe-script/scripts/probe.sh（禁止臆造命令）。
4. 将脚本中的每条只读命令用 shell_probe 在绑定主机执行（不要 bash -lc 整文件执行）。
5. 用户要求落盘时用 notebook_append_content 写 Markdown 报告。

## 脚本位置

- system/skills/host-probe-script/scripts/probe.sh

## 不要

- 只读探针，不改配置。
- 不要跳过 read_file。
`,
		scripts: map[string]string{
			"scripts/probe.sh": `#!/usr/bin/env bash
set -euo pipefail
echo "=== host-probe-script ==="
uptime
free -h
df -h /
hostname -f 2>/dev/null || hostname
`,
		},
	},
	{
		id:          "gpu-mem-probe",
		name:        "GPU 内存探针",
		description: "对绑定 SSH 主机执行 scripts/gpu_mem.sh（须 read_file 加载），汇总 GPU/内存",
		body: `# GPU 内存探针

## 何时用

用户输入 /gpu-mem-probe，或要求查看 GPU 显存 / 内存占用。

## 本轮流程

1. 确认本轮已绑定 SSH 主机（前馈 / @）；没有则先请用户附加。
2. **必须先** get_skill gpu-mem-probe 加载本技能。
3. **必须** read_file 读取 system/skills/gpu-mem-probe/scripts/gpu_mem.sh（正文不在 SKILL.md 里，禁止臆造命令）。
4. 将脚本中的每条只读命令用 shell_probe 在绑定主机执行（不要 bash -lc 整文件执行）。
5. 汇总 GPU / 内存结论（简明条目）；用户要求落盘时用 notebook_append_content 写 Markdown 报告。

## 脚本位置

- system/skills/gpu-mem-probe/scripts/gpu_mem.sh

## 不要

- 不要改配置、装驱动、重启服务。
- 不要跳过 read_file 直接猜 nvidia-smi 参数。
`,
		scripts: map[string]string{
			"scripts/gpu_mem.sh": `#!/usr/bin/env bash
# gpu-mem-probe：只读 GPU / 内存探针（Agent 须 read_file 本文件后再 shell_probe 各条命令）
set -euo pipefail
echo "=== gpu-mem-probe ==="
if command -v nvidia-smi >/dev/null 2>&1; then
  nvidia-smi --query-gpu=index,name,memory.total,memory.used,memory.free,utilization.gpu --format=csv,noheader
else
  echo "nvidia-smi: not installed"
fi
free -h
`,
		},
	},
}

// EnsureSkillSeeds 若缺失则写入内置 SKILL.md（不覆盖已有用户改动）。
func EnsureSkillSeeds(projectRoot string) error {
	root := strings.TrimSpace(projectRoot)
	if root == "" {
		return nil
	}
	for _, s := range skillSeeds {
		rel := nhskill.RelSkillMD(s.id)
		abs := filepath.Join(root, filepath.FromSlash(rel))
		skillDir := filepath.Dir(abs)
		created := false
		if _, err := os.Stat(abs); err != nil {
			if err := os.MkdirAll(skillDir, 0o755); err != nil {
				return err
			}
			doc := formatSeedSkillMD(s.name, s.description, s.body)
			if err := os.WriteFile(abs, []byte(doc), 0o644); err != nil {
				return err
			}
			created = true
		}
		for scriptRel, content := range s.scripts {
			scriptAbs := filepath.Join(skillDir, filepath.FromSlash(scriptRel))
			if _, err := os.Stat(scriptAbs); err == nil && !created {
				continue
			}
			if err := os.MkdirAll(filepath.Dir(scriptAbs), 0o755); err != nil {
				return err
			}
			if err := os.WriteFile(scriptAbs, []byte(content), 0o755); err != nil {
				return err
			}
		}
	}
	return RepairSkillFrontmatter(root)
}

func formatSeedSkillMD(name, description, body string) string {
	var b strings.Builder
	b.WriteString("---\n")
	b.WriteString("name: ")
	b.WriteString(name)
	b.WriteString("\n")
	b.WriteString("description: ")
	b.WriteString(description)
	b.WriteString("\n---\n\n")
	b.WriteString(strings.TrimSpace(body))
	b.WriteByte('\n')
	return b.String()
}
