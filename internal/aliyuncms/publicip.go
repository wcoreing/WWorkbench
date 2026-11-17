package aliyuncms

import (
	"context"
	"io"
	"net"
	"net/http"
	"strings"
	"time"

	"WWorkbench/internal/errno"
)

var publicIPEndpoints = []string{
	"https://api.ipify.org",
	"https://ifconfig.me/ip",
	"https://icanhazip.com",
}

// LookupPublicIP 探测本机当前公网 IPv4。
func LookupPublicIP(ctx context.Context) (string, error) {
	client := &http.Client{Timeout: 5 * time.Second}
	var last error
	for _, endpoint := range publicIPEndpoints {
		ip, err := fetchPublicIP(ctx, client, endpoint)
		if err == nil {
			return ip, nil
		}
		last = err
	}
	if last == nil {
		last = errno.New(errno.CodeConnFailed, "无法获取本机公网 IP", "")
	}
	return "", last
}

func fetchPublicIP(ctx context.Context, client *http.Client, endpoint string) (string, error) {
	req, err := http.NewRequestWithContext(ctx, http.MethodGet, endpoint, nil)
	if err != nil {
		return "", err
	}
	resp, err := client.Do(req)
	if err != nil {
		return "", errno.Wrap(errno.CodeConnFailed, "探测公网 IP 失败", err)
	}
	defer resp.Body.Close()
	body, err := io.ReadAll(io.LimitReader(resp.Body, 64))
	if err != nil {
		return "", errno.Wrap(errno.CodeConnFailed, "读取公网 IP 失败", err)
	}
	ip := strings.TrimSpace(string(body))
	if net.ParseIP(ip) == nil || strings.Contains(ip, ":") {
		return "", errno.New(errno.CodeConnFailed, "公网 IP 无效", ip)
	}
	return ip, nil
}
