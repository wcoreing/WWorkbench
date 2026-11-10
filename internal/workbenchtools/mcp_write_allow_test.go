package workbenchtools

import "testing"

func TestExtractShellWriteTargets(t *testing.T) {
	cases := []struct {
		cmd  string
		want []string
	}{
		{`printf x > mcp-demo.txt`, nil},
		{`printf x > /root/a.txt`, []string{"/root/a.txt"}},
		{`echo hi >> /tmp/a`, []string{"/tmp/a"}},
		{`rm -rf /tmp/x`, []string{"/tmp/x"}},
		{`tee /var/log/a`, []string{"/var/log/a"}},
		{`ls 2>&1`, nil},
	}
	for _, c := range cases {
		got := extractShellWriteTargets(c.cmd)
		if len(got) != len(c.want) {
			t.Fatalf("cmd=%q got=%v want=%v", c.cmd, got, c.want)
		}
		for i := range c.want {
			if got[i] != c.want[i] {
				t.Fatalf("cmd=%q got=%v want=%v", c.cmd, got, c.want)
			}
		}
	}
}

func TestWaiveSoftFileRisk(t *testing.T) {
	b := &MCPWriteAllowBook{}
	b.Grant("h1", "/root/proj")
	if !b.WaiveSoftFileRisk("h1", `printf x > foo.txt`, "写入文件（含重定向 > / >>）") {
		t.Fatal("relative write should waive")
	}
	if !b.WaiveSoftFileRisk("h1", `printf x > /root/proj/a.txt`, "写入文件（含重定向 > / >>）") {
		t.Fatal("under allow should waive")
	}
	if b.WaiveSoftFileRisk("h1", `printf x > /etc/passwd`, "写入文件（含重定向 > / >>）") {
		t.Fatal("outside allow must not waive")
	}
	if b.WaiveSoftFileRisk("h1", `docker rm -f x`, "Docker 破坏性操作") {
		t.Fatal("hard risk must not waive")
	}
}
