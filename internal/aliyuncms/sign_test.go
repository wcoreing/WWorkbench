package aliyuncms

import "testing"

// 阿里云 RPC 签名文档中的固定用例。
func TestSignRPCDocExample(t *testing.T) {
	params := map[string]string{
		"AccessKeyId":      "testid",
		"Action":           "DescribeRegions",
		"Format":           "XML",
		"SignatureMethod":  "HMAC-SHA1",
		"SignatureNonce":   "3ee8c1b8-83d3-44af-a94f-4e0ad82fd6cf",
		"SignatureVersion": "1.0",
		"Timestamp":        "2016-02-23T12:46:24Z",
		"Version":          "2014-05-26",
	}
	got := signRPC(params, "testsecret")
	const want = "OLeaidS1JvxuMvnyHOwuJ+uX5qY="
	if got != want {
		t.Fatalf("signature=%s want %s", got, want)
	}
}
