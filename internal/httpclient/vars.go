package httpclient

import (
	"strings"

	"WNavicat/internal/model"
)

// SubstituteVars 将文本中的 {{name}} 替换为环境变量值。
func SubstituteVars(text string, vars map[string]string) string {
	if len(vars) == 0 || !strings.Contains(text, "{{") {
		return text
	}
	out := text
	for k, v := range vars {
		out = strings.ReplaceAll(out, "{{"+k+"}}", v)
	}
	return out
}

// ApplyEnvToRequest 对环境变量替换后的执行请求副本。
func ApplyEnvToRequest(req model.HTTPExecuteRequestDO, vars map[string]string) model.HTTPExecuteRequestDO {
	if len(vars) == 0 {
		return req
	}
	out := req
	out.URL = SubstituteVars(req.URL, vars)
	out.Body = SubstituteVars(req.Body, vars)
	if len(req.Headers) > 0 {
		out.Headers = make([]model.HTTPHeaderKVDO, len(req.Headers))
		for i, h := range req.Headers {
			out.Headers[i] = model.HTTPHeaderKVDO{
				Key:   h.Key,
				Value: SubstituteVars(h.Value, vars),
			}
		}
	}
	return out
}
