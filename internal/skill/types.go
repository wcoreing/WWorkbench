package skill

// EntryFile 方法包入口文件名。
const EntryFile = "SKILL.md"

// LogFile 同目录账本投影（非包本体；导出/上架默认排除）。
const LogFile = "log.md"

// DefaultLimits 安装/上架时附带的边界说明（引导人确认，不代操作）。
var DefaultLimits = []string{
	"不会替你确认危险动作",
	"桌面步骤不会机械重放",
}

// Ref 方法包引用：目录相对路径，或 …/SKILL.md。短名解析由后端/产品策略完成。
type Ref struct {
	ID   string `json:"id"`
	Name string `json:"name,omitempty"`
	Dir  string `json:"dir,omitempty"`
	Root string `json:"root,omitempty"`
}

// Package 已装载的方法包（真源）。
type Package struct {
	Ref
	Content     string `json:"content,omitempty"`
	Description string `json:"description,omitempty"`
	Bind        string `json:"bind,omitempty"`
	Intent      string `json:"intent,omitempty"`
	Version     string `json:"version,omitempty"`
	DiskPath    string `json:"diskPath,omitempty"`
	AssetsDir   string `json:"assetsDir,omitempty"`
	NoteID      string `json:"noteId,omitempty"`
	HasSteps    bool   `json:"hasSteps,omitempty"`
}

// Patch 增量写入；空字段表示不改。Lessons 追加到「## 经验」。
type Patch struct {
	Content   string   `json:"content,omitempty"`
	Lessons   []string `json:"lessons,omitempty"`
	Steps     string   `json:"steps,omitempty"`
	Scripts   string   `json:"scripts,omitempty"`
	Resources string   `json:"resources,omitempty"`
	Replace   bool     `json:"replace,omitempty"`
}

// Version 目录版本一条。
type Version struct {
	Hash    string `json:"hash"`
	Message string `json:"message,omitempty"`
	At      string `json:"at,omitempty"`
}

// VersionStatus 版本时间轴。
type VersionStatus struct {
	ID      string    `json:"id"`
	Dir     string    `json:"dir"`
	Head    string    `json:"head,omitempty"`
	Enabled bool      `json:"enabled"`
	Working bool      `json:"working"`
	Commits []Version `json:"commits"`
}

// Bundle 可流通的版本包（货架/商店）；不含 log 与密钥类附件。
type Bundle struct {
	ID          string            `json:"id"`
	Name        string            `json:"name"`
	Version     string            `json:"version"`
	Root        string            `json:"root"`
	Bind        string            `json:"bind"`
	Intent      string            `json:"intent"`
	Description string            `json:"description"`
	Limits      []string          `json:"limits"`
	ExportedAt  string            `json:"exportedAt"`
	Files       []string          `json:"files"`
	SharedBy    string            `json:"sharedBy,omitempty"`
	SharedAt    string            `json:"sharedAt,omitempty"`
	Bodies      map[string]string `json:"bodies,omitempty"`
	// Unchanged 本次导出没有新的源文件提交，且货架上已有该版本。不写入清单。
	Unchanged bool `json:"-"`
}

// ShelfCard 本机货架上一张卡。
type ShelfCard struct {
	Bundle
	Installed    bool   `json:"installed"`
	InstalledRel string `json:"installedRel,omitempty"`
	State        string `json:"state"`
}

// InstallResult 安装结果。
type InstallResult struct {
	Rel        string `json:"rel"`
	Version    string `json:"version"`
	SideBySide bool   `json:"sideBySide"`
	Pinned     string `json:"pinned,omitempty"`
	Already    bool   `json:"already"`
}

// Asset 挂到包目录 assets/ 的附件（相对链接供正文索引）。
type Asset struct {
	Name     string `json:"name"`
	RelPath  string `json:"relPath"` // 如 assets/<id>.png
	Markdown string `json:"markdown"`
	IsImage  bool   `json:"isImage"`
	Size     int64  `json:"size"`
}
