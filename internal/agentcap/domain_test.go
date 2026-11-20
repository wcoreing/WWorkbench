package agentcap

import "testing"

func TestRecommendedDefault_HeavyDomainsOff(t *testing.T) {
	off := []string{
		"browser_click", "browser_run", "desktop_act", "desktop_snapshot",
		"build_plugin_pack_ui", "start_container", "remove_container",
		"run_backup", "execute_sql", "execute_http",
	}
	for _, name := range off {
		if RecommendedDefault(name) {
			t.Fatalf("%s should be default off", name)
		}
	}
	on := []string{
		"get_workbench_context", "offer_choices", "shell_run", "shell_probe",
		"get_skill", "update_skill", "list_ssh_hosts", "list_connections",
		"get_ecs_monitor", "list_containers", "host_health_scan",
	}
	for _, name := range on {
		if !RecommendedDefault(name) {
			t.Fatalf("%s should be default on", name)
		}
	}
}

func TestDefaultPermissions_UsesRecommended(t *testing.T) {
	m := DefaultPermissions()
	if m["browser_click"] {
		t.Fatal("browser_click should be off in defaults")
	}
	if !m["shell_run"] {
		t.Fatal("shell_run should be on in defaults")
	}
}
