package workbenchtools

import (
	"testing"

	"WWorkbench/internal/model"
)

func TestParseHostHealthAssets(t *testing.T) {
	raw := `/www/app/data
/www/app/wistop.db
/www/app/.env
/other/skip.db
`
	assets := parseHostHealthAssets(raw, "/www/app")
	if len(assets) != 3 {
		t.Fatalf("assets=%v", assets)
	}
	joined := prependUnique("/www/app", assets)
	if joined[0] != "/www/app" || len(joined) != 4 {
		t.Fatalf("prepend=%v", joined)
	}
	if !pathCoveredByPolicies("/www/app/wistop.db", []model.BackupPolicyDO{
		{Enabled: true, Kind: model.BackupKindFiles, Path: "/www/app"},
	}) {
		t.Fatal("expected covered by parent dir")
	}
	if suggestKindForPath("/a/b.db") != model.BackupKindSQLite {
		t.Fatal("sqlite")
	}
	if !isEnvPath("/a/.env.local") {
		t.Fatal("env")
	}
}
