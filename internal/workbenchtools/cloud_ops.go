package workbenchtools

import (
	"context"
	"encoding/json"
	"fmt"
	"strings"
	"time"

	"WWorkbench/internal/aliyuncms"
	"WWorkbench/internal/errno"
	"WWorkbench/internal/model"
	"WWorkbench/internal/session"
	"WWorkbench/internal/terminal"
	"WWorkbench/internal/workbench"


	"github.com/google/uuid"
)

type sshHostIDArgs struct {
	SSHHostID string `json:"sshHostId"`
	HostID    string `json:"hostId"`
	Intent    string `json:"intent"`
}

type ecsMonitorArgs struct {
	SSHHostID   string `json:"sshHostId"`
	HostID      string `json:"hostId"`
	WindowHours int    `json:"windowHours"`
}

type configureSSHSGSyncArgs struct {
	SSHHostID string `json:"sshHostId"`
	HostID    string `json:"hostId"`
	Enabled   *bool  `json:"enabled"`
	Intent    string `json:"intent"`
}

func resolveSSHHostID(sshHostID, hostID string) string {
	id := strings.TrimSpace(sshHostID)
	if id == "" {
		id = strings.TrimSpace(hostID)
	}
	return id
}

func registerCloudOpsTools(r *Registry) {
	r.add(ToolDef{
		Name: workbench.CapGetECSMonitor,
		Description: "读取 SSH 主机已绑定 ECS 的云监控（CPU/内存/磁盘/带宽）。" +
			"须先在主机编辑里绑云账号+实例。windowHours：1/6/24/168。" +
			"返回 teach：用人话解释尖峰与建议；引导人成长，勿只报数字。",
		Parameters: map[string]interface{}{
			"type": "object",
			"properties": map[string]interface{}{
				"sshHostId":   map[string]interface{}{"type": "string", "description": "list_ssh_hosts 的 id"},
				"hostId":      map[string]interface{}{"type": "string", "description": "同 sshHostId"},
				"windowHours": map[string]interface{}{"type": "integer", "description": "1 / 6 / 24 / 168，默认 1"},
			},
			"required": []interface{}{"sshHostId"},
		},
		Handler: toolGetECSMonitor,
	})
	r.add(ToolDef{
		Name: workbench.CapSyncSSHSecurityGroup,
		Description: "把本机当前公网 IP 写入该 SSH 主机绑定 ECS 的安全组（SSH 端口，规则标记 wwb-dynamic-ip）。" +
			"需确认。失败时返回 teach.nextSteps（权限/未绑定/探测 IP）。成功后返回 suggestedSkill，须 offer_choices 问人是否 update_skill 沉淀到 运维/，禁止静默落盘。",
		Parameters: map[string]interface{}{
			"type": "object",
			"properties": map[string]interface{}{
				"sshHostId": map[string]interface{}{"type": "string"},
				"hostId":    map[string]interface{}{"type": "string"},
				"intent":    map[string]interface{}{"type": "string", "description": "人话：为何改安全组、影响哪台机"},
			},
			"required": []interface{}{"sshHostId", "intent"},
		},
		Handler: toolSyncSSHSecurityGroup,
	})
	r.add(ToolDef{
		Name: workbench.CapConfigureSSHSGSync,
		Description: "开启/关闭「连接前自动同步本机 IP 到安全组」（写本地主机配置）。" +
			"主机须已绑 ECS。需确认。成功后可用 suggestedSkill 问人是否沉淀到 运维/。",
		Parameters: map[string]interface{}{
			"type": "object",
			"properties": map[string]interface{}{
				"sshHostId": map[string]interface{}{"type": "string"},
				"hostId":    map[string]interface{}{"type": "string"},
				"enabled":   map[string]interface{}{"type": "boolean", "description": "true=开启连接前同步"},
				"intent":    map[string]interface{}{"type": "string"},
			},
			"required": []interface{}{"sshHostId", "enabled", "intent"},
		},
		Handler: toolConfigureSSHSGSync,
	})
}

func toolGetECSMonitor(ctx context.Context, d *Deps, raw json.RawMessage) ToolResult {
	if d == nil || d.SSHHosts == nil || d.Store == nil {
		return Fail("服务未就绪")
	}
	var in ecsMonitorArgs
	if err := json.Unmarshal(raw, &in); err != nil {
		return Fail("参数无效")
	}
	hostID := resolveSSHHostID(in.SSHHostID, in.HostID)
	if hostID == "" {
		return FailTeach("缺少 sshHostId", cloudTeachMissingHost())
	}
	host, err := d.SSHHosts.Get(hostID)
	if err != nil {
		return FailTeach(err.Error(), cloudTeachFromErr(err))
	}
	if strings.TrimSpace(host.CloudInstanceID) == "" || strings.TrimSpace(host.CloudAccountID) == "" {
		return FailTeach("这台主机还没绑定阿里云 ECS", cloudTeachNeedBind(host))
	}
	account, err := d.Store.GetCloudAccount(host.CloudAccountID)
	if err != nil {
		return FailTeach(err.Error(), cloudTeachFromErr(err))
	}
	parent := ctx
	if parent == nil {
		parent = context.Background()
	}
	cctx, cancel := session.WithTimeout(parent, 20)
	defer cancel()
	mon, err := aliyuncms.QueryECS(cctx, account.AccessKeyID, account.AccessKeySecret, host.CloudRegion, host.CloudInstanceID, in.WindowHours)
	if err != nil {
		return FailTeach(err.Error(), cloudTeachFromErr(err))
	}
	if mon.Series == nil {
		mon.Series = []model.ECSMetricSeriesDO{}
	}
	if mon.FetchedAt == 0 {
		mon.FetchedAt = time.Now().Unix()
	}
	teach := cloudTeachMonitor(host, mon)
	return OKData(map[string]interface{}{
		"ok": true, "hostId": host.ID, "hostName": host.Name,
		"monitor": mon, "teach": teach,
	})
}

func toolSyncSSHSecurityGroup(_ context.Context, d *Deps, raw json.RawMessage) ToolResult {
	if d == nil || d.SSHHosts == nil {
		return Fail("服务未就绪")
	}
	var in sshHostIDArgs
	if err := json.Unmarshal(raw, &in); err != nil {
		return Fail("参数无效")
	}
	hostID := resolveSSHHostID(in.SSHHostID, in.HostID)
	if hostID == "" {
		return Fail("缺少 sshHostId")
	}
	host, err := d.SSHHosts.Get(hostID)
	if err != nil {
		return FailTeach(err.Error(), cloudTeachFromErr(err))
	}
	if strings.TrimSpace(host.CloudInstanceID) == "" || strings.TrimSpace(host.CloudAccountID) == "" {
		return FailTeach("先绑定阿里云 ECS，才能同步安全组", cloudTeachNeedBind(host))
	}
	intent := strings.TrimSpace(in.Intent)
	preview := map[string]interface{}{
		"sshHostId": host.ID, "name": host.Name, "host": host.Host, "port": host.Port,
		"cloudRegion": host.CloudRegion, "cloudInstanceId": host.CloudInstanceID,
		"sgId": host.SgID, "sgSync": host.SgSync, "sgLastCidr": host.SgLastCIDR,
		"intent": intent,
		"risk":   "将探测本机公网 IP，并改写 ECS 安全组中标记为 wwb-dynamic-ip 的入站规则",
		"teach":  cloudTeachSyncPreview(host),
	}
	summary := intent
	if summary == "" {
		summary = "同步本机 IP 到安全组 · " + host.Name
	}
	return Confirm(uuid.NewString(), truncateRunes(summary, intentTitleMaxRune), preview)
}

// SyncSSHSecurityGroupConfirmed 用户确认后执行安全组同步。
func SyncSSHSecurityGroupConfirmed(ctx context.Context, d *Deps, argsJSON string) ToolResult {
	var in sshHostIDArgs
	if err := json.Unmarshal([]byte(argsJSON), &in); err != nil {
		return Fail("参数无效")
	}
	return executeSyncSSHSecurityGroup(ctx, d, resolveSSHHostID(in.SSHHostID, in.HostID), strings.TrimSpace(in.Intent))
}

func executeSyncSSHSecurityGroup(ctx context.Context, d *Deps, hostID, intent string) ToolResult {
	if d == nil || d.SSHHosts == nil || d.Store == nil {
		return Fail("服务未就绪")
	}
	if hostID == "" {
		return FailTeach("缺少 sshHostId", cloudTeachMissingHost())
	}
	host, err := d.SSHHosts.Get(hostID)
	if err != nil {
		return FailTeach(err.Error(), cloudTeachFromErr(err))
	}
	if strings.TrimSpace(host.CloudInstanceID) == "" || strings.TrimSpace(host.CloudAccountID) == "" {
		return FailTeach("先绑定阿里云 ECS，才能同步安全组", cloudTeachNeedBind(host))
	}
	account, err := d.Store.GetCloudAccount(host.CloudAccountID)
	if err != nil {
		return FailTeach(err.Error(), cloudTeachFromErr(err))
	}
	parent := ctx
	if parent == nil {
		parent = context.Background()
	}
	cctx, cancel := session.WithTimeout(parent, 20)
	defer cancel()
	res, err := aliyuncms.SyncHomeIPToSecurityGroup(
		cctx,
		account.AccessKeyID, account.AccessKeySecret,
		host.CloudRegion, host.CloudInstanceID, host.SgID,
		host.Port, host.SgLastCIDR,
	)
	if err != nil {
		return FailTeach(err.Error(), cloudTeachFromErr(err))
	}
	if res.CIDR != "" {
		_ = d.Store.UpdateSSHHostSGSyncState(host.ID, res.SecurityGroup, res.CIDR, time.Now().Unix())
	}
	out := model.SecurityGroupSyncResultDO{
		PublicIP: res.PublicIP, CIDR: res.CIDR, SecurityGroup: res.SecurityGroup,
		Port: res.Port, Skipped: res.Skipped, RevokedOldCIDR: res.RevokedOldCIDR, Message: res.Message,
	}
	teach := cloudTeachSyncOK(host, out)
	skill := suggestedOpsSkill(host, out)
	return OKData(map[string]interface{}{
		"ok": true, "hostId": host.ID, "hostName": host.Name, "intent": intent,
		"result": out, "teach": teach, "suggestedSkill": skill,
		"note": "若人同意沉淀：用 offer_choices 确认后 update_skill(name=suggestedSkill.name, lessons=…)。禁止未问人就落盘。",
	})
}

func toolConfigureSSHSGSync(_ context.Context, d *Deps, raw json.RawMessage) ToolResult {
	if d == nil || d.SSHHosts == nil {
		return Fail("服务未就绪")
	}
	var in configureSSHSGSyncArgs
	if err := json.Unmarshal(raw, &in); err != nil {
		return Fail("参数无效")
	}
	hostID := resolveSSHHostID(in.SSHHostID, in.HostID)
	if hostID == "" {
		return Fail("缺少 sshHostId")
	}
	if in.Enabled == nil {
		return Fail("须指定 enabled")
	}
	host, err := d.SSHHosts.Get(hostID)
	if err != nil {
		return FailTeach(err.Error(), cloudTeachFromErr(err))
	}
	if *in.Enabled && (strings.TrimSpace(host.CloudInstanceID) == "" || strings.TrimSpace(host.CloudAccountID) == "") {
		return FailTeach("开启前请先绑定阿里云 ECS", cloudTeachNeedBind(host))
	}
	intent := strings.TrimSpace(in.Intent)
	preview := map[string]interface{}{
		"sshHostId": host.ID, "name": host.Name, "enabled": *in.Enabled,
		"wasEnabled": host.SgSync, "intent": intent,
		"risk": "只改本地主机配置；下次打开终端时才会真正写安全组",
		"teach": Teach{
			Summary: "连接前自动同步 = 每天家宽 IP 变了也不用手改安全组",
			NextSteps: []string{
				"开启后请再 sync_ssh_security_group 做一次即时放行",
				"AccessKey 需要改安全组权限，不只是只读",
			},
		},
	}
	summary := intent
	if summary == "" {
		if *in.Enabled {
			summary = "开启连接前同步安全组 · " + host.Name
		} else {
			summary = "关闭连接前同步安全组 · " + host.Name
		}
	}
	return Confirm(uuid.NewString(), truncateRunes(summary, intentTitleMaxRune), preview)
}

// ConfigureSSHSGSyncConfirmed 用户确认后开关 sgSync。
func ConfigureSSHSGSyncConfirmed(_ context.Context, d *Deps, argsJSON string) ToolResult {
	var in configureSSHSGSyncArgs
	if err := json.Unmarshal([]byte(argsJSON), &in); err != nil {
		return Fail("参数无效")
	}
	if in.Enabled == nil {
		return Fail("须指定 enabled")
	}
	hostID := resolveSSHHostID(in.SSHHostID, in.HostID)
	if hostID == "" {
		return FailTeach("缺少 sshHostId", cloudTeachMissingHost())
	}
	host, err := d.SSHHosts.Get(hostID)
	if err != nil {
		return FailTeach(err.Error(), cloudTeachFromErr(err))
	}
	if *in.Enabled && (strings.TrimSpace(host.CloudInstanceID) == "" || strings.TrimSpace(host.CloudAccountID) == "") {
		return FailTeach("开启前请先绑定阿里云 ECS", cloudTeachNeedBind(host))
	}
	host.SgSync = *in.Enabled
	if !host.SgSync {
		// 关闭同步不强制清 sgId；保留上次 CIDR 便于再开时对比
	}
	host.TouchCloud = false
	host.Password = "" // mergeSecrets 保留库中密码
	saved, err := d.SSHHosts.Save(*host)
	if err != nil {
		return FailTeach(err.Error(), cloudTeachFromErr(err))
	}
	out := *saved
	terminal.StripSecrets(&out)
	teach := Teach{
		Summary: fmt.Sprintf("已%s「连接前同步本机 IP」", map[bool]string{true: "开启", false: "关闭"}[out.SgSync]),
		NextSteps: []string{
			"人可在 SSH 主机 → ECS 监控 勾选同名选项核对",
			"若刚开启：建议立刻 sync_ssh_security_group 放行当前 IP",
		},
	}
	skill := NewSuggestedSkill(
		"cloud",
		"运维/"+SafeSkillPathSegment(out.Name)+"/家宽IP放行",
		"家宽公网 IP 会变。主机已开 sgSync；连接前工作台会写 wwb-dynamic-ip 规则。AccessKey 需 Authorize/RevokeSecurityGroup。",
		"要把「连接前自动放行家宽 IP」写进运维 Skill 吗？",
	)
	return OKData(map[string]interface{}{
		"ok": true, "host": out, "teach": teach, "suggestedSkill": skill,
		"note": "沉淀须人点头：offer_choices → update_skill。",
	})
}

func cloudTeachMissingHost() Teach {
	return Teach{
		Summary:   "还没指定要操作哪台 SSH 主机",
		NextSteps: []string{"先 list_ssh_hosts，或让人 @ 拖入主机", "确认主机已在「ECS 监控」绑好云账号与实例"},
	}
}

func cloudTeachNeedBind(host *model.SSHHostDO) Teach {
	name := ""
	if host != nil {
		name = host.Name
	}
	return Teach{
		Summary: fmt.Sprintf("主机「%s」还没绑阿里云 ECS，没法读监控或改安全组", name),
		NextSteps: []string{
			"打开终端产品 → 编辑该 SSH 主机 →「ECS 监控」选云账号、地域、实例",
			"列出实例需要 ECS 只读；改安全组还要 Authorize/RevokeSecurityGroup",
			"绑好后可勾「连接前把本机公网 IP 写入安全组」，或让我调 configure_ssh_sg_sync",
		},
	}
}

func cloudTeachSyncPreview(host *model.SSHHostDO) Teach {
	steps := []string{
		"确认弹窗通过后：探测本机公网 IP → 写入安全组 TCP/" + fmt.Sprintf("%d", host.Port),
		"只动 Description=wwb-dynamic-ip 的规则；先放行再撤旧 IP",
		"若 AccessKey 只有只读权限会失败——请到 RAM 加改安全组权限",
	}
	if !host.SgSync {
		steps = append(steps, "当前未开「连接前自动同步」；成功后可问人是否 configure_ssh_sg_sync(enabled=true)")
	}
	return Teach{Summary: "即将用你当前的家宽公网 IP 更新云上白名单", NextSteps: steps}
}

func cloudTeachSyncOK(host *model.SSHHostDO, res model.SecurityGroupSyncResultDO) Teach {
	steps := []string{
		"可在阿里云控制台核对该安全组是否出现 Description=wwb-dynamic-ip、源 " + res.CIDR,
		"SSH 主机地址若用临时公网，建议改成 EIP，地址更稳",
	}
	if !host.SgSync {
		steps = append(steps, "建议开启连接前自动同步，免得明天 IP 又变：configure_ssh_sg_sync(enabled=true)")
	}
	if res.Skipped {
		return Teach{Summary: "本机 IP 没变，安全组不用改", NextSteps: steps}
	}
	return Teach{Summary: res.Message, NextSteps: steps}
}

func cloudTeachMonitor(host *model.SSHHostDO, mon model.ECSMonitorDO) Teach {
	var peaks []string
	for _, s := range mon.Series {
		if strings.TrimSpace(s.Error) != "" {
			peaks = append(peaks, s.Metric+": "+s.Error)
			continue
		}
		peaks = append(peaks, fmt.Sprintf("%s 最新 %.1f%s", s.Metric, s.Latest, s.Unit))
	}
	_ = host
	return Teach{
		Summary:    "已拉到近窗监控；请解释趋势与可能原因，而不是只贴表格",
		Highlights: peaks,
		NextSteps: []string{
			"把尖峰用人话讲给人：是否刚部署、是否爬虫、是否备份窗口",
			"内存/磁盘为 0 或报错时：提醒装云监控插件，不是工作台坏了",
			"需要改白名单连不上时：用 sync_ssh_security_group，不要让人去控制台手改一堆规则",
		},
	}
}

func cloudTeachFromErr(err error) Teach {
	msg := ""
	if err != nil {
		msg = err.Error()
	}
	if ae := errno.Extract(err); ae != nil && strings.TrimSpace(ae.Message) != "" {
		msg = ae.Message + " " + ae.Detail
	}
	base := TeachFromError(workbench.CapSyncSSHSecurityGroup, msg)
	low := strings.ToLower(msg)
	switch {
	case strings.Contains(msg, "绑定") || strings.Contains(msg, "缺少云"):
		return Teach{
			Summary: "云绑定或账号不完整", Raw: msg,
			NextSteps: []string{"编辑 SSH 主机完成 ECS 绑定", "核对云账号 AccessKey 是否仍有效"},
		}
	case strings.Contains(low, "forbidden") || strings.Contains(low, "notauthorized") ||
		strings.Contains(msg, "权限") || strings.Contains(low, "unauthorized"):
		return Teach{
			Summary: "AccessKey 权限不够", Raw: msg,
			NextSteps: []string{
				"RAM 需 AuthorizeSecurityGroup / RevokeSecurityGroup / DescribeSecurityGroupAttribute / DescribeInstances",
				"只开了 ECS/CMS 只读时可以看监控，但不能改安全组",
			},
		}
	case strings.Contains(msg, "公网 IP") || strings.Contains(low, "ipify") || strings.Contains(low, "icanhazip"):
		return Teach{
			Summary: "探测本机公网 IP 失败", Raw: msg,
			NextSteps: []string{"检查本机能否访问外网", "稍后重试 sync_ssh_security_group"},
		}
	case strings.Contains(msg, "安全组"):
		return Teach{
			Summary: "安全组读写失败", Raw: msg,
			NextSteps: []string{"在控制台确认实例仍挂着该安全组", "多安全组时可在主机里指定 sgId（后续版本可选）"},
		}
	default:
		return base
	}
}

func suggestedOpsSkill(host *model.SSHHostDO, res model.SecurityGroupSyncResultDO) SuggestedSkill {
	return NewSuggestedSkill(
		"cloud",
		"运维/"+SafeSkillPathSegment(host.Name)+"/家宽IP放行",
		fmt.Sprintf(
			"家宽公网会变。对本机 %s 使用 sync_ssh_security_group（规则 wwb-dynamic-ip，端口 %d）。上次 CIDR=%s，安全组=%s。建议开启 sgSync；目标地址优先用 EIP。",
			res.PublicIP, res.Port, res.CIDR, res.SecurityGroup,
		),
		"这次放行已经跑通。要把做法写进运维 Skill，下次直接复用吗？",
	)
}
