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

// hostMetrics 主机自身指标。流量另在 netPairs 里选有数据的一对。
var hostMetrics = []struct {
	name string
	unit string
	agg  string
}{
	{"CPUUtilization", "%", "max"},
	{"memory_usedutilization", "%", "max"},
	{"diskusage_utilization", "%", "max"},
}

// netPairs 按优先级尝试：VPC 公网、经典公网、内网。有流量的那一对显示在条上。
var netPairs = [][2]string{
	{"VPC_PublicIP_InternetInRate", "VPC_PublicIP_InternetOutRate"},
	{"InternetInRate", "InternetOutRate"},
	{"IntranetInRate", "IntranetOutRate"},
}

var httpClient = &http.Client{Timeout: 12 * time.Second}

type rawPoint struct {
	Timestamp int64   `json:"timestamp"`
	Average   float64 `json:"Average"`
	Maximum   float64 `json:"Maximum"`
	Value     float64 `json:"Value"`
}

func (p rawPoint) sample() float64 {
	if p.Average != 0 {
		return p.Average
	}
	if p.Value != 0 {
		return p.Value
	}
	return p.Maximum
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

// NormalizeWindowHours 监控时间段：1 / 6 / 24 / 168（7 天）。
func NormalizeWindowHours(hours int) int {
	switch {
	case hours <= 1:
		return 1
	case hours <= 6:
		return 6
	case hours <= 24:
		return 24
	default:
		return 168
	}
}

func windowAndPeriod(hours int) (time.Duration, string) {
	hours = NormalizeWindowHours(hours)
	switch hours {
	case 6:
		return 6 * time.Hour, "60"
	case 24:
		return 24 * time.Hour, "300"
	case 168:
		return 7 * 24 * time.Hour, "900"
	default:
		return time.Hour, "60"
	}
}

// QueryECSMetric 拉取单条 ECS 指标（用于运维分析；UI 仍走 QueryECS）。
func QueryECSMetric(ctx context.Context, accessKeyID, accessKeySecret, region, instanceID, metric string, windowHours int) (model.ECSMetricSeriesDO, error) {
	accessKeyID = strings.TrimSpace(accessKeyID)
	accessKeySecret = strings.TrimSpace(accessKeySecret)
	region = strings.TrimSpace(region)
	instanceID = strings.TrimSpace(instanceID)
	metric = strings.TrimSpace(metric)
	series := model.ECSMetricSeriesDO{Metric: metric, Unit: "bit/s"}
	if accessKeyID == "" || accessKeySecret == "" || region == "" || instanceID == "" || metric == "" {
		series.Error = "缺少参数"
		return series, errno.New(errno.CodeInvalidArg, "缺少云账号、地域、实例或指标名", "")
	}
	windowHours = NormalizeWindowHours(windowHours)
	window, period := windowAndPeriod(windowHours)
	end := time.Now()
	start := end.Add(-window)
	dims, err := json.Marshal([]map[string]string{{"instanceId": instanceID}})
	if err != nil {
		series.Error = err.Error()
		return series, err
	}
	points, qerr := describeMetric(ctx, accessKeyID, accessKeySecret, region, "acs_ecs_dashboard", metric, string(dims), start, end, period)
	if qerr != nil {
		series.Error = metricErr(qerr)
		return series, qerr
	}
	series.Points = aggregate(points, "sum")
	if n := len(series.Points); n > 0 {
		series.Latest = series.Points[n-1].Value
	}
	return series, nil
}

// QueryECS 拉取一台 ECS 指定时间段的云监控。单条指标失败不影响其余指标。
func QueryECS(ctx context.Context, accessKeyID, accessKeySecret, region, instanceID string, windowHours int) (model.ECSMonitorDO, error) {
	accessKeyID = strings.TrimSpace(accessKeyID)
	accessKeySecret = strings.TrimSpace(accessKeySecret)
	region = strings.TrimSpace(region)
	instanceID = strings.TrimSpace(instanceID)
	if accessKeyID == "" || accessKeySecret == "" || region == "" || instanceID == "" {
		return model.ECSMonitorDO{}, errno.New(errno.CodeInvalidArg, "缺少云账号、地域或实例 ID", "")
	}
	windowHours = NormalizeWindowHours(windowHours)
	window, period := windowAndPeriod(windowHours)
	end := time.Now()
	start := end.Add(-window)
	dims, err := json.Marshal([]map[string]string{{"instanceId": instanceID}})
	if err != nil {
		return model.ECSMonitorDO{}, errno.Wrap(errno.CodeInvalidArg, "组装监控维度失败", err)
	}
	names := make([]string, 0, len(hostMetrics)+len(netPairs)*2)
	for _, m := range hostMetrics {
		names = append(names, m.name)
	}
	for _, pair := range netPairs {
		names = append(names, pair[0], pair[1])
	}
	out := model.ECSMonitorDO{
		InstanceID:  instanceID,
		Region:      region,
		FetchedAt:   end.Unix(),
		WindowHours: windowHours,
	}
	type result struct {
		name   string
		series model.ECSMetricSeriesDO
	}
	ch := make(chan result, len(names))
	unitOf := func(name string) string {
		for _, m := range hostMetrics {
			if m.name == name {
				return m.unit
			}
		}
		return "bit/s"
	}
	aggOf := func(name string) string {
		for _, m := range hostMetrics {
			if m.name == name {
				return m.agg
			}
		}
		return "sum"
	}
	for _, name := range names {
		go func(name string) {
			series := model.ECSMetricSeriesDO{Metric: name, Unit: unitOf(name)}
			points, qerr := describeMetric(ctx, accessKeyID, accessKeySecret, region, "acs_ecs_dashboard", name, string(dims), start, end, period)
			if qerr != nil {
				series.Error = metricErr(qerr)
			} else {
				series.Points = aggregate(points, aggOf(name))
				if n := len(series.Points); n > 0 {
					series.Latest = series.Points[n-1].Value
				}
			}
			ch <- result{name: name, series: series}
		}(name)
	}
	got := map[string]model.ECSMetricSeriesDO{}
	for range names {
		r := <-ch
		got[r.name] = r.series
	}
	out.Series = make([]model.ECSMetricSeriesDO, 0, len(hostMetrics)+2)
	for _, m := range hostMetrics {
		out.Series = append(out.Series, got[m.name])
	}
	in, outNet := pickNetPair(got)
	out.Series = append(out.Series, in, outNet)
	cpuOK := false
	memEmpty := false
	diskEmpty := false
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

// pickNetPair 按 netPairs 优先级选：VPC 公网 → 经典公网 → 内网。
// 只要该对有数据点就用（哪怕当前是 0），避免「内网尖峰更大」时把外网挤掉。
// 公网都无点时才退内网；全都没有则仍回 VPC 公网占位。
func pickNetPair(got map[string]model.ECSMetricSeriesDO) (model.ECSMetricSeriesDO, model.ECSMetricSeriesDO) {
	for _, pair := range netPairs {
		in, out := got[pair[0]], got[pair[1]]
		if seriesUsable(in) || seriesUsable(out) {
			return in, out
		}
	}
	return got[netPairs[0][0]], got[netPairs[0][1]]
}

func seriesUsable(s model.ECSMetricSeriesDO) bool {
	return s.Error == "" && len(s.Points) > 0
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

func describeMetric(ctx context.Context, ak, secret, region, namespace, metric, dimensions string, start, end time.Time, period string) ([]rawPoint, error) {
	loc := time.UTC
	if strings.HasPrefix(region, "cn-") {
		loc = time.FixedZone("CST", 8*3600)
	}
	if strings.TrimSpace(period) == "" {
		period = "60"
	}
	if strings.TrimSpace(namespace) == "" {
		namespace = "acs_ecs_dashboard"
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
		"Namespace":        namespace,
		"MetricName":       metric,
		"Dimensions":       dimensions,
		"StartTime":        start.In(loc).Format("2006-01-02 15:04:05"),
		"EndTime":          end.In(loc).Format("2006-01-02 15:04:05"),
		"Period":           period,
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
			byTS[p.Timestamp] = p.sample()
			if _, dup := seen[p.Timestamp]; !dup {
				order = append(order, p.Timestamp)
				seen[p.Timestamp] = struct{}{}
			}
			continue
		}
		if mode == "sum" {
			byTS[p.Timestamp] = prev + p.sample()
		} else if p.sample() > prev {
			byTS[p.Timestamp] = p.sample()
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
