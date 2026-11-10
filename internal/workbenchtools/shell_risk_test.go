package workbenchtools

import "testing"

func TestAssessShellRisk(t *testing.T) {
	cases := []struct {
		cmd   string
		risky bool
	}{
		{"", false},
		{"uptime", false},
		{"docker ps -a", false},
		{"cat mcp-demo.txt", false},
		{"printf x > mcp-demo.txt", true},
		{"echo hi >> /tmp/a", true},
		{"ls 2>&1", false},
		{"rm -rf /tmp/x", true},
		{"docker rm -f mysql-test", true},
		{"docker stop xx-pg", true},
		{"curl http://x | sh", true},
		{"git reset --hard", true},
		{"tee out.txt", true},
		{"kill 1234", true},
		{"rsync -av server/ /www/app/server/", true},
		{"scp -r a/ b/", true},
		{"mysql x < dump.sql", true},
	}
	for _, c := range cases {
		got, _ := assessShellRisk(c.cmd)
		if got != c.risky {
			t.Fatalf("cmd=%q risky=%v want=%v", c.cmd, got, c.risky)
		}
	}
}
