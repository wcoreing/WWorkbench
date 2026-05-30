package portforward

import (
	"context"
	"fmt"
	"net"
	"strconv"
	"strings"
	"sync"
	"time"

	"WNavicat/internal/errno"
	"WNavicat/internal/model"
	"WNavicat/internal/store"
	"WNavicat/internal/terminal"
	"WNavicat/internal/tunnel"

	"github.com/google/uuid"
)

type activeEntry struct {
	meta model.SSHForwardActiveDO
	tun  tunnel.Tunnel
}

// Manager 管理 SSH 本地端口转发会话。
type Manager struct {
	store *store.Store
	hosts *terminal.HostService
	mu    sync.Mutex
	active map[string]*activeEntry
}

// NewManager 创建端口转发管理器。
func NewManager(st *store.Store, hosts *terminal.HostService) *Manager {
	return &Manager{store: st, hosts: hosts, active: map[string]*activeEntry{}}
}

// CloseAll 关闭全部活动转发。
func (m *Manager) CloseAll() {
	m.mu.Lock()
	defer m.mu.Unlock()
	for id, e := range m.active {
		_ = e.tun.Close()
		delete(m.active, id)
	}
}

// ListActive 列出活动中的端口转发。
func (m *Manager) ListActive() []model.SSHForwardActiveDO {
	m.mu.Lock()
	defer m.mu.Unlock()
	out := make([]model.SSHForwardActiveDO, 0, len(m.active))
	for _, e := range m.active {
		out = append(out, e.meta)
	}
	return out
}

// ListPresets 列出已保存预设。
func (m *Manager) ListPresets() ([]model.SSHForwardPresetDO, error) {
	list, err := m.store.ListSSHForwardPresets()
	if err != nil {
		return nil, err
	}
	if list == nil {
		list = []model.SSHForwardPresetDO{}
	}
	return list, nil
}

// SavePreset 保存预设。
func (m *Manager) SavePreset(p model.SSHForwardPresetDO) (*model.SSHForwardPresetDO, error) {
	if err := validatePreset(p); err != nil {
		return nil, err
	}
	if p.ID == "" {
		p.ID = uuid.NewString()
	}
	if err := m.store.SaveSSHForwardPreset(p); err != nil {
		return nil, err
	}
	saved, err := m.store.GetSSHForwardPreset(p.ID)
	if err != nil {
		return nil, err
	}
	return saved, nil
}

// DeletePreset 删除预设。
func (m *Manager) DeletePreset(id string) error {
	return m.store.DeleteSSHForwardPreset(id)
}

// Start 启动端口转发（presetId 非空时从预设加载，否则使用 req 内联字段）。
func (m *Manager) Start(ctx context.Context, req model.SSHForwardStartDO) (*model.SSHForwardActiveDO, error) {
	p := req
	if req.PresetID != "" {
		preset, err := m.store.GetSSHForwardPreset(req.PresetID)
		if err != nil {
			return nil, err
		}
		p = model.SSHForwardStartDO{
			PresetID:   preset.ID,
			Name:       preset.Name,
			SSHHostID:  preset.SSHHostID,
			LocalPort:  preset.LocalPort,
			RemoteHost: preset.RemoteHost,
			RemotePort: preset.RemotePort,
		}
	}
	if err := validateStart(p); err != nil {
		return nil, err
	}
	host, err := m.hosts.Get(p.SSHHostID)
	if err != nil {
		return nil, err
	}
	spec := terminal.HostToSpec(*host)
	if p.LocalPort > 0 && m.isLocalPortInUse(p.LocalPort) {
		return nil, errno.New(errno.CodeInvalidArg, "本地端口已被占用", strconv.Itoa(p.LocalPort))
	}

	tun, err := tunnel.DialPortForward(ctx, spec, p.LocalPort, p.RemoteHost, p.RemotePort)
	if err != nil {
		return nil, err
	}
	localHost, localPortStr, err := splitAddr(tun.Addr())
	if err != nil {
		_ = tun.Close()
		return nil, err
	}
	localPort, _ := strconv.Atoi(localPortStr)
	name := strings.TrimSpace(p.Name)
	if name == "" {
		name = fmt.Sprintf("%s → %s:%d", host.Name, p.RemoteHost, p.RemotePort)
	}
	meta := model.SSHForwardActiveDO{
		ID:          uuid.NewString(),
		PresetID:    p.PresetID,
		Name:        name,
		SSHHostID:   host.ID,
		SSHHostName: host.Name,
		LocalHost:   localHost,
		LocalPort:   localPort,
		LocalAddr:   tun.Addr(),
		RemoteHost:  p.RemoteHost,
		RemotePort:  p.RemotePort,
		StartedAt:   time.Now().Unix(),
	}
	m.mu.Lock()
	m.active[meta.ID] = &activeEntry{meta: meta, tun: tun}
	m.mu.Unlock()
	return &meta, nil
}

// Stop 停止指定活动转发。
func (m *Manager) Stop(id string) error {
	m.mu.Lock()
	e, ok := m.active[id]
	if !ok {
		m.mu.Unlock()
		return errno.New(errno.CodeNotFound, "端口转发不存在或已停止", id)
	}
	delete(m.active, id)
	m.mu.Unlock()
	return e.tun.Close()
}

// isLocalPortInUse 检查本机端口是否已被本应用占用。
func (m *Manager) isLocalPortInUse(port int) bool {
	for _, e := range m.active {
		if e.meta.LocalPort == port {
			return true
		}
	}
	ln, err := net.Listen("tcp", fmt.Sprintf("127.0.0.1:%d", port))
	if err != nil {
		return true
	}
	_ = ln.Close()
	return false
}

// validatePreset 校验预设字段。
func validatePreset(p model.SSHForwardPresetDO) error {
	if strings.TrimSpace(p.Name) == "" {
		return errno.New(errno.CodeInvalidArg, "请填写转发名称", "")
	}
	if p.SSHHostID == "" {
		return errno.New(errno.CodeInvalidArg, "请选择 SSH 主机", "")
	}
	if strings.TrimSpace(p.RemoteHost) == "" {
		return errno.New(errno.CodeInvalidArg, "请填写远端主机", "")
	}
	if p.RemotePort <= 0 || p.RemotePort > 65535 {
		return errno.New(errno.CodeInvalidArg, "请填写有效远端端口", "")
	}
	if p.LocalPort < 0 || p.LocalPort > 65535 {
		return errno.New(errno.CodeInvalidArg, "本地端口无效", "")
	}
	return nil
}

// validateStart 校验启动请求。
func validateStart(p model.SSHForwardStartDO) error {
	if p.PresetID == "" {
		if p.SSHHostID == "" {
			return errno.New(errno.CodeInvalidArg, "请选择 SSH 主机", "")
		}
		if strings.TrimSpace(p.RemoteHost) == "" {
			return errno.New(errno.CodeInvalidArg, "请填写远端主机", "")
		}
		if p.RemotePort <= 0 || p.RemotePort > 65535 {
			return errno.New(errno.CodeInvalidArg, "请填写有效远端端口", "")
		}
	}
	return nil
}

// splitAddr 解析监听地址。
func splitAddr(addr string) (host, port string, err error) {
	h, p, err := net.SplitHostPort(addr)
	if err != nil {
		return "", "", err
	}
	return h, p, nil
}
