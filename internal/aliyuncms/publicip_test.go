package aliyuncms

import "testing"

func TestExtractIPv4(t *testing.T) {
	cases := map[string]string{
		"124.227.252.102":                         "124.227.252.102",
		"当前 IP：124.227.252.102  来自于：广西":          "124.227.252.102",
		"Current IP Address: 209.141.54.251\n":     "209.141.54.251",
		"  1.2.3.4  ":                             "1.2.3.4",
		"no ip here":                              "",
		"2001:db8::1":                             "",
	}
	for in, want := range cases {
		if got := extractIPv4(in); got != want {
			t.Fatalf("extractIPv4(%q)=%q want %q", in, got, want)
		}
	}
}
