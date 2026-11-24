package skill

// Store 方法包存储与分发原语。产品只依赖本接口，不直连具体后端。
type Store interface {
	// List 列出已安装包摘要；prefix 为空则全量（后端可限流）。Content 可为空。
	List(prefix string) ([]Package, error)
	// Get 按 id/目录/短名读取包正文（短名解析属后端约定）。
	Get(ref string) (Package, error)
	// Put 写入或增量更新；path 须为产品给出的归属目录（或已有短名）。
	Put(ref string, patch Patch) (Package, error)

	Pin(ref, message string) (Version, error)
	ListVersions(ref string, limit int) (VersionStatus, error)
	Restore(ref, hash, message string) (Version, error)

	Export(ref string) (Bundle, error)
	Install(id, version string) (InstallResult, error)
	ListShelf() ([]ShelfCard, error)
	// Materialize 把外部包写入本机货架（不安装）。
	Materialize(bundle Bundle) error
	// ReadBundleBodies 读货架版本正文，供上架。
	ReadBundleBodies(id, version string) (map[string]string, error)

	// AttachAsset 把本机文件复制到包目录 assets/；短名不存在时按 DefaultRoot 建目录。
	AttachAsset(ref, srcAbsPath string) (Asset, error)
}
