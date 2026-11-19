package aliyuncms

import (
	"context"
	"crypto/hmac"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"encoding/xml"
	"fmt"
	"io"
	"net/http"
	"strings"
	"time"

	"WWorkbench/internal/errno"
	"WWorkbench/internal/model"
)

// ossDirMetrics 同城 ECS↔OSS 走内网；公网另计。条上汇总为 OSS_In / OSS_Out（bps）。
var ossDirMetrics = []struct {
	metric string // 输出到 UI 的统一名
	cms    []string
}{
	{"OSS_In", []string{"IntranetRecvBandwidth", "InternetRecvBandwidth"}},
	{"OSS_Out", []string{"IntranetSendBandwidth", "InternetSendBandwidth"}},
}

type ossListBucketsXML struct {
	Buckets []struct {
		Name     string `xml:"Name"`
		Location string `xml:"Location"`
	} `xml:"Buckets>Bucket"`
}

// QueryOSS 拉取某地域各 Bucket 汇总的 OSS 入/出带宽（内网+公网，云监控 acs_oss_dashboard）。
func QueryOSS(ctx context.Context, accessKeyID, accessKeySecret, region string, windowHours int) (model.OSSMonitorDO, error) {
	accessKeyID = strings.TrimSpace(accessKeyID)
	accessKeySecret = strings.TrimSpace(accessKeySecret)
	region = strings.TrimSpace(region)
	out := model.OSSMonitorDO{Region: region, FetchedAt: time.Now().Unix()}
	if accessKeyID == "" || accessKeySecret == "" || region == "" {
		return out, errno.New(errno.CodeInvalidArg, "缺少云账号或地域", "")
	}
	windowHours = NormalizeWindowHours(windowHours)
	out.WindowHours = windowHours
	window, period := windowAndPeriod(windowHours)
	end := time.Now()
	start := end.Add(-window)

	buckets, err := listOSSBuckets(ctx, accessKeyID, accessKeySecret, region)
	if err != nil {
		return out, err
	}
	out.Buckets = buckets
	if len(buckets) == 0 {
		out.Hint = "该地域没有 Bucket，或 AccessKey 列不出 OSS"
		out.Series = []model.ECSMetricSeriesDO{}
		return out, nil
	}

	out.Series = make([]model.ECSMetricSeriesDO, 0, len(ossDirMetrics))
	for _, dir := range ossDirMetrics {
		series := model.ECSMetricSeriesDO{Metric: dir.metric, Unit: "bit/s"}
		var all []rawPoint
		var lastErr error
		okCalls := 0
		for _, cmsName := range dir.cms {
			for _, b := range buckets {
				dims, jerr := json.Marshal([]map[string]string{{"BucketName": b}})
				if jerr != nil {
					lastErr = jerr
					continue
				}
				points, qerr := describeMetric(ctx, accessKeyID, accessKeySecret, region, "acs_oss_dashboard", cmsName, string(dims), start, end, period)
				if qerr != nil {
					lastErr = qerr
					continue
				}
				okCalls++
				all = append(all, points...)
			}
		}
		if okCalls == 0 && lastErr != nil {
			series.Error = metricErr(lastErr)
		} else {
			series.Points = aggregate(all, "sum")
			if n := len(series.Points); n > 0 {
				series.Latest = series.Points[n-1].Value
			}
		}
		out.Series = append(out.Series, series)
	}
	if failed, msg := allFailed(out.Series); failed {
		return out, errno.New(errno.CodeConnFailed, msg, "")
	}
	if len(buckets) == 1 {
		out.Hint = fmt.Sprintf("OSS %s · 内网+公网带宽", buckets[0])
	} else {
		out.Hint = fmt.Sprintf("已汇总本地域 %d 个 Bucket 的内网+公网带宽", len(buckets))
	}
	return out, nil
}

// listOSSBuckets 列出指定地域的 Bucket（OSS V4 签名；V1 已禁用）。
func listOSSBuckets(ctx context.Context, ak, secret, region string) ([]string, error) {
	host := "oss-" + region + ".aliyuncs.com"
	now := time.Now().UTC()
	dateStamp := now.Format("20060102")
	dateTime := now.Format("20060102T150405Z")
	payloadHash := "UNSIGNED-PAYLOAD"
	scope := dateStamp + "/" + region + "/oss/aliyun_v4_request"

	// Canonical headers：必签 x-oss-*；host 放 AdditionalHeaders。
	canonicalHeaders := "host:" + host + "\n" +
		"x-oss-content-sha256:" + payloadHash + "\n" +
		"x-oss-date:" + dateTime + "\n"
	additionalHeaders := "host"
	canonicalRequest := strings.Join([]string{
		"GET",
		"/",
		"",
		canonicalHeaders,
		additionalHeaders,
		payloadHash,
	}, "\n")

	hashedRequest := sha256Hex([]byte(canonicalRequest))
	stringToSign := strings.Join([]string{
		"OSS4-HMAC-SHA256",
		dateTime,
		scope,
		hashedRequest,
	}, "\n")
	signingKey := ossV4SigningKey(secret, dateStamp, region)
	sig := hex.EncodeToString(hmacSHA256(signingKey, stringToSign))
	auth := fmt.Sprintf(
		"OSS4-HMAC-SHA256 Credential=%s/%s,AdditionalHeaders=%s,Signature=%s",
		ak, scope, additionalHeaders, sig,
	)

	req, err := http.NewRequestWithContext(ctx, http.MethodGet, "https://"+host+"/", nil)
	if err != nil {
		return nil, errno.Wrap(errno.CodeConnFailed, "创建 OSS 列表请求失败", err)
	}
	req.Header.Set("Host", host)
	req.Header.Set("x-oss-date", dateTime)
	req.Header.Set("x-oss-content-sha256", payloadHash)
	req.Header.Set("Authorization", auth)

	resp, err := httpClient.Do(req)
	if err != nil {
		return nil, errno.Wrap(errno.CodeConnFailed, "请求 OSS 列表失败", err)
	}
	defer resp.Body.Close()
	body, err := io.ReadAll(io.LimitReader(resp.Body, 1<<20))
	if err != nil {
		return nil, errno.Wrap(errno.CodeConnFailed, "读取 OSS 列表失败", err)
	}
	if resp.StatusCode >= 300 {
		msg := strings.TrimSpace(string(body))
		if msg == "" {
			msg = fmt.Sprintf("OSS 列表失败 HTTP %d", resp.StatusCode)
		}
		return nil, errno.New(errno.CodeConnFailed, truncate([]byte(msg)), "")
	}
	var doc ossListBucketsXML
	if err := xml.Unmarshal(body, &doc); err != nil {
		return nil, errno.Wrap(errno.CodeConnFailed, "解析 OSS Bucket 列表失败", err)
	}
	wantLoc := "oss-" + region
	out := make([]string, 0, len(doc.Buckets))
	for _, b := range doc.Buckets {
		name := strings.TrimSpace(b.Name)
		if name == "" {
			continue
		}
		loc := strings.TrimSpace(b.Location)
		if loc == "" || loc == wantLoc || loc == region {
			out = append(out, name)
		}
	}
	return out, nil
}

func ossV4SigningKey(secret, dateStamp, region string) []byte {
	kDate := hmacSHA256([]byte("aliyun_v4"+secret), dateStamp)
	kRegion := hmacSHA256(kDate, region)
	kService := hmacSHA256(kRegion, "oss")
	return hmacSHA256(kService, "aliyun_v4_request")
}

func hmacSHA256(key []byte, data string) []byte {
	mac := hmac.New(sha256.New, key)
	_, _ = mac.Write([]byte(data))
	return mac.Sum(nil)
}

func sha256Hex(b []byte) string {
	sum := sha256.Sum256(b)
	return hex.EncodeToString(sum[:])
}
