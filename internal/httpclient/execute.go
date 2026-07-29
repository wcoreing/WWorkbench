package httpclient

import (
	"context"
	"crypto/tls"
	"encoding/json"
	"io"
	"net/http"
	"strings"
	"time"

	"WWorkbench/internal/errno"
	"WWorkbench/internal/model"
)

const (
	defaultTimeout = 30 * time.Second
	maxBodyBytes   = 2 * 1024 * 1024
)

// Execute 发送 HTTP 请求并返回响应。
func Execute(req model.HTTPExecuteRequestDO) (*model.HTTPResponseDO, error) {
	method := strings.ToUpper(strings.TrimSpace(req.Method))
	if method == "" {
		method = http.MethodGet
	}
	url := strings.TrimSpace(req.URL)
	if url == "" {
		return nil, errno.New(errno.CodeInvalidArg, "请填写请求 URL", "")
	}
	if !strings.HasPrefix(url, "http://") && !strings.HasPrefix(url, "https://") {
		url = "http://" + url
	}

	timeout := defaultTimeout
	if req.TimeoutMs > 0 {
		timeout = time.Duration(req.TimeoutMs) * time.Millisecond
	}
	ctx, cancel := context.WithTimeout(context.Background(), timeout)
	defer cancel()

	var bodyReader io.Reader
	if req.Body != "" && method != http.MethodGet && method != http.MethodHead {
		bodyReader = strings.NewReader(req.Body)
	}
	httpReq, err := http.NewRequestWithContext(ctx, method, url, bodyReader)
	if err != nil {
		return nil, errno.Wrap(errno.CodeInvalidArg, "构建请求失败", err)
	}
	for _, h := range req.Headers {
		k := strings.TrimSpace(h.Key)
		if k == "" {
			continue
		}
		httpReq.Header.Set(k, h.Value)
	}
	if httpReq.Header.Get("Content-Type") == "" && req.Body != "" {
		httpReq.Header.Set("Content-Type", "application/json")
	}

	client := &http.Client{
		Timeout: timeout,
		Transport: &http.Transport{
			TLSClientConfig: &tls.Config{InsecureSkipVerify: false},
		},
		CheckRedirect: func(req *http.Request, via []*http.Request) error {
			if len(via) >= 10 {
				return errno.New(errno.CodeInvalidArg, "重定向次数过多", "")
			}
			return nil
		},
	}

	start := time.Now()
	resp, err := client.Do(httpReq)
	elapsed := time.Since(start).Milliseconds()
	if err != nil {
		return &model.HTTPResponseDO{
			StatusCode: 0,
			Status:     "Error",
			Body:       err.Error(),
			ElapsedMs:  elapsed,
			Error:      err.Error(),
		}, nil
	}
	defer resp.Body.Close()

	data, err := io.ReadAll(io.LimitReader(resp.Body, maxBodyBytes))
	if err != nil {
		return nil, errno.Wrap(errno.CodeConnFailed, "读取响应失败", err)
	}
	truncated := resp.ContentLength > maxBodyBytes || int64(len(data)) >= maxBodyBytes

	headers := make([]model.HTTPHeaderKVDO, 0, len(resp.Header))
	for k, vals := range resp.Header {
		headers = append(headers, model.HTTPHeaderKVDO{Key: k, Value: strings.Join(vals, ", ")})
	}

	body := string(data)
	if truncated {
		body += "\n\n…（响应体已截断，超过 2MB）"
	}

	return &model.HTTPResponseDO{
		StatusCode: resp.StatusCode,
		Status:     resp.Status,
		Headers:    headers,
		Body:       body,
		ElapsedMs:  elapsed,
		Truncated:  truncated,
	}, nil
}

// HeadersToJSON 将请求头序列化为 JSON 字符串（供存储）。
func HeadersToJSON(headers []model.HTTPHeaderKVDO) string {
	if len(headers) == 0 {
		return "[]"
	}
	b, err := json.Marshal(headers)
	if err != nil {
		return "[]"
	}
	return string(b)
}
