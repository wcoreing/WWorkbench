package aliyuncms

import (
	"crypto/hmac"
	"crypto/sha1"
	"encoding/base64"
	"net/url"
	"sort"
	"strings"
)

// percentEncode 按阿里云 RPC 签名规则编码。
func percentEncode(s string) string {
	var b strings.Builder
	b.Grow(len(s) * 3)
	for i := 0; i < len(s); i++ {
		c := s[i]
		if (c >= 'A' && c <= 'Z') || (c >= 'a' && c <= 'z') || (c >= '0' && c <= '9') || c == '-' || c == '_' || c == '.' || c == '~' {
			b.WriteByte(c)
			continue
		}
		b.WriteByte('%')
		b.WriteByte("0123456789ABCDEF"[c>>4])
		b.WriteByte("0123456789ABCDEF"[c&15])
	}
	return b.String()
}

// signRPC 计算阿里云 RPC HMAC-SHA1 签名。
func signRPC(params map[string]string, accessKeySecret string) string {
	keys := make([]string, 0, len(params))
	for k := range params {
		keys = append(keys, k)
	}
	sort.Strings(keys)
	var canonical strings.Builder
	for i, k := range keys {
		if i > 0 {
			canonical.WriteByte('&')
		}
		canonical.WriteString(percentEncode(k))
		canonical.WriteByte('=')
		canonical.WriteString(percentEncode(params[k]))
	}
	stringToSign := "GET&" + percentEncode("/") + "&" + percentEncode(canonical.String())
	mac := hmac.New(sha1.New, []byte(accessKeySecret+"&"))
	_, _ = mac.Write([]byte(stringToSign))
	return base64.StdEncoding.EncodeToString(mac.Sum(nil))
}

// signedQuery 返回带 Signature 的查询串。
func signedQuery(params map[string]string, accessKeySecret string) string {
	params["Signature"] = signRPC(params, accessKeySecret)
	v := url.Values{}
	for k, val := range params {
		v.Set(k, val)
	}
	return v.Encode()
}
