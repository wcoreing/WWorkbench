package workbenchtools

import (
	"encoding/json"
	"fmt"
	"path"
	"strings"

	"WWorkbench/internal/model"
	"WWorkbench/internal/store"
	"WWorkbench/internal/workbench"
)

// GrantTrustFromConfirm 用户点「信任并执行」后落账本，并尽量沉淀进项目 Skill。
// 返回落盘结果摘要（供 toast / stage）；硬风险直接失败。
func GrantTrustFromConfirm(d *Deps, toolName string, args json.RawMessage, preview json.RawMessage, summary string) (MCPTrustOp, string, error) {
	toolName = strings.TrimSpace(toolName)
	if toolName == "" {
		return MCPTrustOp{}, "", fmt.Errorf("工具名为空")
	}
	hostKey, command, intent, risk, hard := extractTrustContext(d, toolName, args, preview)
	if hard || isHardShellRiskReason(risk) {
		return MCPTrustOp{}, "", fmt.Errorf("硬风险不可信任")
	}
	if intent == "" {
		intent = strings.TrimSpace(summary)
	}
	op := MCPTrustOp{
		Tool:    toolName,
		HostKey: hostKey,
		Command: command,
		Intent:  intent,
		Risk:    risk,
		Summary: firstNonEmpty(strings.TrimSpace(summary), truncateRunes(firstNonEmpty(command, intent), 72)),
	}
	projectID, skillPath := resolveActiveProjectSkill(d)
	op.ProjectID = projectID
	op.SkillPath = skillPath

	if d == nil || d.TrustOps == nil {
		return MCPTrustOp{}, "", fmt.Errorf("信任账本未就绪")
	}
	granted, err := d.TrustOps.Grant(op)
	if err != nil {
		return MCPTrustOp{}, "", err
	}

	note := "已信任（运行时账本）"
	if skillPath == "" {
		return granted, "已信任（未绑定项目，未写入 Skill）", nil
	}
	line := formatTrustedOpLesson(granted, hostDisplayName(d, hostKey))
	res := UpdateSkillNow(d, UpdateSkillArgs{
		Name:      skillPath,
		Intent:    "信任操作沉淀：" + firstNonEmpty(granted.Summary, granted.Tool),
		TrustedOp: line,
	})
	if !res.OK {
		return granted, "已信任（Skill 写入失败：" + res.Error + "）", nil
	}
	note = "已信任并写入 Skill · " + skillPath
	return granted, note, nil
}

func formatTrustedOpLesson(op MCPTrustOp, hostName string) string {
	hostName = firstNonEmpty(strings.TrimSpace(hostName), op.HostKey)
	body := firstNonEmpty(op.Intent, truncateRunes(op.Command, 80))
	risk := firstNonEmpty(op.Risk, "非硬风险")
	return fmt.Sprintf(
		"%s @host=%s · %s · risk=%s\n  fingerprint=%s（工作台免确认；硬风险除外）",
		op.Tool, hostName, body, risk, ShortTrustFingerprint(op.Fingerprint),
	)
}

func hostDisplayName(d *Deps, hostKey string) string {
	hostKey = hostKeyOrLocal(hostKey)
	if hostKey == "local" {
		return "本机"
	}
	if d == nil || d.SSHHosts == nil {
		return hostKey
	}
	h, err := d.SSHHosts.Get(hostKey)
	if err != nil || h == nil {
		return hostKey
	}
	return firstNonEmpty(strings.TrimSpace(h.Name), hostKey)
}

func resolveActiveProjectSkill(d *Deps) (projectID, skillPath string) {
	if d == nil || d.Store == nil {
		return "", ""
	}
	id, _ := d.Store.GetAppSetting(store.SettingLastWorkbenchProjectID)
	id = strings.TrimSpace(id)
	var p model.WorkbenchProjectDO
	var err error
	if id != "" {
		p, err = d.Store.GetWorkbenchProject(id)
	}
	if err != nil || strings.TrimSpace(p.ID) == "" {
		return "", ""
	}
	projectID = p.ID
	for _, link := range p.Links {
		if strings.EqualFold(strings.TrimSpace(link.Kind), "skill") {
			sp := strings.TrimSpace(link.ID)
			if sp != "" {
				return projectID, strings.TrimSuffix(sp, "/SKILL.md")
			}
		}
	}
	name := strings.TrimSpace(p.Name)
	if name == "" {
		name = path.Base(strings.TrimSpace(p.LocalPath))
	}
	if name == "" {
		return projectID, ""
	}
	return projectID, "项目/" + name
}

func extractTrustContext(d *Deps, toolName string, args, preview json.RawMessage) (hostKey, command, intent, risk string, hard bool) {
	hostKey = "local"
	var am, pm map[string]interface{}
	_ = json.Unmarshal(args, &am)
	_ = json.Unmarshal(preview, &pm)
	pick := func(m map[string]interface{}, keys ...string) string {
		if m == nil {
			return ""
		}
		for _, k := range keys {
			if v, ok := m[k]; ok {
				s := strings.TrimSpace(fmtString(v))
				if s != "" {
					return s
				}
			}
		}
		return ""
	}
	boolish := func(m map[string]interface{}, key string) bool {
		if m == nil {
			return false
		}
		v, ok := m[key]
		if !ok {
			return false
		}
		switch x := v.(type) {
		case bool:
			return x
		case string:
			return strings.EqualFold(strings.TrimSpace(x), "true") || strings.TrimSpace(x) == "1"
		default:
			return false
		}
	}

	hard = boolish(pm, "hardRisk") || boolish(pm, "dataGuard")
	risk = pick(pm, "risk")
	intent = firstNonEmpty(pick(pm, "intent"), pick(am, "intent"), extractIntent(args))
	command = firstNonEmpty(
		pick(pm, "command", "initialCommand"),
		pick(am, "initialCommand", "command", "sql", "path"),
	)

	switch {
	case toolName == workbench.CapShellRun || toolName == "open_terminal" || toolName == "terminal.open" || toolName == "terminal_open":
		if boolish(am, "localShell") || boolish(pm, "localShell") {
			hostKey = "local"
		} else {
			hostKey = firstNonEmpty(pick(pm, "hostId"), pick(am, "hostId"))
			if hostKey == "" {
				if h, _, errMsg := resolveSSHHost(d, pick(am, "hostId"), pick(am, "hostOrName")); errMsg == "" && h != nil {
					hostKey = h.ID
				}
			}
			if hostKey == "" {
				hostKey = "local"
			}
		}
		if risk == "" && command != "" {
			if risky, reason := assessShellRisk(command); risky {
				risk = reason
				if isHardShellRiskReason(reason) {
					hard = true
				}
			}
		}
	default:
		hostKey = firstNonEmpty(pick(pm, "hostId", "sshHostId"), pick(am, "hostId", "sshHostId", "connectionId"), "local")
	}
	return hostKeyOrLocal(hostKey), command, intent, risk, hard
}

// trustMatchFromArgs 确认门前：账本命中则跳过弹窗。
func trustMatchFromArgs(d *Deps, toolName string, args json.RawMessage, previewRisk string) bool {
	if d == nil || d.TrustOps == nil {
		return false
	}
	hostKey, command, intent, risk, hard := extractTrustContext(d, toolName, args, nil)
	if hard {
		return false
	}
	if risk == "" {
		risk = strings.TrimSpace(previewRisk)
	}
	return d.TrustOps.Match(toolName, hostKey, command, intent, risk)
}
