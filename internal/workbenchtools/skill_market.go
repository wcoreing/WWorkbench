package workbenchtools

import (
	"context"
	"encoding/json"
	"strings"

	"WWorkbench/internal/homeclient"
	"WWorkbench/internal/skill"
	"WWorkbench/internal/workbench"
)

// SkillMarketOps 技能市场网关（云商店 + 本机货架）；产品 / MCP 共用。
type SkillMarketOps struct {
	List      func() ([]homeclient.MarketListing, error)
	Publish   func(dirRel string) (homeclient.MarketListing, error)
	Install   func(id, version string) (skill.InstallResult, error)
	ListShelf func() ([]skill.ShelfCard, error)
}

func (d *Deps) skillMarket() *SkillMarketOps {
	if d == nil || d.SkillMarket == nil {
		return nil
	}
	return d.SkillMarket
}

// toolSkillMarketOpen 打开技能市场一级产品。
func toolSkillMarketOpen(_ context.Context, d *Deps, _ json.RawMessage) ToolResult {
	if d == nil || d.UIActions == nil {
		return Fail("UI 联动未初始化")
	}
	d.UIActions.Dispatch(UIActionSkillMarketOpen, map[string]interface{}{})
	return OKData(map[string]interface{}{
		"opened": true,
		"note":   "已切换到技能市场",
	})
}

// toolListSkillMarket 列出云端商店卡片。
func toolListSkillMarket(_ context.Context, d *Deps, _ json.RawMessage) ToolResult {
	ops := d.skillMarket()
	if ops == nil || ops.List == nil {
		return Fail("技能市场未就绪")
	}
	list, err := ops.List()
	if err != nil {
		return Fail(err.Error())
	}
	if list == nil {
		list = []homeclient.MarketListing{}
	}
	return OKData(map[string]interface{}{"ok": true, "listings": list, "total": len(list)})
}

// toolListSkillShelf 列出本机货架。
func toolListSkillShelf(_ context.Context, d *Deps, _ json.RawMessage) ToolResult {
	ops := d.skillMarket()
	if ops == nil || ops.ListShelf == nil {
		return Fail("技能市场未就绪")
	}
	cards, err := ops.ListShelf()
	if err != nil {
		return Fail(err.Error())
	}
	if cards == nil {
		cards = []skill.ShelfCard{}
	}
	return OKData(map[string]interface{}{"ok": true, "cards": cards, "total": len(cards)})
}

// toolPublishSkillMarket 导出并上架指定技能目录。
func toolPublishSkillMarket(_ context.Context, d *Deps, raw json.RawMessage) ToolResult {
	var in struct {
		Dir    string `json:"dir"`
		Path   string `json:"path"`
		Skill  string `json:"skill"`
		Intent string `json:"intent"`
	}
	_ = json.Unmarshal(raw, &in)
	dir := strings.TrimSpace(in.Dir)
	if dir == "" {
		dir = strings.TrimSpace(in.Path)
	}
	if dir == "" {
		dir = strings.TrimSpace(in.Skill)
	}
	if dir == "" {
		return Fail("请提供 dir（相对笔记本根的技能目录，如 工作流/demo）")
	}
	if d := skill.DirFromEntry(dir); d != "" {
		dir = d
	}
	ops := d.skillMarket()
	if ops == nil || ops.Publish == nil {
		return Fail("技能市场未就绪")
	}
	listing, err := ops.Publish(dir)
	if err != nil {
		return Fail(err.Error())
	}
	_ = in.Intent
	return OKData(map[string]interface{}{
		"ok":      true,
		"listing": listing,
		"note":    "已上架；安装仍由人确认危险动作",
	})
}

// toolInstallSkillMarket 从商店安装到本机货架并落盘。
func toolInstallSkillMarket(_ context.Context, d *Deps, raw json.RawMessage) ToolResult {
	var in struct {
		ID      string `json:"id"`
		Version string `json:"version"`
		Intent  string `json:"intent"`
	}
	_ = json.Unmarshal(raw, &in)
	id := strings.TrimSpace(in.ID)
	ver := strings.TrimSpace(in.Version)
	if id == "" {
		return Fail("请提供 id（商店技能 id）")
	}
	if ver == "" {
		return Fail("请提供 version")
	}
	ops := d.skillMarket()
	if ops == nil || ops.Install == nil {
		return Fail("技能市场未就绪")
	}
	out, err := ops.Install(id, ver)
	if err != nil {
		return Fail(err.Error())
	}
	_ = in.Intent
	return OKData(map[string]interface{}{
		"ok":     true,
		"result": out,
		"note":   "已安装到本机；危险动作仍须人确认",
	})
}

func registerSkillMarketTools(r *Registry) {
	r.add(ToolDef{
		Name:        workbench.CapSkillMarketOpen,
		Description: "打开技能市场一级产品（云端商店 / 本机货架 / 上架）。服务端产品扩展先行入口。",
		Parameters: map[string]interface{}{
			"type":       "object",
			"properties": map[string]interface{}{},
		},
		Handler: toolSkillMarketOpen,
	})
	r.add(ToolDef{
		Name:        workbench.CapListSkillMarket,
		Description: "列出账号云端技能商店卡片（需登录）。返回 id/name/version/author/intent/limits。",
		Parameters: map[string]interface{}{
			"type":       "object",
			"properties": map[string]interface{}{},
		},
		Handler: toolListSkillMarket,
	})
	r.add(ToolDef{
		Name:        workbench.CapListSkillShelf,
		Description: "列出本机技能货架（已导出/已下载版本；含安装状态）。",
		Parameters: map[string]interface{}{
			"type":       "object",
			"properties": map[string]interface{}{},
		},
		Handler: toolListSkillShelf,
	})
	r.add(ToolDef{
		Name:        workbench.CapPublishSkillMarket,
		Description: "把本机技能目录导出并上架到账号商店。dir=相对笔记本根（如 工作流/demo 或 项目/某项目）。需登录。",
		Parameters: map[string]interface{}{
			"type": "object",
			"properties": map[string]interface{}{
				"dir":    map[string]interface{}{"type": "string", "description": "技能目录相对路径"},
				"path":   map[string]interface{}{"type": "string"},
				"skill":  map[string]interface{}{"type": "string"},
				"intent": intentProp(),
			},
			"required": []interface{}{"dir"},
		},
		Handler: toolPublishSkillMarket,
	})
	r.add(ToolDef{
		Name:        workbench.CapInstallSkillMarket,
		Description: "从云端商店下载指定 id@version，写入本机货架并安装到业务根。危险动作仍须人确认。",
		Parameters: map[string]interface{}{
			"type": "object",
			"properties": map[string]interface{}{
				"id":      map[string]interface{}{"type": "string"},
				"version": map[string]interface{}{"type": "string"},
				"intent":  intentProp(),
			},
			"required": []interface{}{"id", "version"},
		},
		Handler: toolInstallSkillMarket,
	})
}
