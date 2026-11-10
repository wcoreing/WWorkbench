package workbenchtools

import (
	"strings"
	"testing"

	"WWorkbench/internal/model"
)

func TestPolicyPathHits(t *testing.T) {
	if !policyPathHits("/www/app/data/wistop.db", []string{"/www/app/data/wistop.db"}, nil) {
		t.Fatal("exact file")
	}
	if policyPathHits("/www/app/data", nil, []string{"/www/app/server"}) {
		t.Fatal("should not hit unrelated dest")
	}
	if !policyPathHits("/www/app/server/data/wistop.db", nil, []string{"/www/app/server"}) {
		t.Fatal("db under sync dest should hit")
	}
}

func TestBuildBackupScriptFiles(t *testing.T) {
	p := model.BackupPolicyDO{
		ID: "abcd1234-xxxx", Name: "t", Kind: model.BackupKindFiles,
		Path: "/www/app/data/wistop.db", DestRoot: "/www/backup/wworkbench", RetainCount: 5,
	}
	script, dest, errMsg := buildBackupScript(nil, p)
	if errMsg != "" {
		t.Fatal(errMsg)
	}
	if !strings.Contains(script, "wistop.db") || !strings.Contains(script, "BACKUP_OK") {
		t.Fatalf("script=%s", script)
	}
	if !strings.HasPrefix(dest, "/www/backup/wworkbench/") {
		t.Fatalf("dest=%s", dest)
	}
	if !strings.Contains(script, "abcd1234_*/") || !strings.Contains(script, "tail -n +6") {
		t.Fatalf("expected policy-scoped prune, script=%s", script)
	}
}

func TestParseBackupDirStamp(t *testing.T) {
	ts, ok := parseBackupDirStamp("a58bccf8_20261110_080001", "a58bccf8")
	if !ok || ts <= 0 {
		t.Fatalf("parse stamp failed: ok=%v ts=%d", ok, ts)
	}
	if _, ok := parseBackupDirStamp("other_20261110_080001", "a58bccf8"); ok {
		t.Fatal("should reject other prefix")
	}
}

func TestBackupPruneClause(t *testing.T) {
	if got := backupPruneClause("abcd1234", 0, 0); got != "" {
		t.Fatalf("no retain should skip prune, got %q", got)
	}
	if got := backupPruneClause("abcd1234", 7, 0); !strings.Contains(got, "mtime +7") || !strings.Contains(got, "abcd1234_*") {
		t.Fatalf("expected day prune: %s", got)
	}
	if got := backupPruneClause("abcd1234", 0, 3); !strings.Contains(got, "abcd1234_*/") || !strings.Contains(got, "tail -n +4") {
		t.Fatalf("unexpected count prune: %s", got)
	}
	// 按天优先
	if got := backupPruneClause("abcd1234", 7, 3); !strings.Contains(got, "mtime +7") {
		t.Fatalf("days should win: %s", got)
	}
}
