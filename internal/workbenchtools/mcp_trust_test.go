package workbenchtools

import "testing"

func TestTrustFingerprintStable(t *testing.T) {
	a := TrustFingerprint("shell_run", "local", "echo  hi  world", "")
	b := TrustFingerprint("shell_run", "local", "echo hi world", "")
	if a == "" || a != b {
		t.Fatalf("normalized command should match: %q vs %q", a, b)
	}
	c := TrustFingerprint("shell_run", "local", "echo hi world!", "")
	if a == c {
		t.Fatal("different command must differ")
	}
}

func TestTrustBookMatchAndRevoke(t *testing.T) {
	b := NewMCPTrustBook(nil)
	_, err := b.Grant(MCPTrustOp{
		Tool:    "shell_run",
		HostKey: "local",
		Command: "rm -f /tmp/x",
		Intent:  "清理临时文件",
		Risk:    "删除文件/目录（rm）",
	})
	if err != nil {
		t.Fatal(err)
	}
	if !b.Match("shell_run", "local", "rm -f /tmp/x", "清理临时文件", "删除文件/目录（rm）") {
		t.Fatal("expected match")
	}
	if b.Match("shell_run", "local", "rm -f /tmp/y", "清理临时文件", "删除文件/目录（rm）") {
		t.Fatal("different path must not match")
	}
	fp := TrustFingerprint("shell_run", "local", "rm -f /tmp/x", "")
	if !b.Revoke(fp) {
		t.Fatal("revoke failed")
	}
	if b.Match("shell_run", "local", "rm -f /tmp/x", "", "删除文件/目录（rm）") {
		t.Fatal("after revoke must not match")
	}
}

func TestTrustBookRejectsHardRisk(t *testing.T) {
	b := NewMCPTrustBook(nil)
	_, err := b.Grant(MCPTrustOp{
		Tool:    "shell_run",
		HostKey: "local",
		Command: "rsync -a a/ b/",
		Risk:    riskSyncNoDataExclude,
	})
	if err == nil {
		t.Fatal("hard risk must reject grant")
	}
	if b.Match("shell_run", "local", "rsync -a a/ b/", "", riskSyncNoDataExclude) {
		t.Fatal("hard risk must never match")
	}
}
