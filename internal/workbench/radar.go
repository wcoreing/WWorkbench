package workbench

// 资产雷达：应用型 Desk 的「落盘可见」契约（对齐 agentdesk workspace-changed，载体为 SQLite 资产而非文件）。

const RadarEventName = "workbench-changed"

// 资产域。
const (
	RadarDomainHTTPRequest     = "http.request"
	RadarDomainHTTPEnv         = "http.env"
	RadarDomainHTTPFolder      = "http.folder"
	RadarDomainNotebookNote    = "notebook.note"
	RadarDomainDockerContainer = "docker.container"
)

// 变更操作。
const (
	RadarOpCreate = "create"
	RadarOpUpdate = "update"
	RadarOpDelete = "delete"
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
