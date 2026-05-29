package adapter

import (
	"fmt"
	"sync"

	"WNavicat/internal/errno"
)

// Registry 适配器注册表。
type Registry struct {
	mu       sync.RWMutex
	adapters map[string]DatabaseAdapter
}

// NewRegistry 创建注册表。
func NewRegistry() *Registry {
	return &Registry{adapters: make(map[string]DatabaseAdapter)}
}

// Register 注册适配器。
func (r *Registry) Register(a DatabaseAdapter) {
	r.mu.Lock()
	defer r.mu.Unlock()
	r.adapters[a.Type()] = a
}

// Get 按类型获取适配器。
func (r *Registry) Get(dbType string) (DatabaseAdapter, error) {
	r.mu.RLock()
	defer r.mu.RUnlock()
	a, ok := r.adapters[dbType]
	if !ok {
		return nil, errno.New(errno.CodeInvalidArg, fmt.Sprintf("不支持的数据库类型: %s", dbType), "")
	}
	return a, nil
}
