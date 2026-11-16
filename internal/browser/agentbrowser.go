package browser

import (
	"bytes"
	"context"
	"encoding/json"
	"os"
	"os/exec"
	"path/filepath"
	"runtime"
	"strings"
	"sync"

	"WWorkbench/internal/errno"
)

// ExecutorNameAgentBrowser vercel-labs/agent-browser：CLI + 守护进程，经 CDP 驱动独立 Chrome（免装扩展）。
const ExecutorNameAgentBrowser = "agent-browser"

// AgentBrowserInstallHint 未安装时的前馈提示。
const AgentBrowserInstallHint = "npm install -g agent-browser，或把 release 二进制放到 ~/.wworkbench/toolchains/agent-browser/"

// agentBrowserSession 工作台独占的 agent-browser 会话名。
// 所有任务共用这一个浏览器（与扩展一致：单浏览器 + 单当前标签），登录态才能跨任务复用。
const agentBrowserSession = "wworkbench"

// AgentBrowserExecutor 以子进程调用 agent-browser；任务 session 只用于归属标签，不映射成独立浏览器。
type AgentBrowserExecutor struct {
	dataDir string

	mu   sync.Mutex
	tabs map[string][]string // 任务 session → 该任务新开的标签（tN）；key 存在即表示该任务在用浏览器
}

// NewAgentBrowserExecutor dataDir 为工作台数据目录（profile、截图落在其下）。
func NewAgentBrowserExecutor(dataDir string) *AgentBrowserExecutor {
	return &AgentBrowserExecutor{dataDir: dataDir, tabs: map[string][]string{}}
}

func (e *AgentBrowserExecutor) Name() string { return ExecutorNameAgentBrowser }

func (e *AgentBrowserExecutor) Available(_ context.Context) bool {
	return e != nil && e.Bin() != ""
}

// Info 供 browser_status 前馈：与扩展执行器的差异在动手前说清。
func (e *AgentBrowserExecutor) Info(_ context.Context) map[string]interface{} {
	out := map[string]interface{}{
		"capabilities": AgentBrowserCapabilities,
		"note": "独立 Chrome（工作台专用 profile，登录一次后保留），免装扩展；首次访问需登录的站点时请用户在弹出的窗口里登录。" +
			"ref 取快照里的 [ref=eN]，传 ref=@eN；iframe 内元素已内联进快照，直接用 ref，无需 frame / open_frame；" +
			"不支持 group_session（没有用户标签可借）与录制",
	}
	if bin := e.Bin(); bin != "" {
		out["bin"] = bin
		out["profile"] = e.profileDir()
	} else {
		out["install"] = AgentBrowserInstallHint
	}
	return out
}

// Bin 定位 agent-browser：工作台工具链目录优先，其次 PATH，再回退常见全局安装目录（GUI 进程的 PATH 往往不含它们）。
func (e *AgentBrowserExecutor) Bin() string {
	if e == nil {
		return ""
	}
	name := "agent-browser"
	if runtime.GOOS == "windows" {
		name += ".exe"
	}
	if p := firstExecutable(name, filepath.Join(e.dataDir, "toolchains", "agent-browser")); p != "" {
		return p
	}
	if p, err := exec.LookPath("agent-browser"); err == nil {
		return p
	}
	if runtime.GOOS == "windows" {
		return ""
	}
	dirs := []string{"/opt/homebrew/bin", "/usr/local/bin"}
	if home, err := os.UserHomeDir(); err == nil {
		dirs = append(dirs, filepath.Join(home, ".npm-global", "bin"), filepath.Join(home, ".local", "bin"))
	}
	return firstExecutable(name, dirs...)
}

func firstExecutable(name string, dirs ...string) string {
	for _, dir := range dirs {
		p := filepath.Join(dir, name)
		if st, err := os.Stat(p); err == nil && !st.IsDir() {
			return p
		}
	}
	return ""
}

func (e *AgentBrowserExecutor) profileDir() string {
	return filepath.Join(e.dataDir, "agent-browser", "profile")
}

// Close 关闭工作台的浏览器与守护进程（登录态留在 profile）；应用退出时调用。
func (e *AgentBrowserExecutor) Close(ctx context.Context) error {
	if e == nil || !e.Available(ctx) || !e.running(ctx) {
		return nil
	}
	e.mu.Lock()
	e.tabs = map[string][]string{}
	e.mu.Unlock()
	_, err := e.one(ctx, "close")
	return err
}

// touch 标记任务在用浏览器。
func (e *AgentBrowserExecutor) touch(session string) {
	e.mu.Lock()
	defer e.mu.Unlock()
	if _, ok := e.tabs[session]; !ok {
		e.tabs[session] = nil
	}
}

// own 记录任务新开的标签，close_session 时回收。
func (e *AgentBrowserExecutor) own(session, tab string) {
	e.mu.Lock()
	defer e.mu.Unlock()
	e.tabs[session] = append(e.tabs[session], tab)
}

// release 任务收口：返回它新开的标签，以及仍在用浏览器的其他任务数。
func (e *AgentBrowserExecutor) release(session string) (owned []string, others int) {
	e.mu.Lock()
	defer e.mu.Unlock()
	owned = e.tabs[session]
	delete(e.tabs, session)
	return owned, len(e.tabs)
}

// running 浏览器是否已启动。session list 不会拉起浏览器（tab list 等页面命令会）。
func (e *AgentBrowserExecutor) running(ctx context.Context) bool {
	out, err := e.exec(ctx, nil, "--json", "session", "list")
	if err != nil {
		return false
	}
	var res struct {
		Data struct {
			Sessions []string `json:"sessions"`
		} `json:"data"`
	}
	if json.Unmarshal(out, &res) != nil {
		return false
	}
	for _, s := range res.Data.Sessions {
		if s == agentBrowserSession {
			return true
		}
	}
	return false
}

// abStep 批量模式下单条命令的结果。
type abStep struct {
	Success bool                   `json:"success"`
	Error   string                 `json:"error"`
	Result  map[string]interface{} `json:"result"`
}

// run 经 stdin 批量通道顺序执行命令，遇错即停。
// 只走这一条通道：批量模式下参数按字面传递，而命令行直传会把「--xxx」开头的文本当成 flag 吞掉（fill 会被静默填成空）。
// 返回已成功各步的结果；err 为首个失败步的原因。outer 是必须放在 batch 外层的全局 flag。
func (e *AgentBrowserExecutor) run(ctx context.Context, outer []string, cmds ...[]string) ([]map[string]interface{}, error) {
	stdin, err := json.Marshal(cmds)
	if err != nil {
		return nil, err
	}
	args := append([]string{"--json"}, outer...)
	out, err := e.exec(ctx, stdin, append(args, "batch", "--bail")...)
	if err != nil {
		return nil, err
	}
	var steps []abStep
	if json.Unmarshal(out, &steps) != nil {
		var top struct {
			Error string `json:"error"`
		}
		if json.Unmarshal(out, &top) == nil && top.Error != "" {
			return nil, errStr(top.Error)
		}
		return nil, errno.New(errno.CodeConnFailed, "agent-browser 返回非 JSON", truncateText(string(out), 400))
	}
	results := make([]map[string]interface{}, 0, len(steps))
	for _, st := range steps {
		if !st.Success {
			if st.Error == "" {
				st.Error = "agent-browser 执行失败"
			}
			return results, errStr(st.Error)
		}
		if st.Result == nil {
			st.Result = map[string]interface{}{}
		}
		delete(st.Result, "lifecycle") // 守护进程生命周期信息，对调用方是噪音
		results = append(results, st.Result)
	}
	if len(results) < len(cmds) {
		return results, errStr("agent-browser 未执行完全部命令")
	}
	return results, nil
}

// one 执行单条命令。
func (e *AgentBrowserExecutor) one(ctx context.Context, cmd ...string) (map[string]interface{}, error) {
	res, err := e.run(ctx, nil, cmd)
	if err != nil {
		return nil, err
	}
	return res[0], nil
}

// exec 启动 agent-browser 子进程；会话、profile、有头模式经环境变量固定，保证每次调用落到同一个浏览器。
func (e *AgentBrowserExecutor) exec(ctx context.Context, stdin []byte, args ...string) ([]byte, error) {
	bin := e.Bin()
	if bin == "" {
		return nil, errno.New(errno.CodeConnFailed, "未找到 agent-browser", AgentBrowserInstallHint)
	}
	cmd := exec.CommandContext(ctx, bin, args...)
	cmd.Env = append(os.Environ(),
		// npm 全局安装的入口依赖同目录的 node；GUI 进程 PATH 可能不含该目录
		"PATH="+filepath.Dir(bin)+string(os.PathListSeparator)+os.Getenv("PATH"),
		"AGENT_BROWSER_SESSION="+agentBrowserSession,
		"AGENT_BROWSER_PROFILE="+e.profileDir(),
		"AGENT_BROWSER_HEADED=1",
	)
	cmd.Stdin = bytes.NewReader(stdin)
	var stdout, stderr bytes.Buffer
	cmd.Stdout, cmd.Stderr = &stdout, &stderr
	runErr := cmd.Run()
	if stdout.Len() > 0 {
		return stdout.Bytes(), nil // 命令失败时退出码非 0，但 stdout 仍是带 error 的 JSON
	}
	if ctx.Err() != nil {
		return nil, errno.Wrap(errno.CodeConnFailed, "agent-browser 调用超时", ctx.Err())
	}
	detail := strings.TrimSpace(stderr.String())
	if detail == "" && runErr != nil {
		detail = runErr.Error()
	}
	return nil, errno.New(errno.CodeConnFailed, "agent-browser 调用失败", truncateText(detail, 400))
}

func truncateText(s string, max int) string {
	r := []rune(s)
	if len(r) <= max {
		return s
	}
	return string(r[:max]) + "…"
}
