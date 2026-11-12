package workbench

// 资产雷达：应用型 Desk 的「落盘可见」契约（对齐 agentdesk workspace-changed，载体为 SQLite 资产而非文件）。

const RadarEventName = "workbench-changed"

// 资产域（凡工作台树/列表可见、可复现的实体）。
const (
	RadarDomainHTTPRequest     = "http.request"
	RadarDomainHTTPEnv         = "http.env"
	RadarDomainHTTPFolder      = "http.folder"
	RadarDomainNotebookNote    = "notebook.note"
	RadarDomainNotebookGroup   = "notebook.group"
	// RadarDomainNotebookPath 工作区相对路径变更（rename/move/copy/delete/mkdir）；ids 约定见 Emit 调用处。
	RadarDomainNotebookPath = "notebook.path"
	RadarDomainDockerContainer = "docker.container"
	RadarDomainDockerContext   = "docker.context"
	RadarDomainSSHHost         = "ssh.host"
	RadarDomainConnection      = "database.connection"
	RadarDomainLogSource       = "logs.source"
	RadarDomainEnvPreset       = "environment.preset"
	RadarDomainSFTPBookmark    = "sftp.bookmark"
	RadarDomainSSHForward      = "ssh.forward"
	RadarDomainAgentSkill      = "agent.skill"
	RadarDomainPluginPack      = "plugin.pack"
	RadarDomainBackupPolicy    = "backup.policy"
)

// 变更操作。
const (
	RadarOpCreate = "create"
	RadarOpUpdate = "update"
	RadarOpDelete = "delete"
)

// 笔记本路径写 writeId 前缀（ui- = 本机 UI 已本地 remap，FE 可跳过再处理）。
const (
	RadarWriteNotebookRename     = "ui-notebook-rename"
	RadarWriteNotebookMove       = "ui-notebook-move"
	RadarWriteNotebookCopy       = "ui-notebook-copy"
	RadarWriteNotebookDeletePath = "ui-notebook-delete-path"
	RadarWriteNotebookMkdir      = "ui-notebook-mkdir"
	RadarWriteNotebookCreateFile = "ui-notebook-create-file"
)

// RadarEvent 资产变更广播（FE 唯一入口刷树 / reveal）。
type RadarEvent struct {
	Domain  string   `json:"domain"`
	Op      string   `json:"op"`
	IDs     []string `json:"ids"`
	WriteID string   `json:"writeId,omitempty"`
	Reveal  bool     `json:"reveal,omitempty"`
	Product string   `json:"product,omitempty"`
	Label   string   `json:"label,omitempty"`
}
