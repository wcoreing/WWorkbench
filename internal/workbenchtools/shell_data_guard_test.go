package workbenchtools

import (
	"strings"
	"testing"
)

func TestAssessShellRisk_DataGuard(t *testing.T) {
	cases := []struct {
		cmd    string
		risky  bool
		reason string
	}{
		{"rsync -av server/ /www/wwwroot/whistopgw/server/", true, riskSyncNoDataExclude},
		{"rsync -av --exclude='*.db' --exclude='data' server/ /www/app/server/", true, riskRecursiveSync},
		{"rsync -av local.db /www/app/data/wistop.db", true, riskSyncDataFile},
		{"scp -r server/ root@h:/www/app/server/", true, riskRecursiveSync},
		{"cp -r server/ /www/app/server/", true, riskRecursiveSync},
		{`printf x > /www/app/data/wistop.db`, true, riskSyncDataFile},
		{"mysql db < dump.sql", true, riskDBClientImport},
		{"uptime", false, ""},
		{"rsync -av a.txt /tmp/b.txt", true, riskSyncNoDataExclude}, // 仍是 rsync，无 exclude 当目录同步策略
	}
	for _, c := range cases {
		got, reason := assessShellRisk(c.cmd)
		if got != c.risky {
			t.Fatalf("cmd=%q risky=%v want=%v reason=%q", c.cmd, got, c.risky, reason)
		}
		if c.risky && c.reason != "" && reason != c.reason {
			t.Fatalf("cmd=%q reason=%q want=%q", c.cmd, reason, c.reason)
		}
	}
}

func TestInjectRsyncDataExcludes(t *testing.T) {
	in := "rsync -av server/ /www/app/server/"
	out := injectRsyncDataExcludes(in)
	if !strings.Contains(out, "--exclude='*.db'") || !strings.Contains(out, "--exclude='.env'") {
		t.Fatalf("excludes missing: %s", out)
	}
	if !hasDataExcludes(out) {
		t.Fatal("hasDataExcludes should be true")
	}
	// 已有 exclude 不再重复
	again := injectRsyncDataExcludes(out)
	if again != out {
		t.Fatalf("should not double-inject: %s", again)
	}
}

func TestApplyDataGuardOnConfirm_Rsync(t *testing.T) {
	in := "rsync -av server/ /www/wwwroot/whistopgw/server/"
	out, notes := applyDataGuardOnConfirm(nil, "local", in)
	if !strings.Contains(out, "--exclude='*.db'") {
		t.Fatalf("expected auto exclude: %s", out)
	}
	if !strings.Contains(out, defaultDataBackupRoot) {
		t.Fatalf("expected backup wrap: %s", out)
	}
	if !strings.Contains(out, in) && !strings.Contains(out, "server/") {
		t.Fatalf("original cmd lost: %s", out)
	}
	if len(notes) == 0 {
		t.Fatal("expected notes")
	}
}

func TestWaiveSoftFileRisk_NeverData(t *testing.T) {
	b := &MCPWriteAllowBook{}
	b.Grant("h1", "/www/wwwroot/whistopgw")
	if b.WaiveSoftFileRisk("h1", `printf x > /www/wwwroot/whistopgw/server/data/wistop.db`, riskSyncDataFile) {
		t.Fatal("data hard risk must not waive")
	}
	if b.WaiveSoftFileRisk("h1", `rsync -av a/ /www/wwwroot/whistopgw/server/`, riskSyncNoDataExclude) {
		t.Fatal("sync hard risk must not waive")
	}
	// 软写仍可免
	if !b.WaiveSoftFileRisk("h1", `printf x > /www/wwwroot/whistopgw/a.txt`, "写入文件（含重定向 > / >>）") {
		t.Fatal("soft write under allow should waive")
	}
}
