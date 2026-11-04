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

const metricWindow = time.Hour

// ecsMetrics 终端条上展示的指标。agg=max 取同一时刻多盘/多核里的高值，agg=sum 把多网卡带宽相加。
var ecsMetrics = []struct {
	name string
	unit string
	agg  string
}{
	{"CPUUtilization", "%", "max"},
	{"memory_usedutilization", "%", "max"},
	{"diskusage_utilization", "%", "max"},
	{"InternetInRate", "bit/s", "sum"},
	{"InternetOutRate", "bit/s", "sum"},
}

var httpClient = &http.Client{Timeout: 12 * time.Second}

type rawPoint struct {
	Timestamp int64   `json:"timestamp"`
	Average   float64 `json:"Average"`
}

type cmsEnvelope struct {
	Code       json.RawMessage `json:"Code"`
	Message    string          `json:"Message"`
	Success    bool            `json:"Success"`
	Datapoints string          `json:"Datapoints"`
	RequestID  string          `json:"RequestId"`
}

func (e cmsEnvelope) code() string {
	return strings.Trim(strings.TrimSpace(string(e.Code)), `"`)
}

// QueryECS 拉取一台 ECS 最近一小时的云监控。单条指标失败不影响其余指标。
func QueryECS(ctx context.Context, accessKeyID, accessKeySecret, region, instanceID string) (model.ECSMonitorDO, error) {
	accessKeyID = strings.TrimSpace(accessKeyID)
	accessKeySecret = strings.TrimSpace(accessKeySecret)
	region = strings.TrimSpace(region)
	instanceID = strings.TrimSpace(instanceID)
	if accessKeyID == "" || accessKeySecret == "" || region == "" || instanceID == "" {
		return model.ECSMonitorDO{}, errno.New(errno.CodeInvalidArg, "缺少云账号、地域或实例 ID", "")
	}
	end := time.Now()
	start := end.Add(-metricWindow)
	dims, err := json.Marshal([]map[string]string{{"instanceId": instanceID}})
	if err != nil {
		return model.ECSMonitorDO{}, errno.Wrap(errno.CodeInvalidArg, "组装监控维度失败", err)
	}
	out := model.ECSMonitorDO{
		InstanceID: instanceID,
		Region:     region,
		FetchedAt:  end.Unix(),
		Series:     make([]model.ECSMetricSeriesDO, len(ecsMetrics)),
	}
	type result struct {
		idx    int
		series model.ECSMetricSeriesDO
	}
	ch := make(chan result, len(ecsMetrics))
	for i, m := range ecsMetrics {
		go func(i int, name, unit, agg string) {
			series := model.ECSMetricSeriesDO{Metric: name, Unit: unit}
			points, qerr := describeMetric(ctx, accessKeyID, accessKeySecret, region, name, string(dims), start, end)
			if qerr != nil {
				series.Error = metricErr(qerr)
			} else {
				series.Points = aggregate(points, agg)
				if n := len(series.Points); n > 0 {
					series.Latest = series.Points[n-1].Value
				}
			}
			ch <- result{idx: i, series: series}
		}(i, m.name, m.unit, m.agg)
	}
	cpuOK := false
	memEmpty := false
	diskEmpty := false
	for range ecsMetrics {
		r := <-ch
		out.Series[r.idx] = r.series
	}
	for _, s := range out.Series {
		switch s.Metric {
		case "CPUUtilization":
			cpuOK = s.Error == "" && len(s.Points) > 0
		case "memory_usedutilization":
			memEmpty = s.Error == "" && len(s.Points) == 0
		case "diskusage_utilization":
			diskEmpty = s.Error == "" && len(s.Points) == 0
		}
	}
	if cpuOK && memEmpty && diskEmpty {
		out.Hint = "内存和磁盘没有数据，多半是这台 ECS 没装云监控插件。CPU 和公网带宽不依赖插件。"
	}
	if failed, msg := allFailed(out.Series); failed {
		return out, errno.New(errno.CodeConnFailed, msg, "")
	}
	return out, nil
}

func metricErr(err error) string {
	if ae := errno.Extract(err); ae != nil && ae.Message != "" {
		return ae.Message
	}
	return err.Error()
}

func allFailed(series []model.ECSMetricSeriesDO) (bool, string) {
	msg := ""
	for _, s := range series {
		if s.Error == "" {
			return false, ""
		}
		if msg == "" {
			msg = s.Error
		}
	}
	if msg == "" {
		msg = "云监控没有返回数据"
	}
	return true, msg
}

func describeMetric(ctx context.Context, ak, secret, region, metric, dimensions string, start, end time.Time) ([]rawPoint, error) {
	loc := time.UTC
	if strings.HasPrefix(region, "cn-") {
		loc = time.FixedZone("CST", 8*3600)
	}
	params := map[string]string{
		"Format":           "JSON",
		"Version":          "2019-01-01",
		"AccessKeyId":      ak,
		"SignatureMethod":  "HMAC-SHA1",
		"SignatureVersion": "1.0",
		"SignatureNonce":   uuid.NewString(),
		"Timestamp":        time.Now().UTC().Format("2006-01-02T15:04:05Z"),
		"Action":           "DescribeMetricList",
		"Namespace":        "acs_ecs_dashboard",
		"MetricName":       metric,
		"Dimensions":       dimensions,
		"StartTime":        start.In(loc).Format("2006-01-02 15:04:05"),
		"EndTime":          end.In(loc).Format("2006-01-02 15:04:05"),
		"Period":           "60",
	}
	endpoint := "https://metrics." + region + ".aliyuncs.com/?" + signedQuery(params, secret)
	req, err := http.NewRequestWithContext(ctx, http.MethodGet, endpoint, nil)
	if err != nil {
		return nil, errno.Wrap(errno.CodeConnFailed, "创建云监控请求失败", err)
	}
	resp, err := httpClient.Do(req)
	if err != nil {
		return nil, errno.Wrap(errno.CodeConnFailed, "请求云监控失败", err)
	}
	defer resp.Body.Close()
	body, err := io.ReadAll(io.LimitReader(resp.Body, 1<<20))
	if err != nil {
		return nil, errno.Wrap(errno.CodeConnFailed, "读取云监控响应失败", err)
	}
	var env cmsEnvelope
	if err := json.Unmarshal(body, &env); err != nil {
		return nil, errno.Wrap(errno.CodeConnFailed, "解析云监控响应失败", fmt.Errorf("status %d: %s", resp.StatusCode, truncate(body)))
	}
	if !(env.Success || env.code() == "200") {
		msg := strings.TrimSpace(env.Message)
		if msg == "" {
			msg = "云监控拒绝了请求"
		}
		return nil, errno.New(errno.CodeConnFailed, msg, env.RequestID)
	}
	if strings.TrimSpace(env.Datapoints) == "" || env.Datapoints == "[]" {
		return nil, nil
	}
	var points []rawPoint
	if err := json.Unmarshal([]byte(env.Datapoints), &points); err != nil {
		return nil, errno.Wrap(errno.CodeConnFailed, "解析监控数据点失败", err)
	}
	return points, nil
}

func aggregate(points []rawPoint, mode string) []model.ECSMetricPointDO {
	if len(points) == 0 {
		return nil
	}
	order := make([]int64, 0, len(points))
	byTS := make(map[int64]float64, len(points))
	seen := make(map[int64]struct{}, len(points))
	for _, p := range points {
		prev, ok := byTS[p.Timestamp]
		if !ok {
			byTS[p.Timestamp] = p.Average
			if _, dup := seen[p.Timestamp]; !dup {
				order = append(order, p.Timestamp)
				seen[p.Timestamp] = struct{}{}
			}
			continue
		}
		if mode == "sum" {
			byTS[p.Timestamp] = prev + p.Average
		} else if p.Average > prev {
			byTS[p.Timestamp] = p.Average
		}
	}
	sort.Slice(order, func(i, j int) bool { return order[i] < order[j] })
	out := make([]model.ECSMetricPointDO, 0, len(order))
	for _, ts := range order {
		out = append(out, model.ECSMetricPointDO{Timestamp: ts, Value: byTS[ts]})
	}
	return out
}

func truncate(b []byte) string {
	s := string(b)
	if len(s) > 180 {
		return s[:180]
	}
	return s
}
