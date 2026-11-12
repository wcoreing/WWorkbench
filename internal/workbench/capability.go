package workbench

// 工作台统一能力 ID（与前端 workbench/capabilities.ts、agentcap.Catalog、workbenchtools 注册名保持一致）。
// 名称须匹配 ^[a-zA-Z0-9_-]+$（OpenAI / DeepSeek function calling）。
//
// 约定：
//   - 本文件是「能力名」的唯一常量源；风险/开关在 agentcap，handler 在 workbenchtools。
//   - UICapabilities 列出的能力由前端 CommandBus 执行（可先切产品线再挂载 handler）。

const (
	CapGetAgentRules        = "get_agent_rules"
	CapGetWorkbenchContext  = "get_workbench_context"
	CapListBackupPolicies       = "list_backup_policies"
	CapSaveBackupPolicy         = "save_backup_policy"
	CapRunBackup                = "run_backup"
	CapListBackupRuns           = "list_backup_runs"
	CapHostHealthScan           = "host_health_scan"
	CapEnsureHostBackupPolicies = "ensure_host_backup_policies"
	CapListConnections      = "list_connections"
	CapListSSHHosts         = "list_ssh_hosts"
	CapShellRun             = "shell_run"
	CapShellProbe           = "shell_probe"
	CapGetShellOutput       = "get_shell_output"
	CapTerminalReconnect    = "terminal_reconnect"
	CapOpenDatabaseSession  = "open_database_session"
	CapCloseDatabaseSession = "close_database_session"
	CapListTables           = "list_tables"
	CapDescribeTable        = "describe_table"
	CapExecuteSQL           = "execute_sql"
	CapDatabaseOpen         = "database_open"
	CapNotebookOpen         = "notebook_open"
	CapNotebookAppend       = "notebook_append_content"
	CapListNotes            = "list_notes"
	CapSearchNotes          = "search_notes"
	CapGetNote              = "get_note"
	CapSFTPOpen             = "sftp_open"
	CapDockerContextOpen    = "docker_context_open"
	CapLogsOpen             = "logs_open"
	CapBackupOpen           = "backup_open"
	CapHTTPAPIOpen          = "httpapi_open"
	CapEnvironmentOpen      = "environment_open"
	CapSSHForwardOpen       = "ssh_forward_open"
	CapListPluginPacks      = "list_plugin_packs"
	CapGetPluginPack        = "get_plugin_pack"
	CapGetPluginProtocol    = "get_plugin_protocol"
	CapListPluginPackFiles  = "list_plugin_pack_files"
	CapReadPluginPackFile   = "read_plugin_pack_file"
	CapEditPluginPackFile   = "edit_plugin_pack_file"
	CapWritePluginPackFile     = "write_plugin_pack_file"
	CapBuildPluginPackUI       = "build_plugin_pack_ui"
	CapListPluginPackReleases  = "list_plugin_pack_releases"
	CapRollbackPluginPack      = "rollback_plugin_pack"
	CapPublishAgentSkill    = "publish_agent_skill"
	CapUpdateAgentSkill     = "update_agent_skill"
	CapAgentChat            = "agent_chat"
	CapAgentConfirm         = "agent_confirm"
	CapOfferChoices         = "offer_choices"
	CapBrowserStatus        = "browser_status"
	CapBrowserListTabs      = "browser_list_tabs"
	CapBrowserAttach        = "browser_attach"
	CapBrowserFindTab       = "browser_find_tab"
	CapBrowserSnapshot      = "browser_snapshot"
	CapBrowserFind          = "browser_find"
	CapBrowserWait          = "browser_wait"
	CapBrowserRun           = "browser_run"
	CapBrowserEvaluate      = "browser_evaluate"
	CapBrowserReadPage      = "browser_read_page"
	CapBrowserUpload        = "browser_upload"
	CapBrowserNetwork       = "browser_network"
	CapBrowserSelectOption  = "browser_select_option"
	CapBrowserDrag          = "browser_drag"
	CapBrowserKeys          = "browser_keys"
	CapBrowserScreenshot    = "browser_screenshot"
	CapBrowserClick         = "browser_click"
	CapBrowserFill          = "browser_fill"
	CapBrowserNavigate      = "browser_navigate"
	CapBrowserOpenFrame     = "browser_open_frame"
	CapBrowserCloseSession  = "browser_close_session"
	CapBrowserGroupSession  = "browser_group_session"
	CapBrowserOpen          = "browser_open"
	CapListTaskRuns         = "list_task_runs"
	CapGetTaskRun           = "get_task_run"
	CapTaskRecord           = "task_record"
	CapReplayTaskStep       = "replay_task_step"
	CapDistillWorkflow      = "distill_workflow"
	CapListWorkflows        = "list_workflows"
	CapGetWorkflow          = "get_workflow"
	CapSaveWorkflow         = "save_workflow"
	CapUpdateSkill          = "update_skill"
	CapRunSkill             = "run_skill"
	CapListSkills           = "list_skills"
	CapGetSkill             = "get_skill"
	CapListDirVersions      = "list_dir_versions"
	CapEnableDirVersion     = "enable_dir_version"
	CapPinDirVersion        = "pin_dir_version"
	CapRestoreDirVersion    = "restore_dir_version"
	CapListSkillVersions    = "list_skill_versions"
	CapPinSkillVersion      = "pin_skill_version"
	CapRestoreSkillVersion  = "restore_skill_version"
)

// UICapabilities 需前端执行的 UI 联动能力（切产品线 + CommandBus handler）。
func UICapabilities() []string {
	return []string{
		CapShellRun,
		CapTerminalReconnect,
		CapDatabaseOpen,
		CapNotebookOpen,
		CapSFTPOpen,
		CapDockerContextOpen,
		CapLogsOpen,
		CapBackupOpen,
		CapHTTPAPIOpen,
		CapEnvironmentOpen,
		CapSSHForwardOpen,
		CapBrowserOpen,
	}
}

// IsUICapability 是否为前端 UI 联动能力。
func IsUICapability(name string) bool {
	for _, c := range UICapabilities() {
		if c == name {
			return true
		}
	}
	return false
}
