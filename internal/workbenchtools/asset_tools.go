package workbenchtools

import (
	"context"
	"encoding/json"
	"fmt"
	"strings"

	"WWorkbench/internal/conn"
	"WWorkbench/internal/model"
	"WWorkbench/internal/terminal"
	"WWorkbench/internal/turnctx"
	"WWorkbench/internal/workbench"

	"github.com/google/uuid"
)

type saveSSHHostArgs struct {
	ID       string `json:"id"`
	Name     string `json:"name"`
	Host     string `json:"host"`
	Port     int    `json:"port"`
	User     string `json:"user"`
	Password string `json:"password"`
	KeyPath  string `json:"keyPath"`
	Reveal   *bool  `json:"reveal"`
}

type saveConnectionArgs struct {
	ID         string `json:"id"`
	Name       string `json:"name"`
	Group      string `json:"group"`
	DbType     string `json:"dbType"`
	Host       string `json:"host"`
	Port       int    `json:"port"`
	User       string `json:"user"`
	Password   string `json:"password"`
	Database   string `json:"database"`
	SSHEnabled bool   `json:"sshEnabled"`
	SSHHostID  string `json:"sshHostId"`
	Reveal     *bool  `json:"reveal"`
}

type saveLogSourceArgs struct {
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
	Reveal          *bool  `json:"reveal"`
}

func revealOrDefault(p *bool) bool {
	if p == nil {
		return true
	}
	return *p
}

// toolSaveSSHHost 保存 SSH 主机资产并广播雷达。
func toolSaveSSHHost(_ context.Context, d *Deps, raw json.RawMessage) ToolResult {
	if d.SSHHosts == nil {
		return Fail("SSH 服务未就绪")
	}
	var in saveSSHHostArgs
	if err := json.Unmarshal(raw, &in); err != nil {
		return Fail("参数无效")
	}
	host := strings.TrimSpace(in.Host)
	user := strings.TrimSpace(in.User)
	port := in.Port
	if cmdUser, cmdHost, cmdPort, ok := turnctx.ParseSSHTarget(host); ok {
		if cmdHost != "" {
			host = cmdHost
		}
		if cmdUser != "" {
			user = cmdUser
		}
		if cmdPort > 0 {
			port = cmdPort
		}
	}
	if host == "" || user == "" {
		return Fail("请填写 host 与 user")
	}
	if port <= 0 {
		port = 22
	}
	name := strings.TrimSpace(in.Name)
	if name == "" {
		name = fmt.Sprintf("%s@%s", user, host)
	}
	keyPath := strings.TrimSpace(in.KeyPath)
	password := in.Password
	if keyPath == "" && password == "" {
		return Fail("请填写 keyPath（推荐 ~/.ssh/id_ed25519）或 password；勿在对话中复述密码")
	}
	op := workbench.RadarOpUpdate
	id := strings.TrimSpace(in.ID)
	if id == "" {
		op = workbench.RadarOpCreate
	}
	saved, err := d.SSHHosts.Save(model.SSHHostDO{
		ID: id, Name: name, Host: host, Port: port, User: user,
		Password: password, KeyPath: keyPath,
	})
	if err != nil {
		return Fail(err.Error())
	}
	out := *saved
	terminal.StripSecrets(&out)
	reveal := revealOrDefault(in.Reveal)
	if d.Radar != nil {
		d.Radar.EmitSSHHost(op, out.ID, "agent-ssh-save", out.Name, reveal)
	}
	return OKData(map[string]interface{}{
		"ok": true, "op": op, "id": out.ID, "name": out.Name,
		"host": out.Host, "port": out.Port, "user": out.User, "keyPath": out.KeyPath,
		"note": "已写入 SSH 资产；界面将刷新。后续用 hostId 调用 shell_run / shell_probe。",
	})
}

// toolSaveConnection 保存数据库连接资产并广播雷达。
func toolSaveConnection(_ context.Context, d *Deps, raw json.RawMessage) ToolResult {
	if d.Conns == nil {
		return Fail("连接服务未就绪")
	}
	var in saveConnectionArgs
	if err := json.Unmarshal(raw, &in); err != nil {
		return Fail("参数无效")
	}
	dbType := strings.ToLower(strings.TrimSpace(in.DbType))
	if dbType == "" {
		dbType = "mysql"
	}
	switch dbType {
	case "mysql", "postgresql", "postgres", "redis", "sqlite":
		if dbType == "postgres" {
			dbType = "postgresql"
		}
	default:
		return Fail("dbType 支持 mysql / postgresql / redis / sqlite")
	}
	name := strings.TrimSpace(in.Name)
	host := strings.TrimSpace(in.Host)
	if host == "" {
		return Fail("请填写 host（sqlite 填文件路径）")
	}
	if name == "" {
		name = host
	}
	op := workbench.RadarOpUpdate
	id := strings.TrimSpace(in.ID)
	if id == "" {
		op = workbench.RadarOpCreate
	}
	c := model.ConnectionDO{
		ID: id, Name: name, Group: strings.TrimSpace(in.Group),
		DbType: dbType, Host: host, Port: in.Port,
		User: strings.TrimSpace(in.User), Password: in.Password,
		Database:   strings.TrimSpace(in.Database),
		SSHEnabled: in.SSHEnabled, SSHHostID: strings.TrimSpace(in.SSHHostID),
	}
	if id != "" && c.Password == "" {
		if existing, err := d.Conns.Get(id); err == nil {
			c.Password = existing.Password
			if c.SSHPassword == "" {
				c.SSHPassword = existing.SSHPassword
			}
		}
	}
	saved, err := d.Conns.Save(c)
	if err != nil {
		return Fail(err.Error())
	}
	out := *saved
	conn.StripSecrets(&out)
	reveal := revealOrDefault(in.Reveal)
	if d.Radar != nil {
		d.Radar.EmitConnection(op, out.ID, "agent-db-save", out.Name, reveal)
	}
	note := "已写入数据库连接资产；界面将刷新。后续用 connectionId 调用 database_open / open_database_session。"
	if in.Password == "" && dbType != "sqlite" {
		note += " 未写入密码时请在连接编辑里补全后再测通。"
	}
	return OKData(map[string]interface{}{
		"ok": true, "op": op, "id": out.ID, "name": out.Name,
		"dbType": out.DbType, "host": out.Host, "port": out.Port, "database": out.Database,
		"note": note,
	})
}

// toolSaveLogSource 保存日志源资产并广播雷达。
func toolSaveLogSource(_ context.Context, d *Deps, raw json.RawMessage) ToolResult {
	if d.Store == nil {
		return Fail("存储未就绪")
	}
	var in saveLogSourceArgs
	if err := json.Unmarshal(raw, &in); err != nil {
		return Fail("参数无效")
	}
	srcType := strings.TrimSpace(in.SourceType)
	name := strings.TrimSpace(in.Name)
	if name == "" {
		return Fail("请填写 name")
	}
	src := model.LogSourceDO{
		ID:              strings.TrimSpace(in.ID),
		Name:            name,
		SourceType:      srcType,
		Path:            strings.TrimSpace(in.Path),
		SSHHostID:       strings.TrimSpace(in.SSHHostID),
		DockerContextID: strings.TrimSpace(in.DockerContextID),
		ContainerID:     strings.TrimSpace(in.ContainerID),
		ComposeDir:      strings.TrimSpace(in.ComposeDir),
		ComposeService:  strings.TrimSpace(in.ComposeService),
		TailLines:       in.TailLines,
	}
	if err := validateAgentLogSource(src); err != nil {
		return Fail(err.Error())
	}
	op := workbench.RadarOpUpdate
	if src.ID == "" {
		op = workbench.RadarOpCreate
		src.ID = uuid.NewString()
	}
	if err := d.Store.SaveLogSource(src); err != nil {
		return Fail(err.Error())
	}
	saved, err := d.Store.GetLogSource(src.ID)
	if err != nil {
		return Fail(err.Error())
	}
	reveal := revealOrDefault(in.Reveal)
	if d.Radar != nil {
		d.Radar.EmitLogSource(op, saved.ID, "agent-log-save", saved.Name, reveal)
	}
	return OKData(map[string]interface{}{
		"ok": true, "op": op, "id": saved.ID, "name": saved.Name,
		"sourceType": saved.SourceType,
		"note":       "已写入日志源资产；界面将刷新。后续用 logSourceId 调用 fetch_logs。",
	})
}

func validateAgentLogSource(src model.LogSourceDO) error {
	switch src.SourceType {
	case model.LogSourceLocalFile:
		if src.Path == "" {
			return fmt.Errorf("local_file 需填写 path")
		}
	case model.LogSourceSSHFile:
		if src.SSHHostID == "" || src.Path == "" {
			return fmt.Errorf("ssh_file 需填写 sshHostId 与 path")
		}
	case model.LogSourceDocker:
		if src.DockerContextID == "" || src.ContainerID == "" {
			return fmt.Errorf("docker 需填写 dockerContextId 与 containerId")
		}
	case model.LogSourceCompose:
		if src.DockerContextID == "" || src.ComposeDir == "" {
			return fmt.Errorf("compose 需填写 dockerContextId 与 composeDir")
		}
	default:
		return fmt.Errorf("sourceType 支持 local_file / ssh_file / docker / compose")
	}
	return nil
}

type saveDockerContextArgs struct {
	ID        string `json:"id"`
	Name      string `json:"name"`
	SSHHostID string `json:"sshHostId"`
	Reveal    *bool  `json:"reveal"`
}

type saveHTTPEnvArgs struct {
	ID       string `json:"id"`
	Name     string `json:"name"`
	VarsJSON string `json:"varsJson"`
	Reveal   *bool  `json:"reveal"`
}

type saveSSHForwardArgs struct {
	ID         string `json:"id"`
	Name       string `json:"name"`
	SSHHostID  string `json:"sshHostId"`
	LocalPort  int    `json:"localPort"`
	RemoteHost string `json:"remoteHost"`
	RemotePort int    `json:"remotePort"`
	Reveal     *bool  `json:"reveal"`
}

// toolSaveDockerContext 保存 SSH Docker 上下文资产并广播雷达。
func toolSaveDockerContext(_ context.Context, d *Deps, raw json.RawMessage) ToolResult {
	if d.Docker == nil {
		return Fail("Docker 服务未就绪")
	}
	var in saveDockerContextArgs
	if err := json.Unmarshal(raw, &in); err != nil {
		return Fail("参数无效")
	}
	sshHostID := strings.TrimSpace(in.SSHHostID)
	if sshHostID == "" {
		return Fail("请填写 sshHostId（来自 list_ssh_hosts / save_ssh_host）")
	}
	name := strings.TrimSpace(in.Name)
	if name == "" {
		if h, err := d.SSHHosts.Get(sshHostID); err == nil {
			name = "SSH · " + h.Name
		} else {
			name = "SSH Docker"
		}
	}
	op := workbench.RadarOpUpdate
	id := strings.TrimSpace(in.ID)
	if id == "" {
		op = workbench.RadarOpCreate
		id = uuid.NewString()
	}
	saved, err := d.Docker.SaveContext(model.DockerContextDO{
		ID: id, Name: name, Kind: "ssh", SSHHostID: sshHostID,
	})
	if err != nil {
		return Fail(err.Error())
	}
	reveal := revealOrDefault(in.Reveal)
	if d.Radar != nil {
		d.Radar.EmitDockerContext(op, saved.ID, "agent-docker-ctx-save", saved.Name, reveal)
	}
	return OKData(map[string]interface{}{
		"ok": true, "op": op, "id": saved.ID, "name": saved.Name,
		"sshHostId": saved.SSHHostID,
		"note":      "已写入 Docker 上下文；界面将刷新。后续用 contextId 调用 list_containers / get_container_logs。",
	})
}

// toolSaveHTTPEnvironment 保存 HTTP 环境变量预设并广播雷达。
func toolSaveHTTPEnvironment(_ context.Context, d *Deps, raw json.RawMessage) ToolResult {
	if d.Store == nil {
		return Fail("存储未就绪")
	}
	var in saveHTTPEnvArgs
	if err := json.Unmarshal(raw, &in); err != nil {
		return Fail("参数无效")
	}
	name := strings.TrimSpace(in.Name)
	if name == "" {
		return Fail("请填写 name")
	}
	varsJSON := strings.TrimSpace(in.VarsJSON)
	if varsJSON == "" {
		varsJSON = "{}"
	}
	if !json.Valid([]byte(varsJSON)) {
		return Fail("varsJson 须为合法 JSON 对象，如 {\"baseUrl\":\"https://api.example.com\"}")
	}
	op := workbench.RadarOpUpdate
	id := strings.TrimSpace(in.ID)
	if id == "" {
		op = workbench.RadarOpCreate
	}
	e := model.HTTPEnvironmentDO{ID: id, Name: name, VarsJSON: varsJSON}
	if err := d.Store.SaveHTTPEnvironment(&e); err != nil {
		return Fail(err.Error())
	}
	saved, err := d.Store.GetHTTPEnvironment(e.ID)
	if err != nil {
		return Fail(err.Error())
	}
	reveal := revealOrDefault(in.Reveal)
	if d.Radar != nil {
		d.Radar.EmitHTTPEnv(op, saved.ID, "agent-http-env-save", saved.Name, reveal)
	}
	return OKData(map[string]interface{}{
		"ok": true, "op": op, "id": saved.ID, "name": saved.Name,
		"varsJson": saved.VarsJSON,
		"note":     "已写入 HTTP 环境；execute_http 时可传 envId 做 {{var}} 替换。",
	})
}

// toolListSSHForwardPresets 列出 SSH 端口转发预设。
func toolListSSHForwardPresets(_ context.Context, d *Deps, _ json.RawMessage) ToolResult {
	if d.Store == nil {
		return Fail("存储未就绪")
	}
	list, err := d.Store.ListSSHForwardPresets()
	if err != nil {
		return Fail(err.Error())
	}
	return OKData(list)
}

// toolSaveSSHForwardPreset 保存 SSH 端口转发预设并广播雷达。
func toolSaveSSHForwardPreset(_ context.Context, d *Deps, raw json.RawMessage) ToolResult {
	if d.Store == nil {
		return Fail("存储未就绪")
	}
	var in saveSSHForwardArgs
	if err := json.Unmarshal(raw, &in); err != nil {
		return Fail("参数无效")
	}
	name := strings.TrimSpace(in.Name)
	sshHostID := strings.TrimSpace(in.SSHHostID)
	remoteHost := strings.TrimSpace(in.RemoteHost)
	if name == "" {
		return Fail("请填写 name")
	}
	if sshHostID == "" {
		return Fail("请填写 sshHostId")
	}
	if remoteHost == "" {
		return Fail("请填写 remoteHost")
	}
	if in.RemotePort <= 0 || in.RemotePort > 65535 {
		return Fail("请填写有效 remotePort（1–65535）")
	}
	if in.LocalPort < 0 || in.LocalPort > 65535 {
		return Fail("localPort 无效（0 表示启动时自动分配）")
	}
	if _, err := d.SSHHosts.Get(sshHostID); err != nil {
		return Fail("sshHostId 无效：" + err.Error())
	}
	op := workbench.RadarOpUpdate
	id := strings.TrimSpace(in.ID)
	if id == "" {
		op = workbench.RadarOpCreate
		id = uuid.NewString()
	}
	p := model.SSHForwardPresetDO{
		ID: id, Name: name, SSHHostID: sshHostID,
		LocalPort: in.LocalPort, RemoteHost: remoteHost, RemotePort: in.RemotePort,
	}
	if err := d.Store.SaveSSHForwardPreset(p); err != nil {
		return Fail(err.Error())
	}
	saved, err := d.Store.GetSSHForwardPreset(id)
	if err != nil {
		return Fail(err.Error())
	}
	reveal := revealOrDefault(in.Reveal)
	if d.Radar != nil {
		d.Radar.EmitSSHForward(op, saved.ID, "agent-ssh-forward-save", saved.Name, reveal)
	}
	return OKData(map[string]interface{}{
		"ok": true, "op": op, "id": saved.ID, "name": saved.Name,
		"sshHostId": saved.SSHHostID, "localPort": saved.LocalPort,
		"remoteHost": saved.RemoteHost, "remotePort": saved.RemotePort,
		"note": "已写入端口转发预设；用户可在终端侧栏一键启动。",
	})
}
