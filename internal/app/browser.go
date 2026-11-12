package app

import (
	"context"
	"encoding/base64"
	"encoding/json"
	"fmt"
	"log"
	"os"
	"os/exec"
	"path/filepath"
	goruntime "runtime"
	"strings"
	"time"

	"WWorkbench/internal/browser"
	"WWorkbench/internal/errno"
	"WWorkbench/internal/model"
	"WWorkbench/internal/notebook"
	"WWorkbench/internal/store"
	"WWorkbench/internal/workbenchtools"

	"github.com/wailsapp/wails/v2/pkg/runtime"
)

func (s *Service) startBrowserBridge() {
	dataDir, err := store.DataDir()
	if err != nil {
		log.Printf("browser: data dir: %v", err)
		return
	}
	extDir, err := browser.SeedExtDir(dataDir)
	if err != nil {
		log.Printf("browser: seed ext: %v", err)
		return
	}
	b := browser.NewBridge(browser.DefaultAddr, extDir)
	if err := b.Start(); err != nil {
		log.Printf("browser: start bridge: %v", err)
		return
	}
	b.SetEventHandler(s.handleBrowserExtEvent)
	s.browserBridge = b
	log.Printf("browser: bridge on %s · ext %s", browser.DefaultAddr, extDir)
}

// GetBrowserStatus 浏览器舞台状态（桥 + 扩展）。
func (s *Service) GetBrowserStatus() ApiResult[browser.Status] {
	if s.browserBridge == nil {
		return ErrResult[browser.Status](errno.New(errno.CodeConnFailed, "浏览器桥未启动", ""))
	}
	st := s.browserBridge.Status()
	st.SeedVersion = browser.SeedVersion()
	if st.ExtensionConnected {
		if data, err := s.browserBridge.Call(browserCtx(s), "status", map[string]interface{}{}); err == nil {
			var extra struct {
				AttachedTabID    *int64   `json:"attachedTabId"`
				Version          string   `json:"version"`
				Capabilities     []string `json:"capabilities"`
				Recording        bool     `json:"recording"`
				RecordingSession string   `json:"recordingSession"`
			}
			if json.Unmarshal(data, &extra) == nil {
				if extra.Version != "" {
					st.ExtVersion = extra.Version
				}
				if len(extra.Capabilities) > 0 {
					st.Capabilities = extra.Capabilities
				}
				if extra.AttachedTabID != nil {
					st.AttachedTabID = extra.AttachedTabID
				}
				st.Recording = extra.Recording
				st.RecordingSession = extra.RecordingSession
			}
		}
	}
	if st.ExtVersion != "" && st.SeedVersion != "" && st.ExtVersion != st.SeedVersion {
		st.VersionMismatch = true
		hint := "扩展磁盘已是 " + st.SeedVersion + "，Chrome 仍在跑 " + st.ExtVersion + "：请到 chrome://extensions 点「重新加载」，否则 screenshot/find 等会报未知动作"
		if st.LastError == "" {
			st.LastError = hint
		}
	}
	return OkResult(st)
}

// ListBrowserTabs 列出扩展可见标签。
func (s *Service) ListBrowserTabs() ApiResult[json.RawMessage] {
	if s.browserBridge == nil {
		return ErrResult[json.RawMessage](errno.New(errno.CodeConnFailed, "浏览器桥未启动", ""))
	}
	data, err := s.browserBridge.Call(s.ctx, "list_tabs", map[string]interface{}{})
	if err != nil {
		return ErrResult[json.RawMessage](err)
	}
	return OkResult(data)
}

// AttachBrowserTab 附着指定标签。
func (s *Service) AttachBrowserTab(tabID int64) ApiResult[json.RawMessage] {
	if s.browserBridge == nil {
		return ErrResult[json.RawMessage](errno.New(errno.CodeConnFailed, "浏览器桥未启动", ""))
	}
	if tabID <= 0 {
		return ErrResult[json.RawMessage](errno.New(errno.CodeInvalidArg, "请提供 tabId", ""))
	}
	data, err := s.browserBridge.Call(s.ctx, "attach", map[string]interface{}{"tabId": tabID})
	if err != nil {
		return ErrResult[json.RawMessage](err)
	}
	return OkResult(data)
}

// BrowserSnapshot 读取已附着页快照（frame=#f0 主文档，#f1… 同域 iframe）。
func (s *Service) BrowserSnapshot(maxNodes int, frame string) ApiResult[json.RawMessage] {
	if s.browserBridge == nil {
		return ErrResult[json.RawMessage](errno.New(errno.CodeConnFailed, "浏览器桥未启动", ""))
	}
	args := map[string]interface{}{}
	if maxNodes > 0 {
		args["maxNodes"] = maxNodes
	}
	if frame = strings.TrimSpace(frame); frame != "" {
		args["frame"] = frame
	}
	data, err := s.browserBridge.Call(browserCtx(s), "snapshot", args)
	if err != nil {
		return ErrResult[json.RawMessage](err)
	}
	return OkResult(data)
}

// BrowserClick 点击已附着页元素（ref 或 selector；mode=auto|pointer|dom；可选 frame）。
func (s *Service) BrowserClick(ref, selector, mode, frame string) ApiResult[json.RawMessage] {
	if s.browserBridge == nil {
		return ErrResult[json.RawMessage](errno.New(errno.CodeConnFailed, "浏览器桥未启动", ""))
	}
	ref, selector, mode, frame = strings.TrimSpace(ref), strings.TrimSpace(selector), strings.TrimSpace(mode), strings.TrimSpace(frame)
	if ref == "" && selector == "" {
		return ErrResult[json.RawMessage](errno.New(errno.CodeInvalidArg, "请提供 ref 或 selector", ""))
	}
	args := map[string]interface{}{"ref": ref, "selector": selector}
	if mode != "" {
		args["mode"] = mode
	}
	if frame != "" {
		args["frame"] = frame
	}
	data, err := s.browserBridge.Call(browserCtx(s), "click", args)
	if err != nil {
		if s.toolsRegistry != nil {
			workbenchtools.RecordBrowserStep(s.toolsRegistry.Deps(), workbenchtools.BrowserStepInput{
				Tool: "browser_click", Action: "click", Summary: "舞台点击 " + ref, Source: "ui",
				Args: args, Locator: map[string]interface{}{"ref": ref, "selector": selector, "frame": frame},
				OK: false, Error: err.Error(),
			})
		}
		return ErrResult[json.RawMessage](err)
	}
	if s.toolsRegistry != nil {
		workbenchtools.RecordBrowserStep(s.toolsRegistry.Deps(), workbenchtools.BrowserStepInput{
			Tool: "browser_click", Action: "click", Summary: "舞台点击 " + ref, Source: "ui",
			Args: args, Locator: map[string]interface{}{"ref": ref, "selector": selector, "frame": frame},
			Result: data, OK: true,
		})
	}
	return OkResult(data)
}

// BrowserFind 按文案/角色筛选快照节点。
func (s *Service) BrowserFind(query string, maxNodes int, frame string) ApiResult[json.RawMessage] {
	if s.browserBridge == nil {
		return ErrResult[json.RawMessage](errno.New(errno.CodeConnFailed, "浏览器桥未启动", ""))
	}
	query = strings.TrimSpace(query)
	if query == "" {
		return ErrResult[json.RawMessage](errno.New(errno.CodeInvalidArg, "请提供 query", ""))
	}
	args := map[string]interface{}{"query": query}
	if maxNodes > 0 {
		args["maxNodes"] = maxNodes
	}
	if frame = strings.TrimSpace(frame); frame != "" {
		args["frame"] = frame
	}
	data, err := s.browserBridge.Call(browserCtx(s), "find", args)
	if err != nil {
		return ErrResult[json.RawMessage](err)
	}
	return OkResult(data)
}

// BrowserWait 等待页面出现/消失某文案、name、ref 或 selector。
func (s *Service) BrowserWait(text, textGone, nameIncludes, ref, selector string, timeoutMs int, frame string) ApiResult[json.RawMessage] {
	if s.browserBridge == nil {
		return ErrResult[json.RawMessage](errno.New(errno.CodeConnFailed, "浏览器桥未启动", ""))
	}
	text, textGone = strings.TrimSpace(text), strings.TrimSpace(textGone)
	nameIncludes, ref, selector = strings.TrimSpace(nameIncludes), strings.TrimSpace(ref), strings.TrimSpace(selector)
	frame = strings.TrimSpace(frame)
	if text == "" && textGone == "" && nameIncludes == "" && ref == "" && selector == "" {
		return ErrResult[json.RawMessage](errno.New(errno.CodeInvalidArg, "请提供 text / textGone / nameIncludes / ref / selector", ""))
	}
	args := map[string]interface{}{}
	if text != "" {
		args["text"] = text
	}
	if textGone != "" {
		args["textGone"] = textGone
	}
	if nameIncludes != "" {
		args["nameIncludes"] = nameIncludes
	}
	if ref != "" {
		args["ref"] = ref
	}
	if selector != "" {
		args["selector"] = selector
	}
	if frame != "" {
		args["frame"] = frame
	}
	if timeoutMs > 0 {
		args["timeoutMs"] = timeoutMs
	}
	data, err := s.browserBridge.Call(browserCtx(s), "wait", args)
	if err != nil {
		return ErrResult[json.RawMessage](err)
	}
	return OkResult(data)
}

// BrowserKeys 向当前焦点或指定元素发送按键（Enter / Escape / Mod+A 等）。
func (s *Service) BrowserKeys(keys, ref, selector string, repeat int, frame string) ApiResult[json.RawMessage] {
	if s.browserBridge == nil {
		return ErrResult[json.RawMessage](errno.New(errno.CodeConnFailed, "浏览器桥未启动", ""))
	}
	keys = strings.TrimSpace(keys)
	if keys == "" {
		return ErrResult[json.RawMessage](errno.New(errno.CodeInvalidArg, "请提供 keys", ""))
	}
	args := map[string]interface{}{"keys": keys}
	if ref = strings.TrimSpace(ref); ref != "" {
		args["ref"] = ref
	}
	if selector = strings.TrimSpace(selector); selector != "" {
		args["selector"] = selector
	}
	if frame = strings.TrimSpace(frame); frame != "" {
		args["frame"] = frame
	}
	if repeat > 0 {
		args["repeat"] = repeat
	}
	data, err := s.browserBridge.Call(browserCtx(s), "keys", args)
	if err != nil {
		return ErrResult[json.RawMessage](err)
	}
	return OkResult(data)
}

// BrowserScreenshot 截取附着标签可视区域，保存到数据目录并返回路径。
func (s *Service) BrowserScreenshot(format string, quality int) ApiResult[map[string]interface{}] {
	if s.browserBridge == nil {
		return ErrResult[map[string]interface{}](errno.New(errno.CodeConnFailed, "浏览器桥未启动", ""))
	}
	format = strings.ToLower(strings.TrimSpace(format))
	if format != "png" {
		format = "jpeg"
	}
	args := map[string]interface{}{"format": format}
	if quality > 0 {
		args["quality"] = quality
	}
	data, err := s.browserBridge.Call(browserCtx(s), "screenshot", args)
	if err != nil {
		msg := err.Error()
		if strings.Contains(msg, "未知动作") {
			return ErrResult[map[string]interface{}](errno.New(
				errno.CodeConnFailed,
				"截图失败：Chrome 扩展还是旧版（缺 screenshot）。磁盘已是 "+browser.SeedVersion()+"，请打开 chrome://extensions 点本扩展「重新加载」后再试",
				"",
			))
		}
		return ErrResult[map[string]interface{}](err)
	}
	var shot struct {
		DataURL string `json:"dataUrl"`
		Format  string `json:"format"`
		URL     string `json:"url"`
		Title   string `json:"title"`
		TabID   int64  `json:"tabId"`
	}
	if err := json.Unmarshal(data, &shot); err != nil || shot.DataURL == "" {
		return ErrResult[map[string]interface{}](errno.New(errno.CodeConnFailed, "截图数据无效", ""))
	}
	comma := strings.Index(shot.DataURL, ",")
	if comma < 0 {
		return ErrResult[map[string]interface{}](errno.New(errno.CodeConnFailed, "截图 dataUrl 格式错误", ""))
	}
	raw, err := base64.StdEncoding.DecodeString(shot.DataURL[comma+1:])
	if err != nil {
		return ErrResult[map[string]interface{}](errno.Wrap(errno.CodeStoreFailed, "截图解码失败", err))
	}
	dataDir, err := store.DataDir()
	if err != nil {
		return ErrResult[map[string]interface{}](errno.Wrap(errno.CodeStoreFailed, "数据目录不可用", err))
	}
	dir := filepath.Join(dataDir, "browser-shots")
	if err := os.MkdirAll(dir, 0o755); err != nil {
		return ErrResult[map[string]interface{}](errno.Wrap(errno.CodeStoreFailed, "创建截图目录失败", err))
	}
	ext := "jpg"
	if format == "png" || strings.Contains(shot.DataURL[:comma], "png") {
		ext = "png"
		format = "png"
	}
	name := fmt.Sprintf("shot-%s.%s", time.Now().Format("20060102-150405.000"), ext)
	path := filepath.Join(dir, name)
	if err := os.WriteFile(path, raw, 0o644); err != nil {
		return ErrResult[map[string]interface{}](errno.Wrap(errno.CodeStoreFailed, "写入截图失败", err))
	}
	out := map[string]interface{}{
		"path":      path,
		"sizeBytes": len(raw),
		"format":    format,
		"url":       shot.URL,
		"title":     shot.Title,
		"dataUrl":   shot.DataURL, // 舞台内预览；MCP 侧勿整段回灌模型
	}
	if shot.TabID > 0 {
		out["tabId"] = shot.TabID
	}
	return OkResult(out)
}

// BrowserFill 向已附着页填值（支持 contenteditable / ProseMirror / 同域 iframe）。
func (s *Service) BrowserFill(ref, selector, value, frame string) ApiResult[json.RawMessage] {
	if s.browserBridge == nil {
		return ErrResult[json.RawMessage](errno.New(errno.CodeConnFailed, "浏览器桥未启动", ""))
	}
	ref, selector, frame = strings.TrimSpace(ref), strings.TrimSpace(selector), strings.TrimSpace(frame)
	if ref == "" && selector == "" {
		return ErrResult[json.RawMessage](errno.New(errno.CodeInvalidArg, "请提供 ref 或 selector", ""))
	}
	args := map[string]interface{}{"ref": ref, "selector": selector, "value": value}
	if frame != "" {
		args["frame"] = frame
	}
	data, err := s.browserBridge.Call(browserCtx(s), "fill", args)
	if err != nil {
		if s.toolsRegistry != nil {
			workbenchtools.RecordBrowserStep(s.toolsRegistry.Deps(), workbenchtools.BrowserStepInput{
				Tool: "browser_fill", Action: "fill", Summary: "舞台填表 " + ref, Source: "ui",
				Args: map[string]interface{}{"ref": ref, "selector": selector, "value": value, "valueLen": len(value), "frame": frame},
				Locator: map[string]interface{}{"ref": ref, "selector": selector, "frame": frame},
				OK: false, Error: err.Error(),
			})
		}
		return ErrResult[json.RawMessage](err)
	}
	if s.toolsRegistry != nil {
		workbenchtools.RecordBrowserStep(s.toolsRegistry.Deps(), workbenchtools.BrowserStepInput{
			Tool: "browser_fill", Action: "fill", Summary: "舞台填表 " + ref, Source: "ui",
			Args: map[string]interface{}{"ref": ref, "selector": selector, "value": value, "valueLen": len(value), "frame": frame},
			Locator: map[string]interface{}{"ref": ref, "selector": selector, "frame": frame},
			Result: data, OK: true,
		})
	}
	return OkResult(data)
}

// BrowserOpenFrame 将跨域 iframe 以新标签打开并附着；同域则提示直接用 frame 参数。
func (s *Service) BrowserOpenFrame(frame string, forceNewTab bool) ApiResult[json.RawMessage] {
	if s.browserBridge == nil {
		return ErrResult[json.RawMessage](errno.New(errno.CodeConnFailed, "浏览器桥未启动", ""))
	}
	frame = strings.TrimSpace(frame)
	if frame == "" {
		return ErrResult[json.RawMessage](errno.New(errno.CodeInvalidArg, "请提供 frame（如 #f1）", ""))
	}
	data, err := s.browserBridge.Call(browserCtx(s), "open_frame", map[string]interface{}{
		"frame": frame, "forceNewTab": forceNewTab,
	})
	if err != nil {
		return ErrResult[json.RawMessage](err)
	}
	return OkResult(data)
}

// BrowserNavigate 导航已附着标签或新标签。
func (s *Service) BrowserNavigate(url string, newTab bool) ApiResult[json.RawMessage] {
	if s.browserBridge == nil {
		return ErrResult[json.RawMessage](errno.New(errno.CodeConnFailed, "浏览器桥未启动", ""))
	}
	url = strings.TrimSpace(url)
	if url == "" {
		return ErrResult[json.RawMessage](errno.New(errno.CodeInvalidArg, "请提供 url", ""))
	}
	args := map[string]interface{}{"url": url, "newTab": newTab}
	data, err := s.browserBridge.Call(browserCtx(s), "navigate", args)
	if err != nil {
		if s.toolsRegistry != nil {
			workbenchtools.RecordBrowserStep(s.toolsRegistry.Deps(), workbenchtools.BrowserStepInput{
				Tool: "browser_navigate", Action: "navigate", Summary: "舞台导航", Source: "ui",
				Args: args, Locator: map[string]interface{}{"url": url}, OK: false, Error: err.Error(),
			})
		}
		return ErrResult[json.RawMessage](err)
	}
	if s.toolsRegistry != nil {
		workbenchtools.RecordBrowserStep(s.toolsRegistry.Deps(), workbenchtools.BrowserStepInput{
			Tool: "browser_navigate", Action: "navigate", Summary: "舞台导航 " + url, Source: "ui",
			Args: args, Locator: map[string]interface{}{"url": url}, Result: data, OK: true,
		})
	}
	return OkResult(data)
}

func browserCtx(s *Service) context.Context {
	if s != nil && s.ctx != nil {
		return s.ctx
	}
	return context.Background()
}

// OpenChromeExtensionsPage 打开浏览器扩展管理页，方便用户点「重新加载」。
func (s *Service) OpenChromeExtensionsPage() ApiResult[map[string]interface{}] {
	tryOpen := func(args ...string) error {
		return exec.Command(args[0], args[1:]...).Start()
	}
	var err error
	switch goruntime.GOOS {
	case "darwin":
		for _, app := range []string{"Google Chrome", "Microsoft Edge", "Chromium", "Brave Browser"} {
			if err = tryOpen("open", "-a", app, "chrome://extensions"); err == nil {
				break
			}
		}
	case "windows":
		err = tryOpen("cmd", "/c", "start", "", "chrome://extensions")
	default:
		for _, bin := range []string{"google-chrome", "chromium", "microsoft-edge", "brave-browser"} {
			if err = tryOpen(bin, "chrome://extensions"); err == nil {
				break
			}
		}
	}
	if err != nil {
		return ErrResult[map[string]interface{}](errno.Wrap(errno.CodeStoreFailed, "无法打开扩展页，请手动在地址栏输入 chrome://extensions", err))
	}
	return OkResult(map[string]interface{}{
		"opened": true,
		"url":    "chrome://extensions",
		"hint":   "找到 WWorkbench Browser Stage → 点「重新加载」，再回舞台点刷新",
	})
}

// DistillWorkflow 舞台：从录制步骤蒸馏为工作流笔记（无 MCP 确认门）。
// dropSeqsJSON 为 JSON 整型数组，表示蒸馏时丢掉的步骤 seq；空则全留成功可重放步。
func (s *Service) DistillWorkflow(runID, name, title, intent, dropSeqsJSON string) ApiResult[map[string]interface{}] {
	if s.toolsRegistry == nil {
		return ErrResult[map[string]interface{}](errno.New(errno.CodeInvalidArg, "工具注册表未就绪", ""))
	}
	var drop []int
	if raw := strings.TrimSpace(dropSeqsJSON); raw != "" {
		_ = json.Unmarshal([]byte(raw), &drop)
	}
	res := workbenchtools.DistillWorkflowNow(
		s.toolsRegistry.Deps(),
		strings.TrimSpace(runID),
		strings.TrimSpace(name),
		strings.TrimSpace(title),
		"",
		firstNonEmptyStr(strings.TrimSpace(intent), "舞台生成工作流"),
		drop,
	)
	return toolResMap(res)
}

// PublishWorkflow 将笔记标为工作流（笔记 SSOT；磁盘投影可选）。
func (s *Service) PublishWorkflow(noteID, skillID string) ApiResult[map[string]interface{}] {
	if s.notebook == nil {
		return ErrResult[map[string]interface{}](errno.New(errno.CodeInvalidArg, "笔记本未就绪", ""))
	}
	noteID = strings.TrimSpace(noteID)
	if noteID == "" {
		return ErrResult[map[string]interface{}](errno.New(errno.CodeInvalidArg, "请提供 noteId", ""))
	}
	n, err := s.notebook.GetNote(noteID)
	if err != nil {
		return ErrResult[map[string]interface{}](err)
	}
	id := strings.TrimSpace(skillID)
	if id == "" {
		id = notebook.ReadLinkedSkillID(n.Content)
	}
	if id == "" {
		if p, ok := notebook.ParseWorkflowNote(*n); ok && strings.TrimSpace(p.Name) != "" {
			id = strings.TrimSpace(p.Name)
		}
	}
	if id == "" {
		id = notebook.SkillNameFromNoteID(n.ID)
	}
	if id == "" {
		id = notebook.SuggestSkillID(n.Title, n.ID)
	}
	body := notebook.SkillBodyFromNote(n.Content)
	if body == "" {
		return ErrResult[map[string]interface{}](errno.New(errno.CodeInvalidArg, "工作流笔记正文为空", ""))
	}
	if _, err := s.notebook.MarkNoteAsSkill(noteID, id); err != nil {
		return ErrResult[map[string]interface{}](fmt.Errorf("笔记标记工作流失败: %w", err))
	}
	noteIDOut, skillDir, assetsDir, _ := s.notebook.ResolveSkillPaths(id)
	if noteIDOut == "" {
		noteIDOut = noteID
	}
	return OkResult(map[string]interface{}{
		"ok": true, "noteId": noteIDOut, "skillId": id, "ssot": "notebook",
		"skillDir": skillDir, "assetsDir": assetsDir,
		"note": "已将笔记标为工作流「" + id + "」。路径：" + skillDir,
	})
}

// ListWorkflows 列出工作流笔记。
func (s *Service) ListWorkflows(limit int) ApiResult[[]model.WorkflowDO] {
	if s.notebook == nil {
		return ErrResult[[]model.WorkflowDO](errno.New(errno.CodeInvalidArg, "笔记本未就绪", ""))
	}
	list := s.notebook.ListWorkflowsSSOT(limit)
	if list == nil {
		list = []model.WorkflowDO{}
	}
	return OkResult(list)
}

// GetWorkflow 读取工作流笔记。
func (s *Service) GetWorkflow(nameOrID string) ApiResult[model.WorkflowDO] {
	key := strings.TrimSpace(nameOrID)
	if s.notebook == nil {
		return ErrResult[model.WorkflowDO](errno.New(errno.CodeInvalidArg, "笔记本未就绪", ""))
	}
	p, err := s.notebook.ResolveWorkflow(key)
	if err != nil {
		return ErrResult[model.WorkflowDO](err)
	}
	return OkResult(p)
}

// RunWorkflow 舞台运行已存工作流（无 MCP 确认门）。
func (s *Service) RunWorkflow(name, session, intent string) ApiResult[map[string]interface{}] {
	if s.toolsRegistry == nil {
		return ErrResult[map[string]interface{}](errno.New(errno.CodeInvalidArg, "工具注册表未就绪", ""))
	}
	res := workbenchtools.RunStoredWorkflowNow(
		browserCtx(s),
		s.toolsRegistry.Deps(),
		strings.TrimSpace(name),
		strings.TrimSpace(session),
		firstNonEmptyStr(strings.TrimSpace(intent), "舞台运行工作流"),
		true,
	)
	return toolResMap(res)
}

// UpdateSkill 把经验/脚本/资源/优化步骤写回工作流笔记（自我更新 Skill）。
func (s *Service) UpdateSkill(in workbenchtools.UpdateSkillArgs) ApiResult[map[string]interface{}] {
	if s.toolsRegistry == nil {
		return ErrResult[map[string]interface{}](errno.New(errno.CodeInvalidArg, "工具注册表未就绪", ""))
	}
	if strings.TrimSpace(in.Intent) == "" {
		in.Intent = "舞台沉淀 Skill"
	}
	return toolResMap(workbenchtools.UpdateSkillNow(s.toolsRegistry.Deps(), in))
}

// SaveWorkflow 舞台保存工作流步骤（删步/改 locator）。
func (s *Service) SaveWorkflow(p model.WorkflowDO) ApiResult[model.WorkflowDO] {
	if s.toolsRegistry == nil {
		return ErrResult[model.WorkflowDO](errno.New(errno.CodeInvalidArg, "工具注册表未就绪", ""))
	}
	res := workbenchtools.SaveWorkflowNow(s.toolsRegistry.Deps(), p)
	if !res.OK {
		return ErrResult[model.WorkflowDO](errno.New(errno.CodeUnknown, res.Error, ""))
	}
	var wrap struct {
		Workflow model.WorkflowDO `json:"workflow"`
	}
	if len(res.Data) > 0 {
		_ = json.Unmarshal(res.Data, &wrap)
	}
	if wrap.Workflow.ID == "" && s.notebook != nil {
		saved, err := s.notebook.ResolveWorkflow(p.Name)
		if err != nil {
			return ErrResult[model.WorkflowDO](err)
		}
		return OkResult(saved)
	}
	return OkResult(wrap.Workflow)
}

func toolResMap(res workbenchtools.ToolResult) ApiResult[map[string]interface{}] {
	if !res.OK {
		return ErrResult[map[string]interface{}](errno.New(errno.CodeUnknown, res.Error, ""))
	}
	out := map[string]interface{}{}
	if len(res.Data) > 0 {
		_ = json.Unmarshal(res.Data, &out)
	}
	if len(out) == 0 {
		out["ok"] = true
	}
	return OkResult(out)
}

func firstNonEmptyStr(vals ...string) string {
	for _, v := range vals {
		if strings.TrimSpace(v) != "" {
			return strings.TrimSpace(v)
		}
	}
	return ""
}

// ReplayTaskStep 舞台教练条：重放/跳过源任务的一步（不再弹 MCP 确认门）。
func (s *Service) ReplayTaskStep(runID string, seq int, skip bool, intent string) ApiResult[map[string]interface{}] {
	if s.toolsRegistry == nil {
		return ErrResult[map[string]interface{}](errno.New(errno.CodeInvalidArg, "工具注册表未就绪", ""))
	}
	res := workbenchtools.ReplayTaskStepNow(
		browserCtx(s),
		s.toolsRegistry.Deps(),
		strings.TrimSpace(runID),
		seq,
		skip,
		strings.TrimSpace(intent),
		true,
	)
	return toolResMap(res)
}

// FinishBrowserReplay 停止试跑：收口 replay-<source> 会话，避免一直「录制中」。
func (s *Service) FinishBrowserReplay(sourceRunID string) ApiResult[bool] {
	if s.toolsRegistry == nil {
		return ErrResult[bool](errno.New(errno.CodeInvalidArg, "工具注册表未就绪", ""))
	}
	workbenchtools.FinishReplaySession(s.toolsRegistry.Deps(), sourceRunID)
	return OkResult(true)
}

// CloseTaskRun 结束指定任务（修卡在 running 的试跑/剧本等）。
func (s *Service) CloseTaskRun(runID string) ApiResult[bool] {
	if s.toolsRegistry == nil {
		return ErrResult[bool](errno.New(errno.CodeInvalidArg, "工具注册表未就绪", ""))
	}
	if err := workbenchtools.CloseTaskRunByID(s.toolsRegistry.Deps(), runID, "done"); err != nil {
		return ErrResult[bool](err)
	}
	return OkResult(true)
}

// ListTaskRuns 列出近期任务日志（浏览器舞台时间线）。
func (s *Service) ListTaskRuns(session string, limit int) ApiResult[[]model.TaskRunDO] {
	list, err := s.store.ListTaskRuns(session, limit)
	if err != nil {
		return ErrResult[[]model.TaskRunDO](err)
	}
	if list == nil {
		list = []model.TaskRunDO{}
	}
	return OkResult(list)
}

// GetTaskRun 获取一次任务详情（含步骤）。
func (s *Service) GetTaskRun(runID string) ApiResult[model.TaskRunDetailDO] {
	detail, err := s.store.GetTaskRunDetail(strings.TrimSpace(runID))
	if err != nil {
		return ErrResult[model.TaskRunDetailDO](err)
	}
	return OkResult(detail)
}

// SyncTaskRunLog 将任务步骤同步为工作流目录下 log.md 文本笔记（舞台日志 IDE）。
func (s *Service) SyncTaskRunLog(runID string) ApiResult[map[string]interface{}] {
	if s.toolsRegistry == nil {
		return ErrResult[map[string]interface{}](errno.New(errno.CodeInvalidArg, "工具注册表未就绪", ""))
	}
	noteID, scopeRoot, skillName, err := workbenchtools.SyncTaskRunLogNote(s.toolsRegistry.Deps(), strings.TrimSpace(runID))
	if err != nil {
		return ErrResult[map[string]interface{}](err)
	}
	return OkResult(map[string]interface{}{
		"ok":        true,
		"noteId":    noteID,
		"scopeRoot": scopeRoot,
		"skillName": skillName,
	})
}

// RenameTaskRun 重命名任务标题（舞台会话列表）。
func (s *Service) RenameTaskRun(runID, title string) ApiResult[bool] {
	if err := s.store.UpdateTaskRunTitle(runID, title); err != nil {
		return ErrResult[bool](err)
	}
	return OkResult(true)
}

// DeleteTaskRuns 批量删除任务及其步骤（不删关联 Skill 笔记）。
func (s *Service) DeleteTaskRuns(ids []string) ApiResult[int] {
	n, err := s.store.DeleteTaskRuns(ids)
	if err != nil {
		return ErrResult[int](err)
	}
	return OkResult(n)
}

// StartBrowserRecording 开始录制：扩展捕获用户点击/填表/导航，写入任务日志。
func (s *Service) StartBrowserRecording(title string) ApiResult[map[string]interface{}] {
	if s.browserBridge == nil {
		return ErrResult[map[string]interface{}](errno.New(errno.CodeConnFailed, "浏览器桥未启动", ""))
	}
	title = strings.TrimSpace(title)
	data, err := s.browserBridge.Call(browserCtx(s), "record_start", map[string]interface{}{"title": title})
	if err != nil {
		return ErrResult[map[string]interface{}](err)
	}
	var meta struct {
		Session string `json:"session"`
		TabID   int64  `json:"tabId"`
		URL     string `json:"url"`
		Title   string `json:"title"`
	}
	_ = json.Unmarshal(data, &meta)
	session := strings.TrimSpace(meta.Session)
	runTitle := title
	if runTitle == "" {
		runTitle = strings.TrimSpace(meta.Title)
	}
	if runTitle == "" {
		runTitle = "网页录制"
	}
	runID := ""
	if s.toolsRegistry != nil && session != "" {
		// 扩展也会推 record_start 事件；此处先 Ensure，保证立即返回 taskRunId。首步 navigate 由事件写入。
		runID = workbenchtools.EnsureTaskRun(s.toolsRegistry.Deps(), session, runTitle, "用户网页录制", "record")
	}
	if s.ctx != nil {
		runtime.EventsEmit(s.ctx, "browser:recording", map[string]interface{}{
			"recording": true, "session": session, "taskRunId": runID, "title": runTitle,
		})
	}
	out := map[string]interface{}{
		"ok": true, "recording": true, "session": session, "taskRunId": runID,
		"tabId": meta.TabID, "url": meta.URL, "title": runTitle,
	}
	return OkResult(out)
}

// StopBrowserRecording 停止录制并结束对应任务。
func (s *Service) StopBrowserRecording() ApiResult[map[string]interface{}] {
	if s.browserBridge == nil {
		return ErrResult[map[string]interface{}](errno.New(errno.CodeConnFailed, "浏览器桥未启动", ""))
	}
	data, err := s.browserBridge.Call(browserCtx(s), "record_stop", map[string]interface{}{})
	if err != nil {
		return ErrResult[map[string]interface{}](err)
	}
	var meta struct {
		Session string `json:"session"`
	}
	_ = json.Unmarshal(data, &meta)
	session := strings.TrimSpace(meta.Session)
	if s.toolsRegistry != nil && session != "" {
		workbenchtools.CloseTaskRunForSession(s.toolsRegistry.Deps(), session, "done")
	}
	if s.ctx != nil {
		runtime.EventsEmit(s.ctx, "browser:recording", map[string]interface{}{
			"recording": false, "session": session,
		})
	}
	out := map[string]interface{}{"ok": true, "recording": false, "session": session}
	return OkResult(out)
}

// handleBrowserExtEvent 扩展主动事件（popup 开始录制 / 用户操作步骤）。
func (s *Service) handleBrowserExtEvent(action string, data json.RawMessage) {
	if s.toolsRegistry == nil {
		return
	}
	deps := s.toolsRegistry.Deps()
	switch action {
	case "record_start":
		var in struct {
			Session string `json:"session"`
			TabID   int64  `json:"tabId"`
			URL     string `json:"url"`
			Title   string `json:"title"`
		}
		_ = json.Unmarshal(data, &in)
		session := strings.TrimSpace(in.Session)
		if session == "" {
			return
		}
		title := strings.TrimSpace(in.Title)
		if title == "" {
			title = "网页录制"
		}
		runID := workbenchtools.EnsureTaskRun(deps, session, title, "用户网页录制", "record")
		if in.URL != "" {
			workbenchtools.RecordBrowserStep(deps, workbenchtools.BrowserStepInput{
				Session: session, Tool: "browser_record", Action: "navigate", Source: "record",
				Summary: "开始录制 " + in.URL, Title: title, Intent: "用户网页录制",
				Locator: map[string]interface{}{"url": in.URL},
				Args:    map[string]interface{}{"url": in.URL, "tabId": in.TabID},
				OK:      true, Approved: true,
			})
		}
		if s.ctx != nil {
			runtime.EventsEmit(s.ctx, "browser:recording", map[string]interface{}{
				"recording": true, "session": session, "taskRunId": runID, "title": title,
			})
		}
	case "record_step":
		var in struct {
			Session  string                 `json:"session"`
			Action   string                 `json:"action"`
			Summary  string                 `json:"summary"`
			Locator  map[string]interface{} `json:"locator"`
			Args     map[string]interface{} `json:"args"`
			URL      string                 `json:"url"`
			OK       *bool                  `json:"ok"`
			Error    string                 `json:"error"`
		}
		_ = json.Unmarshal(data, &in)
		session := strings.TrimSpace(in.Session)
		act := strings.TrimSpace(in.Action)
		if session == "" || act == "" {
			return
		}
		ok := true
		if in.OK != nil {
			ok = *in.OK
		}
		summary := strings.TrimSpace(in.Summary)
		if summary == "" {
			summary = act
		}
		loc := in.Locator
		if loc == nil {
			loc = map[string]interface{}{}
		}
		if in.URL != "" {
			if _, has := loc["url"]; !has {
				loc["url"] = in.URL
			}
		}
		runID := workbenchtools.RecordBrowserStep(deps, workbenchtools.BrowserStepInput{
			Session: session, Tool: "browser_record", Action: act, Source: "record",
			Summary: summary, Intent: "用户网页录制", Locator: loc, Args: in.Args,
			OK: ok, Error: in.Error, Approved: true, Title: "网页录制",
		})
		if s.ctx != nil {
			runtime.EventsEmit(s.ctx, "browser:recording", map[string]interface{}{
				"recording": true, "session": session, "taskRunId": runID, "step": act,
			})
		}
	case "record_stop":
		var in struct {
			Session string `json:"session"`
		}
		_ = json.Unmarshal(data, &in)
		session := strings.TrimSpace(in.Session)
		if session != "" {
			workbenchtools.CloseTaskRunForSession(deps, session, "done")
		}
		if s.ctx != nil {
			runtime.EventsEmit(s.ctx, "browser:recording", map[string]interface{}{
				"recording": false, "session": session,
			})
		}
	}
}

// RevealBrowserExtDir 在文件管理器中打开扩展目录，便于「加载已解压的扩展程序」。
func (s *Service) RevealBrowserExtDir() ApiResult[model.BrowserExtPathDO] {
	if s.browserBridge == nil {
		return ErrResult[model.BrowserExtPathDO](errno.New(errno.CodeConnFailed, "浏览器桥未启动", ""))
	}
	path := strings.TrimSpace(s.browserBridge.ExtDir())
	if path == "" {
		return ErrResult[model.BrowserExtPathDO](errno.New(errno.CodeInvalidArg, "扩展目录未知", ""))
	}
	if _, err := os.Stat(path); err != nil {
		return ErrResult[model.BrowserExtPathDO](errno.Wrap(errno.CodeInvalidArg, "扩展目录不存在", err))
	}
	var cmd *exec.Cmd
	switch goruntime.GOOS {
	case "darwin":
		cmd = exec.Command("open", path)
	case "windows":
		cmd = exec.Command("explorer", path)
	default:
		cmd = exec.Command("xdg-open", path)
	}
	if err := cmd.Start(); err != nil {
		return ErrResult[model.BrowserExtPathDO](errno.Wrap(errno.CodeStoreFailed, "打开文件管理器失败", err))
	}
	return OkResult(model.BrowserExtPathDO{Path: path})
}
