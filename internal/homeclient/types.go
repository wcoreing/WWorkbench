package homeclient

// 与 wwb-home 子项目 API 对齐的 DTO（本仓不依赖服务端包）。

type Project struct {
	ID        string        `json:"id"`
	Name      string        `json:"name"`
	LocalPath string        `json:"localPath"`
	GitRemote string        `json:"gitRemote,omitempty"`
	Links     []ProjectLink `json:"links"`
	UpdatedAt int64         `json:"updatedAt"`
	UpdatedBy string        `json:"updatedBy,omitempty"`
}

type ProjectLink struct {
	Kind  string `json:"kind"`
	ID    string `json:"id"`
	Label string `json:"label,omitempty"`
}

type DocMeta struct {
	Path      string `json:"path"`
	Rev       int64  `json:"rev"`
	Hash      string `json:"hash"`
	Size      int64  `json:"size"`
	UpdatedAt int64  `json:"updatedAt"`
	UpdatedBy string `json:"updatedBy,omitempty"`
}

type DocBody struct {
	Path      string `json:"path"`
	Content   string `json:"content"`
	Rev       int64  `json:"rev"`
	Hash      string `json:"hash"`
	UpdatedAt int64  `json:"updatedAt"`
}

type AuthRequest struct {
	Username string `json:"username"`
	Password string `json:"password"`
	Device   string `json:"device,omitempty"`
}

type AuthResponse struct {
	AccountID   string `json:"accountId"`
	Username    string `json:"username"`
	AccessToken string `json:"accessToken"`
}

// MarketListing 技能商店卡片。
type MarketListing struct {
	ID          string   `json:"id"`
	Name        string   `json:"name"`
	Version     string   `json:"version"`
	Root        string   `json:"root"`
	Bind        string   `json:"bind"`
	Intent      string   `json:"intent"`
	Description string   `json:"description"`
	Limits      []string `json:"limits"`
	Files       []string `json:"files"`
	AuthorID    string   `json:"authorId"`
	AuthorName  string   `json:"authorName"`
	UpdatedAt   int64    `json:"updatedAt"`
}

// MarketPackage 商店上的可安装包。
type MarketPackage struct {
	MarketListing
	Bodies map[string]string `json:"bodies"`
}

type PutDocRequest struct {
	Path    string `json:"path"`
	Content string `json:"content"`
	Rev     int64  `json:"rev"`
}

// SnapshotDoc 快照内嵌文档正文。
type SnapshotDoc struct {
	Path    string `json:"path"`
	Content string `json:"content"`
}

// WorkspaceSnapshot 全量资源快照（无明文密钥；docs 正文一并打包）。
type WorkspaceSnapshot struct {
	Projects         []Project        `json:"projects"`
	SSHHosts         []map[string]any `json:"sshHosts"`
	Connections      []map[string]any `json:"connections"`
	LogSources       []map[string]any `json:"logSources"`
	HTTPFolders      []map[string]any `json:"httpFolders"`
	HTTPRequests     []map[string]any `json:"httpRequests"`
	HTTPEnvironments []map[string]any `json:"httpEnvironments"`
	DockerContexts   []map[string]any `json:"dockerContexts"`
	DockerShellHosts []map[string]any `json:"dockerShellHosts"`
	BackupPolicies   []map[string]any `json:"backupPolicies"`
	DocIndex         []DocMeta        `json:"docIndex,omitempty"`
	Docs             []SnapshotDoc    `json:"docs,omitempty"`
}
