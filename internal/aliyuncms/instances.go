package aliyuncms

import (
	"context"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"sort"
	"strings"
	"time"

	"WWorkbench/internal/errno"
	"WWorkbench/internal/model"

	"github.com/google/uuid"
)

const (
	instancePageSize = 100
	instanceMaxPages = 5
)

// ListInstances 列出一个地域下的 ECS，供绑定主机时点选。
func ListInstances(ctx context.Context, accessKeyID, accessKeySecret, region string) ([]model.ECSInstanceDO, error) {
	accessKeyID = strings.TrimSpace(accessKeyID)
	accessKeySecret = strings.TrimSpace(accessKeySecret)
	region = strings.TrimSpace(region)
	if accessKeyID == "" || accessKeySecret == "" || region == "" {
		return nil, errno.New(errno.CodeInvalidArg, "缺少云账号或地域", "")
	}
	var out []model.ECSInstanceDO
	for page := 1; page <= instanceMaxPages; page++ {
		batch, total, err := describeInstancesPage(ctx, accessKeyID, accessKeySecret, region, page)
		if err != nil {
			return nil, err
		}
		out = append(out, batch...)
		if len(batch) == 0 || len(out) >= total {
			break
		}
	}
	sort.Slice(out, func(i, j int) bool {
		if out[i].Name == out[j].Name {
			return out[i].InstanceID < out[j].InstanceID
		}
		return out[i].Name < out[j].Name
	})
	return out, nil
}

type ecsListEnvelope struct {
	Code       json.RawMessage `json:"Code"`
	Message    string          `json:"Message"`
	TotalCount int             `json:"TotalCount"`
	Instances  struct {
		Instance []ecsInstance `json:"Instance"`
	} `json:"Instances"`
}

type ecsInstance struct {
	InstanceID   string `json:"InstanceId"`
	InstanceName string `json:"InstanceName"`
	Status       string `json:"Status"`
	PublicIP     struct {
		IPAddress []string `json:"IpAddress"`
	} `json:"PublicIpAddress"`
	InnerIP struct {
		IPAddress []string `json:"IpAddress"`
	} `json:"InnerIpAddress"`
	EipAddress struct {
		IPAddress string `json:"IpAddress"`
	} `json:"EipAddress"`
	VpcAttributes struct {
		PrivateIP struct {
			IPAddress []string `json:"IpAddress"`
		} `json:"PrivateIpAddress"`
	} `json:"VpcAttributes"`
}

func describeInstancesPage(ctx context.Context, ak, secret, region string, page int) ([]model.ECSInstanceDO, int, error) {
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
		"PageNumber":       fmt.Sprintf("%d", page),
		"PageSize":         fmt.Sprintf("%d", instancePageSize),
	}
	endpoint := "https://ecs." + region + ".aliyuncs.com/?" + signedQuery(params, secret)
	req, err := http.NewRequestWithContext(ctx, http.MethodGet, endpoint, nil)
	if err != nil {
		return nil, 0, errno.Wrap(errno.CodeConnFailed, "创建 ECS 列表请求失败", err)
	}
	resp, err := httpClient.Do(req)
	if err != nil {
		return nil, 0, errno.Wrap(errno.CodeConnFailed, "请求 ECS 列表失败", err)
	}
	defer resp.Body.Close()
	body, err := io.ReadAll(io.LimitReader(resp.Body, 2<<20))
	if err != nil {
		return nil, 0, errno.Wrap(errno.CodeConnFailed, "读取 ECS 列表失败", err)
	}
	var env ecsListEnvelope
	if err := json.Unmarshal(body, &env); err != nil {
		return nil, 0, errno.Wrap(errno.CodeConnFailed, "解析 ECS 列表失败", fmt.Errorf("status %d: %s", resp.StatusCode, truncate(body)))
	}
	code := strings.Trim(strings.TrimSpace(string(env.Code)), `"`)
	if code != "" && code != "200" {
		msg := strings.TrimSpace(env.Message)
		if msg == "" {
			msg = "列出 ECS 失败"
		}
		return nil, 0, errno.New(errno.CodeConnFailed, msg, code)
	}
	out := make([]model.ECSInstanceDO, 0, len(env.Instances.Instance))
	for _, item := range env.Instances.Instance {
		out = append(out, model.ECSInstanceDO{
			InstanceID: item.InstanceID,
			Name:       item.InstanceName,
			Status:     item.Status,
			PublicIP:   firstNonEmpty(item.EipAddress.IPAddress, firstOf(item.PublicIP.IPAddress)),
			PrivateIP:  firstNonEmpty(firstOf(item.VpcAttributes.PrivateIP.IPAddress), firstOf(item.InnerIP.IPAddress)),
		})
	}
	total := env.TotalCount
	if total == 0 {
		total = len(out)
	}
	return out, total, nil
}

func firstOf(ips []string) string {
	if len(ips) == 0 {
		return ""
	}
	return strings.TrimSpace(ips[0])
}

func firstNonEmpty(values ...string) string {
	for _, v := range values {
		if strings.TrimSpace(v) != "" {
			return strings.TrimSpace(v)
		}
	}
	return ""
}
