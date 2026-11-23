package aliyuncms

import (
	"context"
	"io"
	"net"
	"net/http"
	"regexp"
	"strings"
	"time"

	"WWorkbench/internal/errno"
)

// 国内优先：连阿里云国内 ECS 时，SSH 通常走家宽直连；ipify 等海外源在开 VPN 时会写成代理出口。
var publicIPEndpointsCN = []string{
	"https://4.ipw.cn",
	"https://ip.3322.net",
	"https://ddns.oray.com/checkip",
	"https://myip.ipip.net",
}

var publicIPEndpointsGlobal = []string{
	"https://api.ipify.org",
	"https://ifconfig.me/ip",
	"https://icanhazip.com",
}

var ipv4RE = regexp.MustCompile(`\b(?:(?:25[0-5]|2[0-4]\d|[01]?\d\d?)\.){3}(?:25[0-5]|2[0-4]\d|[01]?\d\d?)\b`)

// LookupPublicIP 探测本机当前公网 IPv4（国内源优先，降低 VPN 误写代理出口）。
func LookupPublicIP(ctx context.Context) (string, error) {
	client := &http.Client{Timeout: 5 * time.Second}
	cnIP, cnErr := firstPublicIP(ctx, client, publicIPEndpointsCN)
	if cnIP != "" {
		globalIP, _ := firstPublicIP(ctx, client, publicIPEndpointsGlobal)
		if globalIP != "" && globalIP != cnIP {
			// 国内/海外出口不一致：连国内 ECS 用国内探测结果（家宽）；Message 由调用方拼。
			return cnIP, nil
		}
		return cnIP, nil
	}
	globalIP, globalErr := firstPublicIP(ctx, client, publicIPEndpointsGlobal)
	if globalIP != "" {
		return globalIP, nil
	}
	last := cnErr
	if last == nil {
		last = globalErr
	}
	if last == nil {
		last = errno.New(errno.CodeConnFailed, "无法获取本机公网 IP", "")
	}
	return "", last
}

func firstPublicIP(ctx context.Context, client *http.Client, endpoints []string) (string, error) {
	var last error
	for _, endpoint := range endpoints {
		ip, err := fetchPublicIP(ctx, client, endpoint)
		if err == nil {
			return ip, nil
		}
		last = err
	}
	return "", last
}

func fetchPublicIP(ctx context.Context, client *http.Client, endpoint string) (string, error) {
	req, err := http.NewRequestWithContext(ctx, http.MethodGet, endpoint, nil)
	if err != nil {
		return "", err
	}
	req.Header.Set("User-Agent", "WWorkbench/1.0")
	resp, err := client.Do(req)
	if err != nil {
		return "", errno.Wrap(errno.CodeConnFailed, "探测公网 IP 失败", err)
	}
	defer resp.Body.Close()
	body, err := io.ReadAll(io.LimitReader(resp.Body, 4<<10))
	if err != nil {
		return "", errno.Wrap(errno.CodeConnFailed, "读取公网 IP 失败", err)
	}
	ip := extractIPv4(string(body))
	if ip == "" {
		return "", errno.New(errno.CodeConnFailed, "公网 IP 无效", strings.TrimSpace(string(body)))
	}
	return ip, nil
}

func extractIPv4(raw string) string {
	raw = strings.TrimSpace(raw)
	if ip := net.ParseIP(raw); ip != nil && ip.To4() != nil {
		return ip.String()
	}
	m := ipv4RE.FindString(raw)
	if m == "" {
		return ""
	}
	if ip := net.ParseIP(m); ip != nil && ip.To4() != nil {
		return ip.String()
	}
	return ""
}
