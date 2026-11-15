package workbenchtools

import (
	"encoding/json"
	"strings"
	"testing"

	"WWorkbench/internal/model"
)

func TestExtractMCPResources_SSHAndDB(t *testing.T) {
	args, _ := json.Marshal(map[string]interface{}{
		"intent":       "查线上订单",
		"sshHostId":    "host-1",
		"connectionId": "conn-1",
	})
	refs := extractMCPResources("execute_sql", args)
	kinds := map[string]string{}
	for _, r := range refs {
		kinds[r.Kind] = r.ID
	}
	if kinds[model.MCPAssetSSH] != "host-1" {
		t.Fatalf("want ssh host-1, got %#v", refs)
	}
	if kinds[model.MCPAssetDatabase] != "conn-1" {
		t.Fatalf("want database conn-1, got %#v", refs)
	}
}

func TestExtractMCPResources_SkillAndBrowser(t *testing.T) {
	args, _ := json.Marshal(map[string]interface{}{
		"skill":   "fill-macro-test",
		"session": "标注任务A",
	})
	refs := extractMCPResources("get_skill", args)
	foundSkill, foundBrowser := false, false
	for _, r := range refs {
		if r.Kind == model.MCPAssetSkill && r.ID == "fill-macro-test" {
			foundSkill = true
		}
		if r.Kind == model.MCPAssetBrowser {
			foundBrowser = true
		}
	}
	if !foundSkill {
		t.Fatalf("want skill, got %#v", refs)
	}
	if foundBrowser {
		t.Fatalf("get_skill should not attach browser session, got %#v", refs)
	}

	refs2 := extractMCPResources("browser_navigate", args)
	foundBrowser = false
	for _, r := range refs2 {
		if r.Kind == model.MCPAssetBrowser && r.ID == "标注任务A" {
			foundBrowser = true
		}
	}
	if !foundBrowser {
		t.Fatalf("want browser session, got %#v", refs2)
	}
}

func TestExtractMCPResources_HTTPNotBrowserNetwork(t *testing.T) {
	args, _ := json.Marshal(map[string]interface{}{"requestId": "net-1"})
	refs := extractMCPResources("browser_network", args)
	for _, r := range refs {
		if r.Kind == model.MCPAssetHTTP {
			t.Fatalf("browser_network requestId must not be http asset: %#v", refs)
		}
	}
	refs2 := extractMCPResources("execute_http", args)
	ok := false
	for _, r := range refs2 {
		if r.Kind == model.MCPAssetHTTP && r.ID == "net-1" {
			ok = true
		}
	}
	if !ok {
		t.Fatalf("execute_http should keep requestId as http: %#v", refs2)
	}
}

func TestGroupMCPLogsByIntent(t *testing.T) {
	logs := []model.MCPCallLogDO{
		{ID: "1", Intent: "部署", Tool: "shell_run", At: 3, Resources: []model.MCPAssetRef{{Kind: "ssh", ID: "h1"}}},
		{ID: "2", Intent: "部署", Tool: "run_backup", At: 2, Resources: []model.MCPAssetRef{{Kind: "backup", ID: "p1"}}},
		{ID: "3", Intent: "查库", Tool: "execute_sql", At: 1, Resources: []model.MCPAssetRef{{Kind: "database", ID: "c1"}}},
	}
	g := groupMCPLogsByIntent(logs)
	if len(g) != 2 {
		t.Fatalf("want 2 groups, got %d %#v", len(g), g)
	}
	if g[0]["intent"] != "部署" || g[0]["count"] != 2 {
		t.Fatalf("first group: %#v", g[0])
	}
	if g[1]["intent"] != "查库" {
		t.Fatalf("second group: %#v", g[1])
	}
}

func TestSkipMCPCallLog(t *testing.T) {
	if !skipMCPCallLog("list_mcp_logs") || !skipMCPCallLog("get_mcp_log") {
		t.Fatal("audit tools must skip")
	}
	if skipMCPCallLog("shell_run") {
		t.Fatal("shell_run must be logged")
	}
}

func TestMCPArgsSummaryKeepsCommand(t *testing.T) {
	raw, _ := json.Marshal(map[string]interface{}{
		"command":  "df -h /",
		"hostId":   "h1",
		"intent":   "探针",
		"password": "secret",
	})
	s := mcpArgsSummary(raw)
	if !strings.Contains(s, "df -h /") {
		t.Fatalf("want command in summary, got %s", s)
	}
	if strings.Contains(s, "secret") {
		t.Fatalf("must not keep password: %s", s)
	}
}
