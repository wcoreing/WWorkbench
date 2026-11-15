package homeclient

import (
	"encoding/json"
	"os"
	"path/filepath"
	"strings"
)

// DefaultBaseURL 产品内置账号服务地址（部署韦宁阿里云）。
const DefaultBaseURL = "http://119.23.153.3:51022"

// ResolveBaseURL 解析 Home 地址：环境变量 > ~/.wworkbench/home.json > 内置默认。
func ResolveBaseURL() string {
	if v := strings.TrimSpace(os.Getenv("WWB_HOME_URL")); v != "" {
		return strings.TrimRight(v, "/")
	}
	home, err := os.UserHomeDir()
	if err == nil {
		b, err := os.ReadFile(filepath.Join(home, ".wworkbench", "home.json"))
		if err == nil {
			var cfg struct {
				URL string `json:"url"`
			}
			if json.Unmarshal(b, &cfg) == nil {
				if u := strings.TrimRight(strings.TrimSpace(cfg.URL), "/"); u != "" {
					return u
				}
			}
		}
	}
	return DefaultBaseURL
}
