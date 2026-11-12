package store

// EnsureMemoryZone 记忆区已迁到磁盘工作区（~/.wworkbench/notebook/记忆区），SQLite 不再种子。
// 保留空实现以免迁移链路改动面扩大。
func (s *Store) EnsureMemoryZone() error {
	return nil
}
