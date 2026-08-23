package model

// ConnectionDO 数据库连接配置。
type ConnectionDO struct {
	ID          string `json:"id"`
	Name        string `json:"name"`
	Group       string `json:"group"`
	DbType      string `json:"dbType"`
	Host        string `json:"host"`
	Port        int    `json:"port"`
	User        string `json:"user"`
	Password    string `json:"password"`
	Database    string `json:"database"`
	Charset     string `json:"charset"`
	SSHEnabled  bool   `json:"sshEnabled"`
	SSHHostID   string `json:"sshHostId"`
	SSHHost     string `json:"sshHost"`
	SSHPort     int    `json:"sshPort"`
	SSHUser     string `json:"sshUser"`
	SSHKeyPath  string `json:"sshKeyPath"`
	SSHPassword string `json:"sshPassword"`
	CreatedAt   int64  `json:"createdAt"`
	UpdatedAt   int64  `json:"updatedAt"`
}

// TunnelSpecDO SSH 隧道规格。
type TunnelSpecDO struct {
	Enabled    bool   `json:"enabled"`
	Host       string `json:"host"`
	Port       int    `json:"port"`
	User       string `json:"user"`
	KeyPath    string `json:"keyPath"`
	Password   string `json:"password"`
	TargetHost string `json:"targetHost"`
	TargetPort int    `json:"targetPort"`
}

// ConnectionConfigDO 运行时连接配置（含明文密码，仅内存使用）。
type ConnectionConfigDO struct {
	DbType   string       `json:"dbType"`
	Host     string       `json:"host"`
	Port     int          `json:"port"`
	User     string       `json:"user"`
	Password string       `json:"password"`
	Database string       `json:"database"`
	Charset  string       `json:"charset"`
	Tunnel   TunnelSpecDO `json:"tunnel"`
}

// TableMetaDO 表元数据。
type TableMetaDO struct {
	Name    string `json:"name"`
	Comment string `json:"comment"`
	Engine  string `json:"engine"`
	Rows    int64  `json:"rows"`
}

// ColumnMetaDO 列元数据。
type ColumnMetaDO struct {
	Name         string  `json:"name"`
	DataType     string  `json:"dataType"`
	ColumnType   string  `json:"columnType"`
	Nullable     bool    `json:"nullable"`
	IsPrimaryKey bool    `json:"isPrimaryKey"`
	Extra        string  `json:"extra"`
	DefaultValue *string `json:"defaultValue,omitempty"`
	Comment      string  `json:"comment"`
	Editable     bool    `json:"editable"`
}

// ExecuteResultDO SQL 执行结果（非查询）。
type ExecuteResultDO struct {
	RowsAffected int64  `json:"rowsAffected"`
	LastInsertID int64  `json:"lastInsertId"`
	Message      string `json:"message"`
	ElapsedMs    int64  `json:"elapsedMs"`
}

// QueryRowDO 查询结果行。
type QueryRowDO struct {
	Cells []CellValueDO `json:"cells"`
}

// SQLBatchItemDO 批量 SQL 单条执行结果。
type SQLBatchItemDO struct {
	SQL     string           `json:"sql"`
	Query   *QueryPageDO     `json:"query,omitempty"`
	Execute *ExecuteResultDO `json:"execute,omitempty"`
	Error   string           `json:"error,omitempty"`
}

// SQLBatchResultDO 多语句 SQL 执行结果。
type SQLBatchResultDO struct {
	Items []SQLBatchItemDO `json:"items"`
}

// IndexMetaDO 索引元数据。
type IndexMetaDO struct {
	Name       string `json:"name"`
	Column     string `json:"column"`
	NonUnique  bool   `json:"nonUnique"`
	SeqInIndex int    `json:"seqInIndex"`
	IndexType  string `json:"indexType"`
}

// QueryPageDO 分页查询结果。
type QueryPageDO struct {
	Columns   []ColumnMetaDO `json:"columns"`
	Rows      []QueryRowDO   `json:"rows"`
	Page      int            `json:"page"`
	PageSize  int            `json:"pageSize"`
	Total     int64          `json:"total"`
	ElapsedMs int64          `json:"elapsedMs"`
}

// CellValueDO 单元格值。
type CellValueDO struct {
	Value   *string `json:"value"`
	IsNull  bool    `json:"isNull"`
	Display string  `json:"display"`
}

// TableFilterDO 表数据筛选条件。
type TableFilterDO struct {
	Enabled  bool   `json:"enabled"`
	Column   string `json:"column"`
	Operator string `json:"operator"`
	Value    string `json:"value"`
}

// TableSortDO 表数据排序条件。
type TableSortDO struct {
	Column    string `json:"column"`
	Ascending bool   `json:"ascending"`
}

// TableDataQueryDO 表数据查询参数。
type TableDataQueryDO struct {
	Page     int             `json:"page"`
	PageSize int             `json:"pageSize"`
	Filters  []TableFilterDO `json:"filters"`
	Sorts    []TableSortDO   `json:"sorts"`
}

// TableDataPageDO 表数据分页。
type TableDataPageDO struct {
	Columns       []ColumnMetaDO `json:"columns"`
	Rows          []TableRowDO   `json:"rows"`
	Page          int            `json:"page"`
	PageSize      int            `json:"pageSize"`
	Total         int64          `json:"total"`
	HasPrimaryKey bool           `json:"hasPrimaryKey"`
	ReadOnly      bool           `json:"readOnly"`
	ElapsedMs     int64          `json:"elapsedMs"`
}

// TableRowDO 表数据行。
type TableRowDO struct {
	RowID  string                 `json:"rowId"`
	Values map[string]CellValueDO `json:"values"`
}

// RowMutationBatchDO 行变更批次。
type RowMutationBatchDO struct {
	Inserts []RowMutationDO `json:"inserts"`
	Updates []RowMutationDO `json:"updates"`
	Deletes []RowMutationDO `json:"deletes"`
}

// FieldValueDO 字段值（可空）。
type FieldValueDO struct {
	Name   string  `json:"name"`
	Value  *string `json:"value"`
	IsNull bool    `json:"isNull"`
}

// RowMutationDO 单行变更。
type RowMutationDO struct {
	RowID  string         `json:"rowId"`
	Fields []FieldValueDO `json:"fields"`
	OldPK  []FieldValueDO `json:"oldPk,omitempty"`
}

// ObjectTreeNodeDO 对象树节点。
type ObjectTreeNodeDO struct {
	ID       string             `json:"id"`
	Label    string             `json:"label"`
	NodeType string             `json:"nodeType"`
	Database string             `json:"database,omitempty"`
	Table    string             `json:"table,omitempty"`
	Children []ObjectTreeNodeDO `json:"children,omitempty"`
	Lazy     bool               `json:"lazy"`
}

// QueryHistoryDO 查询历史。
type QueryHistoryDO struct {
	ID           string `json:"id"`
	ConnectionID string `json:"connectionId"`
	Database     string `json:"database"`
	SQL          string `json:"sql"`
	ExecutedAt   int64  `json:"executedAt"`
	ElapsedMs    int64  `json:"elapsedMs"`
	Success      bool   `json:"success"`
}

// VersionDO 版本信息。
type VersionDO struct {
	Version string `json:"version"`
}

// ConnectionsExportDO 连接配置导出包。
type ConnectionsExportDO struct {
	Version     string         `json:"version"`
	Connections []ConnectionDO `json:"connections"`
}

// ExportResultDO 导出结果。
type ExportResultDO struct {
	Path string `json:"path"`
}

// DDLResultDO DDL 文本。
type DDLResultDO struct {
	Content string `json:"content"`
}

// SessionInfoDO 会话信息。
type SessionInfoDO struct {
	SessionID    string `json:"sessionId"`
	ConnectionID string `json:"connectionId"`
	Database     string `json:"database"`
}

// SSHHostDO SSH 终端主机配置。
type SSHHostDO struct {
	ID        string `json:"id"`
	Name      string `json:"name"`
	Host      string `json:"host"`
	Port      int    `json:"port"`
	User      string `json:"user"`
	Password  string `json:"password"`
	KeyPath   string `json:"keyPath"`
	CreatedAt int64  `json:"createdAt"`
	UpdatedAt int64  `json:"updatedAt"`
}

const (
	ShellHostKindSSH    = "ssh"
	ShellHostKindDocker = "docker"
)

// ShellHostDO 统一 Shell 主机（SSH 或 Docker 容器）。
type ShellHostDO struct {
	ID            string `json:"id"`
	Kind          string `json:"kind"` // ssh | docker
	Name          string `json:"name"`
	Host          string `json:"host"`
	Port          int    `json:"port"`
	User          string `json:"user"`
	Password      string `json:"password"`
	KeyPath       string `json:"keyPath"`
	ContextID     string `json:"contextId"`
	ContainerID   string `json:"containerId"`
	ContainerName string `json:"containerName"`
	Image         string `json:"image"`
	Running       bool   `json:"running"` // Docker：容器是否在运行；SSH 恒为 true
	CreatedAt     int64  `json:"createdAt"`
	UpdatedAt     int64  `json:"updatedAt"`
}

// DockerShellHostDO 已注册的 Docker 容器 Shell 主机。
type DockerShellHostDO struct {
	ID          string `json:"id"`
	ContextID   string `json:"contextId"`
	ContainerID string `json:"containerId"`
	Name        string `json:"name"`
	Image       string `json:"image"`
	CreatedAt   int64  `json:"createdAt"`
	UpdatedAt   int64  `json:"updatedAt"`
}

// TerminalSessionInfoDO 终端会话信息。
type TerminalSessionInfoDO struct {
	SessionID string `json:"sessionId"`
	HostID    string `json:"hostId"`
	Title     string `json:"title"`
	Kind      string `json:"kind"` // local | ssh | docker
}

// SFTPSessionInfoDO SFTP 会话信息。
type SFTPSessionInfoDO struct {
	SessionID string `json:"sessionId"`
	HostID    string `json:"hostId"`
	Title     string `json:"title"`
}

// FileEntryDO 文件项（本地/远程通用）。
type FileEntryDO struct {
	Name    string `json:"name"`
	Path    string `json:"path"`
	IsDir   bool   `json:"isDir"`
	Size    int64  `json:"size"`
	ModTime int64  `json:"modTime"`
}

// TransferResultDO 文件传输结果。
type TransferResultDO struct {
	Path string `json:"path"`
}

// LocalDirResultDO 本地目录列表结果。
type LocalDirResultDO struct {
	Path    string        `json:"path"`
	Entries []FileEntryDO `json:"entries"`
}

// SftpProgressDO SFTP 传输进度。
type SftpProgressDO struct {
	TaskID    string `json:"taskId"`
	SessionID string `json:"sessionId"`
	Kind      string `json:"kind"`
	Name      string `json:"name"`
	Done      int64  `json:"done"`
	Total     int64  `json:"total"`
	State     string `json:"state"`
}

// SQLExportProgressDO 数据库 SQL 导出进度。
type SQLExportProgressDO struct {
	TaskID   string `json:"taskId"`
	Database string `json:"database"`
	Table    string `json:"table"`
	Done     int    `json:"done"`
	Total    int    `json:"total"`
	State    string `json:"state"` // running | done | error | cancelled
	Message  string `json:"message"`
}

// SftpBookmarkDO SFTP 路径书签。
type SftpBookmarkDO struct {
	ID        string `json:"id"`
	Side      string `json:"side"`   // local | remote
	HostID    string `json:"hostId"` // 远程书签关联 SSH 主机，本地为空
	Name      string `json:"name"`
	Path      string `json:"path"`
	CreatedAt int64  `json:"createdAt"`
}

// TransferConflictDO 传输目标冲突信息。
type TransferConflictDO struct {
	HasConflict   bool   `json:"hasConflict"`
	Name          string `json:"name"`
	SourcePath    string `json:"sourcePath"`
	SourceSize    int64  `json:"sourceSize"`
	SourceModTime int64  `json:"sourceModTime"`
	SourceIsDir   bool   `json:"sourceIsDir"`
	TargetPath    string `json:"targetPath"`
	TargetSize    int64  `json:"targetSize"`
	TargetModTime int64  `json:"targetModTime"`
	TargetIsDir   bool   `json:"targetIsDir"`
}

// DockerContextDO Docker 引擎上下文。
type DockerContextDO struct {
	ID        string `json:"id"`
	Name      string `json:"name"`
	Kind      string `json:"kind"`
	Endpoint  string `json:"endpoint"`
	SSHHostID string `json:"sshHostId"`
	Connected bool   `json:"connected"`
}

// DockerImageDO 镜像摘要。
type DockerImageDO struct {
	ID        string `json:"id"`
	ShortID   string `json:"shortId"`
	Tags      string `json:"tags"`
	Size      int64  `json:"size"`
	CreatedAt int64  `json:"createdAt"`
}

// ContainerShellDO 容器 Shell 启动信息。
type ContainerShellDO struct {
	Mode        string `json:"mode"` // docker
	HostID      string `json:"hostId"`
	ContextID   string `json:"contextId"`
	ContainerID string `json:"containerId"`
	Command     string `json:"command"` // 已废弃，保留字段兼容
}

// ContainerDatabaseLinkDO 容器数据库连接建议。
type ContainerDatabaseLinkDO struct {
	DbType     string `json:"dbType"`
	Name       string `json:"name"`
	Host       string `json:"host"`
	Port       int    `json:"port"`
	User       string `json:"user"`
	Password   string `json:"password"`
	Database   string `json:"database"`
	SSHEnabled bool   `json:"sshEnabled"`
	SSHHostID  string `json:"sshHostId"`
}

// ContainerEnvVarDO 容器环境变量。
type ContainerEnvVarDO struct {
	Key       string `json:"key"`
	Value     string `json:"value"`
	Highlight bool   `json:"highlight"`
}

// ContainerEnvDO 容器启动环境变量。
type ContainerEnvDO struct {
	Vars []ContainerEnvVarDO `json:"vars"`
}

// ContainerDO 容器摘要。
type ContainerDO struct {
	ID        string `json:"id"`
	ShortID   string `json:"shortId"`
	Name      string `json:"name"`
	Image     string `json:"image"`
	State     string `json:"state"`
	Status    string `json:"status"`
	Ports     string `json:"ports"`
	CreatedAt int64  `json:"createdAt"`
}

// SSHForwardPresetDO SSH 端口转发预设（本地 → 远端）。
type SSHForwardPresetDO struct {
	ID         string `json:"id"`
	Name       string `json:"name"`
	SSHHostID  string `json:"sshHostId"`
	LocalPort  int    `json:"localPort"`
	RemoteHost string `json:"remoteHost"`
	RemotePort int    `json:"remotePort"`
	CreatedAt  int64  `json:"createdAt"`
	UpdatedAt  int64  `json:"updatedAt"`
}

// SSHForwardStartDO 启动端口转发请求。
type SSHForwardStartDO struct {
	PresetID   string `json:"presetId"`
	Name       string `json:"name"`
	SSHHostID  string `json:"sshHostId"`
	LocalPort  int    `json:"localPort"`
	RemoteHost string `json:"remoteHost"`
	RemotePort int    `json:"remotePort"`
}

// SSHForwardActiveDO 运行中的端口转发。
type SSHForwardActiveDO struct {
	ID          string `json:"id"`
	PresetID    string `json:"presetId"`
	Name        string `json:"name"`
	SSHHostID   string `json:"sshHostId"`
	SSHHostName string `json:"sshHostName"`
	LocalHost   string `json:"localHost"`
	LocalPort   int    `json:"localPort"`
	LocalAddr   string `json:"localAddr"`
	RemoteHost  string `json:"remoteHost"`
	RemotePort  int    `json:"remotePort"`
	StartedAt   int64  `json:"startedAt"`
}

// LocalPortProcessDO 本机占用端口的进程。
type LocalPortProcessDO struct {
	PID     int    `json:"pid"`
	Port    int    `json:"port"`
	Name    string `json:"name"`
	Command string `json:"command"`
	User    string `json:"user"`
	Address string `json:"address"`
}

// LocalPortKillResultDO 按端口结束进程的结果。
type LocalPortKillResultDO struct {
	Port   int                  `json:"port"`
	Force  bool                 `json:"force"`
	Killed []LocalPortProcessDO `json:"killed"`
}

// HTTPHeaderKVDO HTTP 请求头键值。
type HTTPHeaderKVDO struct {
	Key   string `json:"key"`
	Value string `json:"value"`
}

// HTTPExecuteRequestDO 执行 HTTP 请求参数。
type HTTPExecuteRequestDO struct {
	Method    string           `json:"method"`
	URL       string           `json:"url"`
	Headers   []HTTPHeaderKVDO `json:"headers"`
	Body      string           `json:"body"`
	TimeoutMs int              `json:"timeoutMs"`
	EnvID     string           `json:"envId"`
}

// HTTPEnvironmentDO HTTP 环境变量预设。
type HTTPEnvironmentDO struct {
	ID        string `json:"id"`
	Name      string `json:"name"`
	VarsJSON  string `json:"varsJson"`
	CreatedAt int64  `json:"createdAt"`
	UpdatedAt int64  `json:"updatedAt"`
}

// HTTPResponseDO HTTP 响应结果。
type HTTPResponseDO struct {
	StatusCode int              `json:"statusCode"`
	Status     string           `json:"status"`
	Headers    []HTTPHeaderKVDO `json:"headers"`
	Body       string           `json:"body"`
	ElapsedMs  int64            `json:"elapsedMs"`
	Truncated  bool             `json:"truncated"`
	Error      string           `json:"error"`
}

// 日志源类型。
const (
	LogSourceLocalFile = "local_file"
	LogSourceSSHFile   = "ssh_file"
	LogSourceDocker    = "docker"
	LogSourceCompose   = "compose"
)

// LogSourceDO 已保存的日志源。
type LogSourceDO struct {
	ID              string `json:"id"`
	Name            string `json:"name"`
	SourceType      string `json:"sourceType"`
	Path            string `json:"path"`
	SSHHostID       string `json:"sshHostId"`
	DockerContextID string `json:"dockerContextId"`
	ContainerID     string `json:"containerId"`
	ComposeDir      string `json:"composeDir"`
	ComposeService  string `json:"composeService"`
	TailLines       int    `json:"tailLines"`
	SortOrder       int    `json:"sortOrder"`
	CreatedAt       int64  `json:"createdAt"`
	UpdatedAt       int64  `json:"updatedAt"`
}

// LogFetchResultDO 拉取日志结果。
type LogFetchResultDO struct {
	Content string `json:"content"`
}

// HTTPFolderDO HTTP 接口目录（Apifox 式分组）。
type HTTPFolderDO struct {
	ID        string `json:"id"`
	Name      string `json:"name"`
	ParentID  string `json:"parentId"`
	SortOrder int    `json:"sortOrder"`
	CreatedAt int64  `json:"createdAt"`
	UpdatedAt int64  `json:"updatedAt"`
}

// HTTPSavedRequestDO 已保存的 HTTP 请求模板。
type HTTPSavedRequestDO struct {
	ID          string `json:"id"`
	FolderID    string `json:"folderId"`
	Name        string `json:"name"`
	Method      string `json:"method"`
	URL         string `json:"url"`
	ParamsJSON  string `json:"paramsJson"`
	HeadersJSON string `json:"headersJson"`
	CookiesJSON string `json:"cookiesJson"`
	Body        string `json:"body"`
	Notes       string `json:"notes"`
	SortOrder   int    `json:"sortOrder"`
	CreatedAt   int64  `json:"createdAt"`
	UpdatedAt   int64  `json:"updatedAt"`
}

// HTTPApiTreeLayoutDO HTTP 侧栏树布局（各父级下目录与接口的混排顺序）。
type HTTPApiTreeLayoutDO struct {
	ChildrenByParent map[string][]string `json:"childrenByParent"`
}

// ComposeServiceDO Compose 服务/容器状态。
type ComposeServiceDO struct {
	Name      string `json:"name"`
	Service   string `json:"service"`
	Image     string `json:"image"`
	State     string `json:"state"`
	Status    string `json:"status"`
	Ports     string `json:"ports"`
	Container string `json:"containerId"`
}

// ComposeLogsDO Compose 项目日志。
type ComposeLogsDO struct {
	Content string `json:"content"`
}

// ContainerLogsDO 容器日志。
type ContainerLogsDO struct {
	Content string `json:"content"`
}

// ContainerPortMappingDO 容器端口映射。
type ContainerPortMappingDO struct {
	HostPort      int    `json:"hostPort"`
	ContainerPort int    `json:"containerPort"`
	Protocol      string `json:"protocol"`
}

// ContainerRunEnvFieldDO 运行容器环境变量字段说明。
type ContainerRunEnvFieldDO struct {
	Key         string `json:"key"`
	Placeholder string `json:"placeholder"`
	Required    bool   `json:"required"`
	Secret      bool   `json:"secret"`
	Default     string `json:"default"`
}

// ContainerRunPresetDO 从镜像运行容器的预设参数。
type ContainerRunPresetDO struct {
	Image     string                   `json:"image"`
	Name      string                   `json:"name"`
	Ports     []ContainerPortMappingDO `json:"ports"`
	EnvFields []ContainerRunEnvFieldDO `json:"envFields"`
	Restart   string                   `json:"restart"`
}

// ContainerRunDO 从镜像创建容器请求。
type ContainerRunDO struct {
	Image     string                   `json:"image"`
	Name      string                   `json:"name"`
	Ports     []ContainerPortMappingDO `json:"ports"`
	Env       []ContainerEnvKVDO       `json:"env"`
	Restart   string                   `json:"restart"`
	AutoStart bool                     `json:"autoStart"`
}

// ContainerEnvKVDO 环境变量键值对。
type ContainerEnvKVDO struct {
	Key   string `json:"key"`
	Value string `json:"value"`
}

// RuntimeDO 本机语言运行时状态。
type RuntimeDO struct {
	Lang              string `json:"lang"`
	Label             string `json:"label"`
	Version           string `json:"version"`
	Manager           string `json:"manager"`
	ManagerLabel      string `json:"managerLabel"`
	Binary            string `json:"binary"`
	Available         bool   `json:"available"`
	CanInstall        bool   `json:"canInstall"`
	NeedsManager      bool   `json:"needsManager"`
	CanInstallManager bool   `json:"canInstallManager"`
}

// RuntimeVersionDO 可切换的运行时版本。
type RuntimeVersionDO struct {
	Version   string `json:"version"`
	Label     string `json:"label"`
	Formula   string `json:"formula"`
	Installed bool   `json:"installed"`
	Active    bool   `json:"active"`
}

// EnvPresetDO 工具链版本预设。
type EnvPresetDO struct {
	ID       string            `json:"id"`
	Name     string            `json:"name"`
	Active   bool              `json:"active"`
	Runtimes map[string]string `json:"runtimes"`
}

// ProjectEnvHintDO 项目目录版本线索。
type ProjectEnvHintDO struct {
	Path      string            `json:"path"`
	Hints     []string          `json:"hints"`
	Suggested map[string]string `json:"suggested"`
}

// EnvApplyResultDO 应用预设结果。
type EnvApplyResultDO struct {
	Warnings []string `json:"warnings"`
}

// NotebookGroupDO 笔记本分组。
type NotebookGroupDO struct {
	ID        string `json:"id"`
	Name      string `json:"name"`
	ParentID  string `json:"parentId"`
	SortOrder int    `json:"sortOrder"`
	CreatedAt int64  `json:"createdAt"`
	UpdatedAt int64  `json:"updatedAt"`
}

// NoteDO 笔记全文。
type NoteDO struct {
	ID           string `json:"id"`
	GroupID      string `json:"groupId"`
	Title        string `json:"title"`
	Content      string `json:"content"`
	Language     string `json:"language"`
	SSHHostID    string `json:"sshHostId"`
	ConnectionID string `json:"connectionId"`
	SortOrder    int    `json:"sortOrder"`
	CreatedAt    int64  `json:"createdAt"`
	UpdatedAt    int64  `json:"updatedAt"`
}

// NoteSummaryDO 笔记列表摘要（不含正文）。
type NoteSummaryDO struct {
	ID           string `json:"id"`
	GroupID      string `json:"groupId"`
	Title        string `json:"title"`
	Language     string `json:"language"`
	SSHHostID    string `json:"sshHostId"`
	ConnectionID string `json:"connectionId"`
	SortOrder    int    `json:"sortOrder"`
	UpdatedAt    int64  `json:"updatedAt"`
}

// NotebookUIDO 笔记本 UI 状态（打开的标签页）。
type NotebookUIDO struct {
	OpenTabIDs  []string `json:"openTabIds"`
	ActiveTabID string   `json:"activeTabId"`
}

// NotebookLayoutDO 笔记本侧栏树形布局（分组顺序与各组内笔记顺序）。
type NotebookLayoutDO struct {
	GroupOrder   []string            `json:"groupOrder"`
	NotesByGroup map[string][]string `json:"notesByGroup"`
}

// AgentCapabilityDO 单项 AI 能力（含开关状态）。
type AgentCapabilityDO struct {
	Name         string `json:"name"`
	Label        string `json:"label"`
	Risk         string `json:"risk"`
	Description  string `json:"description"`
	Enabled      bool   `json:"enabled"`
	NeedsConfirm bool   `json:"needsConfirm"`
}

// AgentSettingsDO Agent 配置（对外展示）。
type AgentSettingsDO struct {
	APIBase         string              `json:"apiBase"`
	APIKeyMask      string              `json:"apiKeyMask"`
	HasAPIKey       bool                `json:"hasApiKey"`
	Model           string              `json:"model"`
	Provider        string              `json:"provider"`
	AllowWrite      bool                `json:"allowWrite"`
	Capabilities    []AgentCapabilityDO `json:"capabilities"`
	UnavailableNote string              `json:"unavailableNote"`
}

// AgentAPIConfigSaveDO 保存 Agent API 连接配置。
type AgentAPIConfigSaveDO struct {
	APIBase  string `json:"apiBase"`
	APIKey   string `json:"apiKey"`
	Model    string `json:"model"`
	Provider string `json:"provider"`
}

// AgentPermissionsSaveDO 保存 Agent 能力权限。
type AgentPermissionsSaveDO struct {
	AllowWrite          bool   `json:"allowWrite"`
	ToolPermissionsJSON string `json:"toolPermissionsJson"`
}

// AgentSettingsSaveDO 保存 Agent 全部配置（兼容旧调用）。
type AgentSettingsSaveDO struct {
	APIBase             string `json:"apiBase"`
	APIKey              string `json:"apiKey"`
	Model               string `json:"model"`
	Provider            string `json:"provider"`
	AllowWrite          bool   `json:"allowWrite"`
	ToolPermissionsJSON string `json:"toolPermissionsJson"`
}

// MCPStatusDO MCP HTTP 运行时状态（给设置页展示）。
type MCPStatusDO struct {
	Enabled      bool   `json:"enabled"`
	Configured   bool   `json:"configured"` // 设置里是否开启
	Addr         string `json:"addr"`
	ListenAddr   string `json:"listenAddr"`
	MCPURL       string `json:"mcpUrl"`
	WorkbenchURL string `json:"workbenchUrl"`
	HealthURL    string `json:"healthUrl"`
	Error        string `json:"error,omitempty"`
}

// MCPConfigSaveDO 保存 MCP 开关与监听地址。
type MCPConfigSaveDO struct {
	Enabled bool   `json:"enabled"`
	Addr    string `json:"addr"`
}

// AgentMentionDO 用户通过 @ 选中的资源（SSH 主机或数据库连接）。
type AgentMentionDO struct {
	Kind  string `json:"kind"`
	ID    string `json:"id"`
	Label string `json:"label"`
}

// AgentContextDO 前端传入的工作台上下文（含界面快照，进 feedforward）。
type AgentContextDO struct {
	ActiveProduct     string           `json:"activeProduct"`
	SessionID         string           `json:"sessionId"`
	ConnectionID      string           `json:"connectionId"`
	Database          string           `json:"database"`
	Table             string           `json:"table,omitempty"`
	FocusKind         string           `json:"focusKind,omitempty"`  // table|design|sql|terminal.ssh|terminal.local|…
	FocusLabel        string           `json:"focusLabel,omitempty"` // 人话焦点，如 gbu_admissions.admin
	TabTitle          string           `json:"tabTitle,omitempty"`
	OpenTabsBrief     string           `json:"openTabsBrief,omitempty"` // 中栏打开标签摘要
	SelectionBrief    string           `json:"selectionBrief,omitempty"`
	ShellTail         string           `json:"shellTail,omitempty"` // 当前 Shell 最近约 100 行（与面板一致）
	TerminalSessionID string           `json:"terminalSessionId,omitempty"`
	NoteID            string           `json:"noteId,omitempty"` // 当前打开的笔记
	Mentions          []AgentMentionDO `json:"mentions"`
	SkillIDs          []string         `json:"skillIds,omitempty"` // 本对话绑定的 / 技能
}

// AgentChatImageDO 对话附件图片（data 为无前缀 base64，或 data URL）。
type AgentChatImageDO struct {
	MIME string `json:"mime"`
	Data string `json:"data"`
}

// AgentChatRequestDO 发起对话请求。
type AgentChatRequestDO struct {
	ThreadID  string             `json:"threadId"`
	Message   string             `json:"message"`
	Images    []AgentChatImageDO `json:"images,omitempty"`
	Mode      string             `json:"mode,omitempty"` // ask | agent | plan
	SkillIDs  []string           `json:"skillIds,omitempty"`
	Context   AgentContextDO     `json:"context"`
}

// AgentSkillDO Agent 技能（Skill）。
type AgentSkillDO struct {
	ID          string   `json:"id"`
	Name        string   `json:"name"`
	Description string   `json:"description"`
	Enabled     bool     `json:"enabled"`
	Globs       []string `json:"globs,omitempty"`
	Builtin     bool     `json:"builtin"`
	Content     string   `json:"content,omitempty"`
}

// AgentSkillFileSaveDO 保存技能目录下文件。
type AgentSkillFileSaveDO struct {
	Path    string `json:"path"`
	Content string `json:"content"`
}

// AgentSkillCreateDO 新建 Skill。
type AgentSkillCreateDO struct {
	ID          string `json:"id"`
	Name        string `json:"name"`
	Description string `json:"description"`
	Content     string `json:"content,omitempty"`
}

// AgentSkillSaveDO 保存 Skill（正文与可选元数据）。
type AgentSkillSaveDO struct {
	ID            string   `json:"id"`
	Content       string   `json:"content"`
	Name          string   `json:"name,omitempty"`
	Description   string   `json:"description,omitempty"`
	Globs         []string `json:"globs,omitempty"`
	UpdateContent bool     `json:"updateContent"`
	UpdateGlobs   bool     `json:"updateGlobs"`
}

// AgentSkillPublishDO 从笔记发布/更新 Skill。
type AgentSkillPublishDO struct {
	ID          string   `json:"id"`
	Name        string   `json:"name"`
	Description string   `json:"description"`
	Content     string   `json:"content"`
	Globs       []string `json:"globs,omitempty"`
	NoteID      string   `json:"noteId,omitempty"`
}

// AgentSkillEnabledDO 启用/禁用 Skill。
type AgentSkillEnabledDO struct {
	ID      string `json:"id"`
	Enabled bool   `json:"enabled"`
}

// AgentChatResultDO 对话提交结果。
type AgentChatResultDO struct {
	ThreadID string `json:"threadId"`
}

// AgentChatSyncResultDO MCP 同步对话结果。
type AgentChatSyncResultDO struct {
	ThreadID       string   `json:"threadId"`
	Reply          string   `json:"reply,omitempty"`
	SkillIDs       []string `json:"skillIds,omitempty"`
	WaitingConfirm bool     `json:"waitingConfirm,omitempty"`
	PendingID      string   `json:"pendingId,omitempty"`
}

// AgentPendingDO 待用户确认的工具调用。
type AgentPendingDO struct {
	ID        string `json:"id"`
	ThreadID  string `json:"threadId"`
	ToolName  string `json:"toolName"`
	ArgsJSON  string `json:"argsJson"`
	Summary   string `json:"summary"`
	CreatedAt int64  `json:"createdAt"`
}

// AgentMessageDO 对话消息。
type AgentMessageDO struct {
	Role     string             `json:"role"`
	Content  string             `json:"content"`
	Images   []AgentChatImageDO `json:"images,omitempty"`
	SkillIDs []string           `json:"skillIds,omitempty"`
	Seq      int                `json:"seq,omitempty"`
}

// AgentRewindRequestDO 截断工作记忆。
type AgentRewindRequestDO struct {
	ThreadID string `json:"threadId"`
	KeepSeq  int    `json:"keepSeq"`
}

// AgentThreadDO 对话线程摘要。
type AgentThreadDO struct {
	ID        string `json:"id"`
	Title     string `json:"title"`
	UpdatedAt int64  `json:"updatedAt"`
}

// AgentThreadDetailDO 对话线程详情（含上下文）。
type AgentThreadDetailDO struct {
	ID        string         `json:"id"`
	Title     string         `json:"title"`
	UpdatedAt int64          `json:"updatedAt"`
	Context   AgentContextDO `json:"context"`
}
