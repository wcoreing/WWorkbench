package tunnel

import (
	"context"
	"fmt"

	"WNavicat/internal/model"
)

// Tunnel 隧道连接。
type Tunnel interface {
	// Addr 返回数据库可达地址，如 127.0.0.1:port。
	Addr() string
	// Close 关闭隧道。
	Close() error
}

// directTunnel 直连隧道。
type directTunnel struct {
	addr string
}

func (d *directTunnel) Addr() string { return d.addr }
func (d *directTunnel) Close() error { return nil }

// Provider 隧道提供者。
type Provider interface {
	// Dial 建立隧道；未启用 SSH 时直连目标 host:port。
	Dial(ctx context.Context, spec model.TunnelSpecDO, targetHost string, targetPort int) (Tunnel, error)
}

// DefaultProvider 根据配置选择 SSH 或直连。
type DefaultProvider struct{}

// NewProvider 创建默认隧道提供者。
func NewProvider() Provider {
	return DefaultProvider{}
}

// Dial 建立隧道。
func (DefaultProvider) Dial(ctx context.Context, spec model.TunnelSpecDO, targetHost string, targetPort int) (Tunnel, error) {
	if spec.Enabled {
		return dialSSH(ctx, spec, targetHost, targetPort)
	}
	return &directTunnel{addr: fmt.Sprintf("%s:%d", targetHost, targetPort)}, nil
}
