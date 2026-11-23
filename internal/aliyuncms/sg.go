package aliyuncms

import (
	"context"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"strings"
	"time"

	"WWorkbench/internal/errno"

	"github.com/google/uuid"
)

// ManagedRuleDescription 工作台写入安全组规则的标记，只改自己的规则。
const ManagedRuleDescription = "wwb-dynamic-ip"

// SyncHomeIPResult 本机 IP 同步到安全组的结果。
type SyncHomeIPResult struct {
	PublicIP       string `json:"publicIp"`
	CIDR           string `json:"cidr"`
	SecurityGroup  string `json:"securityGroupId"`
	Port           int    `json:"port"`
	Skipped        bool   `json:"skipped"`
	RevokedOldCIDR string `json:"revokedOldCidr,omitempty"`
	Message        string `json:"message"`
}

// SyncHomeIPToSecurityGroup 把本机公网 IP/32 放行到 ECS 安全组的 SSH 端口。
// 只维护 Description=wwb-dynamic-ip 的规则；先放行新 IP，再撤掉旧 IP。
func SyncHomeIPToSecurityGroup(ctx context.Context, accessKeyID, accessKeySecret, region, instanceID, preferredSG string, port int, lastCIDR string) (SyncHomeIPResult, error) {
	accessKeyID = strings.TrimSpace(accessKeyID)
	accessKeySecret = strings.TrimSpace(accessKeySecret)
	region = strings.TrimSpace(region)
	instanceID = strings.TrimSpace(instanceID)
	preferredSG = strings.TrimSpace(preferredSG)
	lastCIDR = strings.TrimSpace(lastCIDR)
	if accessKeyID == "" || accessKeySecret == "" || region == "" || instanceID == "" {
		return SyncHomeIPResult{}, errno.New(errno.CodeInvalidArg, "缺少云账号、地域或实例", "")
	}
	if port <= 0 {
		port = 22
	}
	ip, err := LookupPublicIP(ctx)
	if err != nil {
		return SyncHomeIPResult{}, err
	}
	cidr := ip + "/32"
	out := SyncHomeIPResult{PublicIP: ip, CIDR: cidr, Port: port}
	vpnHint := publicIPMismatchHint(ctx, ip)
	if cidr == lastCIDR {
		out.Skipped = true
		out.Message = "本机 IP 未变化（" + ip + "），安全组不用改"
		if vpnHint != "" {
			out.Message += "。" + vpnHint
		}
		if preferredSG != "" {
			out.SecurityGroup = preferredSG
		}
		return out, nil
	}
	sgs, err := instanceSecurityGroups(ctx, accessKeyID, accessKeySecret, region, instanceID)
	if err != nil {
		return out, err
	}
	if len(sgs) == 0 {
		return out, errno.New(errno.CodeInvalidArg, "这台 ECS 没有安全组", instanceID)
	}
	sgID := preferredSG
	if sgID == "" {
		sgID = sgs[0]
	} else {
		ok := false
		for _, id := range sgs {
			if id == sgID {
				ok = true
				break
			}
		}
		if !ok {
			return out, errno.New(errno.CodeInvalidArg, "指定的安全组不属于这台 ECS", sgID)
		}
	}
	out.SecurityGroup = sgID
	if err := authorizeIngress(ctx, accessKeyID, accessKeySecret, region, sgID, cidr, port); err != nil {
		// 规则已存在时阿里云会报 InvalidPermission.Duplicate，视为成功。
		if !isDuplicatePermission(err) {
			return out, err
		}
	}
	old := lastCIDR
	if old == "" || old == cidr {
		old = findManagedCIDR(ctx, accessKeyID, accessKeySecret, region, sgID, port, cidr)
	}
	if old != "" && old != cidr {
		if err := revokeIngress(ctx, accessKeyID, accessKeySecret, region, sgID, old, port); err != nil {
			out.Message = "已放行 " + cidr + "，但撤掉旧规则失败：" + err.Error()
			return out, nil
		}
		out.RevokedOldCIDR = old
	}
	out.Message = "已把本机 IP " + ip + " 写入安全组"
	if vpnHint != "" {
		out.Message += "。" + vpnHint
	}
	return out, nil
}

// publicIPMismatchHint 国内/海外探测不一致时提示（常见于开着 VPN）。
func publicIPMismatchHint(ctx context.Context, chosen string) string {
	client := &http.Client{Timeout: 4 * time.Second}
	other, _ := firstPublicIP(ctx, client, publicIPEndpointsGlobal)
	if other == "" || other == chosen {
		return ""
	}
	return "另探测到海外出口 " + other + "；已优先国内源。若 SSH 仍超时，请关掉 VPN 后再点「立即写入安全组」"
}

func isDuplicatePermission(err error) bool {
	if err == nil {
		return false
	}
	msg := err.Error()
	return strings.Contains(msg, "InvalidPermission.Duplicate") || strings.Contains(msg, "already exists")
}

func findManagedCIDR(ctx context.Context, ak, secret, region, sgID string, port int, skip string) string {
	perms, err := describeSGPermissions(ctx, ak, secret, region, sgID)
	if err != nil {
		return ""
	}
	portRange := fmt.Sprintf("%d/%d", port, port)
	for _, p := range perms {
		if !strings.EqualFold(p.Description, ManagedRuleDescription) {
			continue
		}
		if !strings.EqualFold(p.IpProtocol, "tcp") {
			continue
		}
		if p.PortRange != portRange && p.PortRange != "1/65535" {
			continue
		}
		cidr := strings.TrimSpace(p.SourceCidrIP)
		if cidr != "" && cidr != skip {
			return cidr
		}
	}
	return ""
}

func instanceSecurityGroups(ctx context.Context, ak, secret, region, instanceID string) ([]string, error) {
	params := map[string]string{
		"Format":           "JSON",
		"Version":          "2014-05-26",
		"AccessKeyId":      ak,
		"SignatureMethod":  "HMAC-SHA1",
		"SignatureVersion": "1.0",
		"SignatureNonce":   uuid.NewString(),
		"Timestamp":        time.Now().UTC().Format("2006-01-02T15:04:05Z"),
		"Action":           "DescribeInstances",
		"RegionId":         region,
		"InstanceIds":      `["` + instanceID + `"]`,
	}
	body, err := ecsGET(ctx, region, secret, params)
	if err != nil {
		return nil, err
	}
	var env struct {
		Code      json.RawMessage `json:"Code"`
		Message   string          `json:"Message"`
		Instances struct {
			Instance []struct {
				SecurityGroupIds struct {
					SecurityGroupID []string `json:"SecurityGroupId"`
				} `json:"SecurityGroupIds"`
			} `json:"Instance"`
		} `json:"Instances"`
	}
	if err := json.Unmarshal(body, &env); err != nil {
		return nil, errno.Wrap(errno.CodeConnFailed, "解析 ECS 安全组失败", err)
	}
	if code := strings.Trim(strings.TrimSpace(string(env.Code)), `"`); code != "" && code != "200" {
		msg := strings.TrimSpace(env.Message)
		if msg == "" {
			msg = "读取 ECS 安全组失败"
		}
		return nil, errno.New(errno.CodeConnFailed, msg, code)
	}
	if len(env.Instances.Instance) == 0 {
		return nil, errno.New(errno.CodeNotFound, "找不到 ECS 实例", instanceID)
	}
	return env.Instances.Instance[0].SecurityGroupIds.SecurityGroupID, nil
}

type sgPermission struct {
	IpProtocol   string `json:"IpProtocol"`
	PortRange    string `json:"PortRange"`
	SourceCidrIP string `json:"SourceCidrIp"`
	Description  string `json:"Description"`
	Direction    string `json:"Direction"`
	Policy       string `json:"Policy"`
	Priority     string `json:"Priority"`
	NicType      string `json:"NicType"`
}

func describeSGPermissions(ctx context.Context, ak, secret, region, sgID string) ([]sgPermission, error) {
	params := map[string]string{
		"Format":           "JSON",
		"Version":          "2014-05-26",
		"AccessKeyId":      ak,
		"SignatureMethod":  "HMAC-SHA1",
		"SignatureVersion": "1.0",
		"SignatureNonce":   uuid.NewString(),
		"Timestamp":        time.Now().UTC().Format("2006-01-02T15:04:05Z"),
		"Action":           "DescribeSecurityGroupAttribute",
		"RegionId":         region,
		"SecurityGroupId":  sgID,
		"Direction":        "ingress",
	}
	body, err := ecsGET(ctx, region, secret, params)
	if err != nil {
		return nil, err
	}
	var env struct {
		Code        json.RawMessage `json:"Code"`
		Message     string          `json:"Message"`
		Permissions struct {
			Permission []sgPermission `json:"Permission"`
		} `json:"Permissions"`
	}
	if err := json.Unmarshal(body, &env); err != nil {
		return nil, errno.Wrap(errno.CodeConnFailed, "解析安全组规则失败", err)
	}
	if code := strings.Trim(strings.TrimSpace(string(env.Code)), `"`); code != "" && code != "200" {
		msg := strings.TrimSpace(env.Message)
		if msg == "" {
			msg = "读取安全组规则失败"
		}
		return nil, errno.New(errno.CodeConnFailed, msg, code)
	}
	return env.Permissions.Permission, nil
}

func authorizeIngress(ctx context.Context, ak, secret, region, sgID, cidr string, port int) error {
	params := map[string]string{
		"Format":           "JSON",
		"Version":          "2014-05-26",
		"AccessKeyId":      ak,
		"SignatureMethod":  "HMAC-SHA1",
		"SignatureVersion": "1.0",
		"SignatureNonce":   uuid.NewString(),
		"Timestamp":        time.Now().UTC().Format("2006-01-02T15:04:05Z"),
		"Action":           "AuthorizeSecurityGroup",
		"RegionId":         region,
		"SecurityGroupId":  sgID,
		"IpProtocol":       "tcp",
		"PortRange":        fmt.Sprintf("%d/%d", port, port),
		"SourceCidrIp":     cidr,
		"Policy":           "accept",
		"Priority":         "1",
		"NicType":          "intranet",
		"Description":      ManagedRuleDescription,
	}
	return ecsMutate(ctx, region, secret, params, "写入安全组失败")
}

func revokeIngress(ctx context.Context, ak, secret, region, sgID, cidr string, port int) error {
	params := map[string]string{
		"Format":           "JSON",
		"Version":          "2014-05-26",
		"AccessKeyId":      ak,
		"SignatureMethod":  "HMAC-SHA1",
		"SignatureVersion": "1.0",
		"SignatureNonce":   uuid.NewString(),
		"Timestamp":        time.Now().UTC().Format("2006-01-02T15:04:05Z"),
		"Action":           "RevokeSecurityGroup",
		"RegionId":         region,
		"SecurityGroupId":  sgID,
		"IpProtocol":       "tcp",
		"PortRange":        fmt.Sprintf("%d/%d", port, port),
		"SourceCidrIp":     cidr,
		"NicType":          "intranet",
		"Policy":           "accept",
	}
	return ecsMutate(ctx, region, secret, params, "撤销安全组旧规则失败")
}

func ecsMutate(ctx context.Context, region, secret string, params map[string]string, failMsg string) error {
	body, err := ecsGET(ctx, region, secret, params)
	if err != nil {
		return err
	}
	var env struct {
		Code      json.RawMessage `json:"Code"`
		Message   string          `json:"Message"`
		RequestID string          `json:"RequestId"`
	}
	if err := json.Unmarshal(body, &env); err != nil {
		return errno.Wrap(errno.CodeConnFailed, failMsg, err)
	}
	code := strings.Trim(strings.TrimSpace(string(env.Code)), `"`)
	if code != "" && code != "200" {
		msg := strings.TrimSpace(env.Message)
		if msg == "" {
			msg = failMsg
		}
		return errno.New(errno.CodeConnFailed, msg, firstNonEmpty(code, env.RequestID))
	}
	return nil
}

func ecsGET(ctx context.Context, region, secret string, params map[string]string) ([]byte, error) {
	endpoint := "https://ecs." + region + ".aliyuncs.com/?" + signedQuery(params, secret)
	req, err := http.NewRequestWithContext(ctx, http.MethodGet, endpoint, nil)
	if err != nil {
		return nil, errno.Wrap(errno.CodeConnFailed, "创建 ECS 请求失败", err)
	}
	resp, err := httpClient.Do(req)
	if err != nil {
		return nil, errno.Wrap(errno.CodeConnFailed, "请求 ECS 失败", err)
	}
	defer resp.Body.Close()
	body, err := io.ReadAll(io.LimitReader(resp.Body, 2<<20))
	if err != nil {
		return nil, errno.Wrap(errno.CodeConnFailed, "读取 ECS 响应失败", err)
	}
	return body, nil
}
